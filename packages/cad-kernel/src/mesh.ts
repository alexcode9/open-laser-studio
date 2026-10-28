// Mesh-only import (STL; 3MF shares the model builder). Mesh files carry no B-Rep, so faces here
// are reconstructed regions of smoothly connected triangles: feature candidates, not CAD topology.
// Every value derived here is `mesh-derived` (or `fitted` when a cylinder is fitted).

import type { CadEdgeInfo, CadFaceInfo, CadMeshBuffers, CadPartInfo, Vec3 } from '@ols/shared-types';

import { add, cross, dot, emptyAabb, fmtVec, growAabb, len, normalize, round, scale, sub } from './vec';

export interface RawMesh {
  name: string;
  /** Triangle soup, 9 floats per triangle, source units. */
  triangles: Float64Array;
}

/** Region growing threshold between adjacent triangle normals. */
export const REGION_ANGLE_DEG = 30;
/** Planar regions: every triangle normal within this angle of the mean. */
const PLANAR_ANGLE_DEG = 0.5;
export const MAX_STL_TRIANGLES = 20_000_000;

export function parseStl(bytes: Uint8Array, name: string): RawMesh {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) {
      if (n > MAX_STL_TRIANGLES) throw Object.assign(new Error(`STL has ${n} triangles (limit ${MAX_STL_TRIANGLES})`), { code: 'LIMIT' });
      const tris = new Float64Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) tris[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return { name, triangles: tris };
    }
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!/^\s*solid/i.test(text) || !/facet/i.test(text)) throw Object.assign(new Error('not a valid binary or ASCII STL file'), { code: 'PARSE' });
  const nums: number[] = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
    if (nums.length / 9 > MAX_STL_TRIANGLES) throw Object.assign(new Error('STL triangle limit exceeded'), { code: 'LIMIT' });
  }
  if (nums.length === 0 || nums.length % 9 !== 0 || nums.some((v) => !Number.isFinite(v))) throw Object.assign(new Error('malformed ASCII STL'), { code: 'PARSE' });
  const solid = /^\s*solid\s+([^\r\n]*)/i.exec(text)?.[1]?.trim();
  return { name: solid || name, triangles: Float64Array.from(nums) };
}

export interface MeshBuildResult {
  parts: CadPartInfo[];
  faces: CadFaceInfo[];
  edges: CadEdgeInfo[];
  mesh: CadMeshBuffers;
  closed: boolean;
  volumeMm3: number | null;
  areaMm2: number;
  warnings: string[];
}

interface Welded {
  pos: Float64Array;
  tri: Uint32Array;
}

function weld(raw: Float64Array, scaleToMm: number): Welded {
  const n = raw.length / 9;
  const b = emptyAabb();
  for (let i = 0; i < raw.length; i += 3) growAabb(b, [raw[i]! * scaleToMm, raw[i + 1]! * scaleToMm, raw[i + 2]! * scaleToMm]);
  const tol = Math.max(1e-9, len(sub(b.max, b.min)) * 1e-7);
  const map = new Map<string, number>();
  const pos: number[] = [];
  const tri = new Uint32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const x = raw[i * 3]! * scaleToMm;
    const y = raw[i * 3 + 1]! * scaleToMm;
    const z = raw[i * 3 + 2]! * scaleToMm;
    const key = `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      map.set(key, id);
      pos.push(x, y, z);
    }
    tri[i] = id;
  }
  return { pos: Float64Array.from(pos), tri };
}

export function buildMeshModel(meshes: RawMesh[], scaleToMm: number): MeshBuildResult {
  const warnings: string[] = [];
  const faces: CadFaceInfo[] = [];
  const edges: CadEdgeInfo[] = [];
  const parts: CadPartInfo[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const triToFace: number[] = [];
  const segs: number[] = [];
  const segToEdge: number[] = [];
  let totalArea = 0;
  let totalVolume: number | null = 0;
  let allClosed = true;

  meshes.forEach((raw, pi) => {
    const { pos, tri } = weld(raw.triangles, scaleToMm);
    const nt = tri.length / 3;
    const P = (i: number): Vec3 => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
    const tn: Vec3[] = [];
    const ta: number[] = [];
    let degenerate = 0;
    for (let t = 0; t < nt; t++) {
      const c = cross(sub(P(tri[t * 3 + 1]!), P(tri[t * 3]!)), sub(P(tri[t * 3 + 2]!), P(tri[t * 3]!)));
      const a = len(c) / 2;
      if (a === 0) degenerate++;
      ta.push(a);
      tn.push(normalize(c));
    }
    if (degenerate > 0) warnings.push(`${raw.name}: ${degenerate} degenerate triangle(s) ignored for normals.`);

    // Edge adjacency.
    const edgeTris = new Map<string, number[]>();
    const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const key = ek(tri[t * 3 + k]!, tri[t * 3 + ((k + 1) % 3)]!);
        const l = edgeTris.get(key);
        if (l) l.push(t);
        else edgeTris.set(key, [t]);
      }
    }
    let closed = true;
    for (const l of edgeTris.values()) if (l.length !== 2) closed = false;
    allClosed &&= closed;

    // Region growing by dihedral angle.
    const cosT = Math.cos((REGION_ANGLE_DEG * Math.PI) / 180);
    const region = new Int32Array(nt).fill(-1);
    let nRegions = 0;
    for (let s = 0; s < nt; s++) {
      if (region[s] !== -1) continue;
      const r = nRegions++;
      region[s] = r;
      const stack = [s];
      while (stack.length) {
        const t = stack.pop()!;
        for (let k = 0; k < 3; k++) {
          const l = edgeTris.get(ek(tri[t * 3 + k]!, tri[t * 3 + ((k + 1) % 3)]!))!;
          if (l.length !== 2) continue;
          const o = l[0] === t ? l[1]! : l[0]!;
          if (region[o] !== -1) continue;
          if (ta[o] === 0 || ta[t] === 0 || dot(tn[t]!, tn[o]!) >= cosT) {
            region[o] = r;
            stack.push(o);
          }
        }
      }
    }

    const faceStart = faces.length;
    const edgeStart = edges.length;
    const pbox = emptyAabb();
    let partArea = 0;
    let vol = 0;
    const byRegion: number[][] = Array.from({ length: nRegions }, () => []);
    for (let t = 0; t < nt; t++) byRegion[region[t]!]!.push(t);
    for (let r = 0; r < nRegions; r++) {
      const ts = byRegion[r]!;
      const index = faces.length;
      const triStart = indices.length / 3;
      const local = new Map<number, number>();
      let area = 0;
      let cen: Vec3 = [0, 0, 0];
      let nsum: Vec3 = [0, 0, 0];
      const acc: number[] = [];
      for (const t of ts) {
        for (let k = 0; k < 3; k++) {
          const v = tri[t * 3 + k]!;
          let id = local.get(v);
          if (id === undefined) {
            id = positions.length / 3;
            local.set(v, id);
            const p = P(v);
            positions.push(p[0], p[1], p[2]);
            growAabb(pbox, p);
            acc.push(0, 0, 0);
          }
          indices.push(id);
          const base = (id - (positions.length / 3 - acc.length / 3)) * 3;
          acc[base]! += tn[t]![0] * ta[t]!;
          acc[base + 1]! += tn[t]![1] * ta[t]!;
          acc[base + 2]! += tn[t]![2] * ta[t]!;
        }
        triToFace.push(index);
        const c = scale(add(add(P(tri[t * 3]!), P(tri[t * 3 + 1]!)), P(tri[t * 3 + 2]!)), 1 / 3);
        cen = add(cen, scale(c, ta[t]!));
        nsum = add(nsum, scale(tn[t]!, ta[t]!));
        area += ta[t]!;
        vol += dot(P(tri[t * 3]!), cross(P(tri[t * 3 + 1]!), P(tri[t * 3 + 2]!))) / 6;
      }
      for (let i = 0; i < acc.length; i += 3) {
        const n = normalize([acc[i]!, acc[i + 1]!, acc[i + 2]!]);
        normals.push(n[0], n[1], n[2]);
      }
      const centroid = area > 0 ? scale(cen, 1 / area) : P(tri[ts[0]! * 3]!);
      const mean = normalize(nsum);
      const planar = ts.every((t) => ta[t] === 0 || dot(tn[t]!, mean) >= Math.cos((PLANAR_ANGLE_DEG * Math.PI) / 180));
      partArea += area;
      const face: CadFaceInfo = {
        index,
        partIndex: pi,
        kind: planar ? 'plane' : 'mesh',
        quality: 'mesh-derived',
        areaMm2: area,
        centroid,
        triStart,
        triCount: ts.length,
        edgeIndices: [],
        signature: '',
      };
      if (planar) face.plane = { origin: centroid, normal: mean };
      face.signature = `mesh|${round(area, 2)}|${fmtVec(centroid, 2)}`;
      faces.push(face);
    }

    // Boundary polylines between regions (and open borders) become mesh edges.
    const groups = new Map<string, [number, number][]>();
    for (const [key, l] of edgeTris) {
      const ra = region[l[0]!]!;
      const rb = l.length === 2 ? region[l[1]!]! : -1;
      if (ra === rb) continue;
      const gk = ra < rb ? `${ra}:${rb}` : `${rb}:${ra}`;
      const [a, b] = key.split('_').map(Number) as [number, number];
      const g = groups.get(gk);
      if (g) g.push([a, b]);
      else groups.set(gk, [[a, b]]);
    }
    for (const [gk, list] of groups) {
      const [ra, rb] = gk.split(':').map(Number) as [number, number];
      const index = edges.length;
      const segStart = segToEdge.length;
      let length = 0;
      for (const [a, b] of list) {
        segs.push(...P(a), ...P(b));
        segToEdge.push(index);
        length += len(sub(P(a), P(b)));
      }
      const faceIndices = [ra, rb].filter((r) => r >= 0).map((r) => faceStart + r);
      for (const f of faceIndices) faces[f]!.edgeIndices.push(index);
      edges.push({
        index,
        partIndex: pi,
        kind: 'polyline',
        quality: 'mesh-derived',
        lengthMm: length,
        lengthToleranceMm: 0,
        faceIndices,
        vertexIndices: [],
        segStart,
        segCount: list.length,
        signature: `poly|${round(length, 2)}`,
      });
    }

    totalArea += partArea;
    const volume = closed ? Math.abs(vol) : null;
    totalVolume = totalVolume !== null && volume !== null ? totalVolume + volume : null;
    if (!closed) warnings.push(`${raw.name}: mesh is not closed (watertight); volume is unavailable.`);
    parts.push({
      index: pi,
      name: raw.name,
      path: String(pi),
      worldTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      solidCount: closed ? 1 : 0,
      shellCount: 1,
      faceStart,
      faceCount: faces.length - faceStart,
      edgeStart,
      edgeCount: edges.length - edgeStart,
      vertexStart: 0,
      vertexCount: 0,
      bounds: pbox,
      volumeMm3: volume,
      areaMm2: partArea,
      valid: degenerate === 0,
    });
  });

  return {
    parts,
    faces,
    edges,
    mesh: {
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
      indices: Uint32Array.from(indices),
      triangleToFace: Uint32Array.from(triToFace),
      edgeSegments: Float32Array.from(segs),
      segmentToEdge: Uint32Array.from(segToEdge),
      vertexPositions: new Float32Array(0),
    },
    closed: allClosed,
    volumeMm3: totalVolume,
    areaMm2: totalArea,
    warnings,
  };
}

/** Raw extents (source units) for the unit confirmation preview. */
export function rawExtents(meshes: RawMesh[]): Vec3 {
  const b = emptyAabb();
  for (const m of meshes) for (let i = 0; i < m.triangles.length; i += 3) growAabb(b, [m.triangles[i]!, m.triangles[i + 1]!, m.triangles[i + 2]!]);
  return sub(b.max, b.min);
}
