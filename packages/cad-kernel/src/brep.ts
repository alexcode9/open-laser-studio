import type {
  Aabb,
  CadBoundsReport,
  CadEdgeInfo,
  CadFaceInfo,
  CadMeshBuffers,
  CadPartInfo,
  CadVertexInfo,
  CurveKind,
  SurfaceKind,
  Vec3,
} from '@ols/shared-types';

import { type OC, enumValue } from './occt';
import type { LocatedPart } from './step';
import { add, cross, dot, emptyAabb, fmtVec, len, normalize, round, scale, sub, unionAabb } from './vec';

/** Exact shapes kept in the kernel process for later queries. Indices match the model tables. */
export interface RetainedBrep {
  parts: OC[];
  faces: OC[];
  edges: OC[];
  vertices: OC[];
}

export interface BrepBuildResult {
  parts: CadPartInfo[];
  faces: CadFaceInfo[];
  edges: CadEdgeInfo[];
  vertices: CadVertexInfo[];
  mesh: CadMeshBuffers;
  bounds: CadBoundsReport;
  solidCount: number;
  shellCount: number;
  validation: { valid: boolean; messages: string[] };
  warnings: string[];
  retained: RetainedBrep;
}

export interface BrepBuildOptions {
  deflectionMm: number;
  angularDeflectionRad: number;
  maxTriangles: number;
  onProgress: (stage: 'meshing' | 'analyzing', fraction: number) => void;
}

/** Numerical tolerance used for curve-length integration (mm). */
export const LENGTH_TOLERANCE_MM = 1e-6;

const pt = (p: OC): Vec3 => [p.X(), p.Y(), p.Z()];

function enumNames(e: OC): Map<number, string> {
  const m = new Map<number, string>();
  for (const k of Object.keys(e)) {
    if (k === 'values') continue;
    const v = e[k];
    if (v && typeof v === 'object' && 'value' in v) m.set(enumValue(v), k);
  }
  return m;
}

const SURFACE: Record<string, SurfaceKind> = {
  GeomAbs_Plane: 'plane',
  GeomAbs_Cylinder: 'cylinder',
  GeomAbs_Cone: 'cone',
  GeomAbs_Sphere: 'sphere',
  GeomAbs_Torus: 'torus',
  GeomAbs_BezierSurface: 'bezier',
  GeomAbs_BSplineSurface: 'bspline',
  GeomAbs_SurfaceOfRevolution: 'revolution',
  GeomAbs_SurfaceOfExtrusion: 'extrusion',
  GeomAbs_OffsetSurface: 'offset',
  GeomAbs_OtherSurface: 'other',
};
const CURVE: Record<string, CurveKind> = {
  GeomAbs_Line: 'line',
  GeomAbs_Circle: 'circle',
  GeomAbs_Ellipse: 'ellipse',
  GeomAbs_Hyperbola: 'hyperbola',
  GeomAbs_Parabola: 'parabola',
  GeomAbs_BezierCurve: 'bezier',
  GeomAbs_BSplineCurve: 'bspline',
  GeomAbs_OffsetCurve: 'offset',
  GeomAbs_OtherCurve: 'other',
};

class Buffers {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  triToFace: number[] = [];
  segs: number[] = [];
  segToEdge: number[] = [];
  verts: number[] = [];
  get triangles(): number {
    return this.triToFace.length;
  }
}

function makeMap(oc: OC, shape: OC, kind: OC): OC {
  const m = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(shape, kind, m);
  return m;
}

/** Surface normal at (u, v) with face orientation applied. */
function faceNormal(oc: OC, s: OC, u: number, v: number, reversed: boolean): { p: Vec3; n: Vec3 } | null {
  const P = new oc.gp_Pnt_1();
  const du = new oc.gp_Vec_1();
  const dv = new oc.gp_Vec_1();
  try {
    s.D1(u, v, P, du, dv);
    const n = normalize(cross([du.X(), du.Y(), du.Z()], [dv.X(), dv.Y(), dv.Z()]));
    if (len(n) === 0) return null;
    return { p: pt(P), n: reversed ? scale(n, -1) : n };
  } finally {
    P.delete();
    du.delete();
    dv.delete();
  }
}

function tessellateFace(oc: OC, face: OC, reversed: boolean, faceIndex: number, buf: Buffers): number {
  const loc = new oc.TopLoc_Location_1();
  const h = oc.BRep_Tool.Triangulation(face, loc, 0);
  if (h.IsNull()) return 0;
  const tri = h.get();
  const trsf = loc.Transformation();
  const base = buf.positions.length / 3;
  const nNodes = tri.NbNodes();
  let haveNormals = false;
  try {
    oc.StdPrs_ToolTriangulatedShape.ComputeNormals_1(face, h);
    haveNormals = tri.HasNormals();
  } catch {
    haveNormals = false;
  }
  for (let i = 1; i <= nNodes; i++) {
    const p = tri.Node(i);
    const q = p.Transformed(trsf);
    buf.positions.push(q.X(), q.Y(), q.Z());
    p.delete();
    q.delete();
    if (haveNormals) {
      const d = tri.Normal_1(i);
      const e = d.Transformed(trsf);
      const s = reversed ? -1 : 1;
      buf.normals.push(e.X() * s, e.Y() * s, e.Z() * s);
      d.delete();
      e.delete();
    }
  }
  const nTris = tri.NbTriangles();
  const start = buf.indices.length;
  for (let i = 1; i <= nTris; i++) {
    const t = tri.Triangle(i);
    const a = t.Value(1) - 1 + base;
    const b = t.Value(2) - 1 + base;
    const c = t.Value(3) - 1 + base;
    t.delete();
    if (reversed) buf.indices.push(a, c, b);
    else buf.indices.push(a, b, c);
    buf.triToFace.push(faceIndex);
  }
  if (!haveNormals) {
    // Area-weighted vertex normals within this face only (faces never share vertices).
    const acc = new Float64Array(nNodes * 3);
    for (let k = start; k < buf.indices.length; k += 3) {
      const [a, b, c] = [buf.indices[k]! - base, buf.indices[k + 1]! - base, buf.indices[k + 2]! - base];
      const P = (j: number): Vec3 => [buf.positions[(base + j) * 3]!, buf.positions[(base + j) * 3 + 1]!, buf.positions[(base + j) * 3 + 2]!];
      const n = cross(sub(P(b), P(a)), sub(P(c), P(a)));
      for (const j of [a, b, c]) for (let x = 0; x < 3; x++) acc[j * 3 + x]! += n[x]!;
    }
    for (let j = 0; j < nNodes; j++) {
      const n = normalize([acc[j * 3]!, acc[j * 3 + 1]!, acc[j * 3 + 2]!]);
      buf.normals.push(n[0], n[1], n[2]);
    }
  }
  return nTris;
}

function bboxOf(oc: OC, shape: OC): Aabb | null {
  const box = new oc.Bnd_Box_1();
  try {
    oc.BRepBndLib.AddOptimal(shape, box, false, false);
  } catch {
    oc.BRepBndLib.Add(shape, box, false);
  }
  if (box.IsVoid()) return null;
  return { min: pt(box.CornerMin()), max: pt(box.CornerMax()) };
}

export function buildBrep(oc: OC, input: LocatedPart[], opts: BrepBuildOptions): BrepBuildResult {
  const S = oc.TopAbs_ShapeEnum;
  const surfNames = enumNames(oc.GeomAbs_SurfaceType);
  const curveNames = enumNames(oc.GeomAbs_CurveType);
  const buf = new Buffers();
  const parts: CadPartInfo[] = [];
  const faces: CadFaceInfo[] = [];
  const edges: CadEdgeInfo[] = [];
  const vertices: CadVertexInfo[] = [];
  const retained: RetainedBrep = { parts: [], faces: [], edges: [], vertices: [] };
  const warnings: string[] = [];
  const messages: string[] = [];
  let solidCount = 0;
  let shellCount = 0;
  let allValid = true;
  let modelBox = emptyAabb();
  let totalArea = 0;
  let totalVolume: number | null = 0;

  // Mesh everything first so triangulations exist (shared TShapes are meshed once).
  input.forEach((p, i) => {
    new oc.BRepMesh_IncrementalMesh_2(p.shape, opts.deflectionMm, false, opts.angularDeflectionRad, false);
    opts.onProgress('meshing', (i + 1) / input.length);
  });

  input.forEach((part, pi) => {
    const shape = part.shape;
    const faceMap = makeMap(oc, shape, S.TopAbs_FACE);
    const edgeMap = makeMap(oc, shape, S.TopAbs_EDGE);
    const vertMap = makeMap(oc, shape, S.TopAbs_VERTEX);
    const nSolids = makeMap(oc, shape, S.TopAbs_SOLID).Extent();
    const nShells = makeMap(oc, shape, S.TopAbs_SHELL).Extent();
    solidCount += nSolids;
    shellCount += nShells;
    const faceStart = faces.length;
    const edgeStart = edges.length;
    const vertStart = vertices.length;

    for (let i = 1; i <= vertMap.Extent(); i++) {
      const v = oc.TopoDS.Vertex_1(vertMap.FindKey(i));
      const p = pt(oc.BRep_Tool.Pnt(v));
      vertices.push({ index: vertices.length, partIndex: pi, position: p });
      retained.vertices.push(v);
      buf.verts.push(p[0], p[1], p[2]);
    }

    // Edges: analysis + display polylines.
    for (let i = 1; i <= edgeMap.Extent(); i++) {
      const e = oc.TopoDS.Edge_1(edgeMap.FindKey(i));
      const index = edges.length;
      const info: CadEdgeInfo = {
        index,
        partIndex: pi,
        kind: 'other',
        quality: 'computed',
        lengthMm: 0,
        lengthToleranceMm: LENGTH_TOLERANCE_MM,
        faceIndices: [],
        vertexIndices: [],
        segStart: buf.segToEdge.length,
        segCount: 0,
        signature: '',
      };
      for (const v of [oc.TopExp.FirstVertex(e, false), oc.TopExp.LastVertex(e, false)]) {
        if (v.IsNull()) continue;
        const k = vertMap.FindIndex(v);
        if (k > 0 && !info.vertexIndices.includes(vertStart + k - 1)) info.vertexIndices.push(vertStart + k - 1);
      }
      if (!oc.BRep_Tool.Degenerated(e)) {
        const c = new oc.BRepAdaptor_Curve_2(e);
        const kind = CURVE[curveNames.get(enumValue(c.GetType())) ?? ''] ?? 'other';
        const u0 = c.FirstParameter();
        const u1 = c.LastParameter();
        info.kind = kind;
        if (kind === 'line') {
          const a = pt(c.Value(u0));
          const b = pt(c.Value(u1));
          info.line = { start: a, end: b, direction: normalize(sub(b, a)) };
          info.lengthMm = len(sub(b, a));
          info.quality = 'analytical';
          info.lengthToleranceMm = 0;
        } else if (kind === 'circle') {
          const circ = c.Circle();
          const r = circ.Radius();
          info.circle = { center: pt(circ.Location()), normal: pt(circ.Axis().Direction()), radiusMm: r, angularSpanRad: u1 - u0 };
          info.lengthMm = r * Math.abs(u1 - u0);
          info.quality = 'analytical';
          info.lengthToleranceMm = 0;
        } else {
          info.lengthMm = oc.GCPnts_AbscissaPoint.Length_3(c, LENGTH_TOLERANCE_MM);
        }
        try {
          const d = new oc.GCPnts_QuasiUniformDeflection_2(c, opts.deflectionMm, oc.GeomAbs_Shape.GeomAbs_C1);
          if (d.IsDone() && d.NbPoints() >= 2) {
            let prev = pt(d.Value(1));
            for (let k = 2; k <= d.NbPoints(); k++) {
              const cur = pt(d.Value(k));
              buf.segs.push(...prev, ...cur);
              buf.segToEdge.push(index);
              prev = cur;
            }
          }
        } catch {
          warnings.push(`Edge ${index} could not be discretised for display.`);
        }
      } else {
        info.quality = 'analytical';
        info.lengthToleranceMm = 0;
      }
      info.segCount = buf.segToEdge.length - info.segStart;
      edges.push(info);
      retained.edges.push(e);
    }

    // Faces: analysis + tessellation.
    const nFaces = faceMap.Extent();
    for (let i = 1; i <= nFaces; i++) {
      const f = oc.TopoDS.Face_1(faceMap.FindKey(i));
      const index = faces.length;
      const reversed = f.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      const s = new oc.BRepAdaptor_Surface_2(f, true);
      const kind = SURFACE[surfNames.get(enumValue(s.GetType())) ?? ''] ?? 'other';
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_1(f, props, false, false);
      const area = props.Mass();
      const centroid = pt(props.CentreOfMass());
      totalArea += area;
      const triStart = buf.triangles;
      const triCount = tessellateFace(oc, f, reversed, index, buf);
      if (buf.triangles > opts.maxTriangles) {
        throw Object.assign(new Error(`display tessellation exceeds ${opts.maxTriangles} triangles; increase the deflection`), { code: 'LIMIT' });
      }
      const info: CadFaceInfo = {
        index,
        partIndex: pi,
        kind,
        quality: kind === 'bspline' || kind === 'bezier' || kind === 'other' || kind === 'offset' ? 'computed' : 'analytical',
        areaMm2: area,
        centroid,
        triStart,
        triCount,
        edgeIndices: [],
        signature: '',
      };
      const u0 = s.FirstUParameter();
      const u1 = s.LastUParameter();
      const v0 = s.FirstVParameter();
      const v1 = s.LastVParameter();
      const mid = faceNormal(oc, s, (u0 + u1) / 2, (v0 + v1) / 2, reversed);
      if (kind === 'plane') {
        const pl = s.Plane();
        info.plane = { origin: pt(pl.Location()), normal: mid?.n ?? pt(pl.Axis().Direction()) };
      } else if (kind === 'cylinder') {
        const cyl = s.Cylinder();
        const ax = cyl.Axis();
        const o = pt(ax.Location());
        const d = normalize(pt(ax.Direction()));
        let inner: boolean | null = null;
        if (mid && nSolids > 0) {
          const radial = sub(mid.p, add(o, scale(d, dot(sub(mid.p, o), d))));
          const k = dot(mid.n, normalize(radial));
          if (Math.abs(k) > 0.5) inner = k < 0;
        }
        info.cylinder = {
          radiusMm: cyl.Radius(),
          axisOrigin: o,
          axisDirection: d,
          axialMinMm: Math.min(v0, v1),
          axialMaxMm: Math.max(v0, v1),
          angularSpanRad: Math.min(2 * Math.PI, Math.abs(u1 - u0)),
          inner,
        };
      } else if (kind === 'cone') {
        const cone = s.Cone();
        info.cone = { apex: pt(cone.Apex()), axisDirection: pt(cone.Axis().Direction()), semiAngleRad: cone.SemiAngle(), refRadiusMm: cone.RefRadius() };
      } else if (kind === 'sphere') {
        const sp = s.Sphere();
        info.sphere = { center: pt(sp.Location()), radiusMm: sp.Radius() };
      } else if (kind === 'torus') {
        const t = s.Torus();
        info.torus = { center: pt(t.Location()), axisDirection: pt(t.Axis().Direction()), majorRadiusMm: t.MajorRadius(), minorRadiusMm: t.MinorRadius() };
      }
      const ex = new oc.TopExp_Explorer_2(f, S.TopAbs_EDGE, S.TopAbs_SHAPE);
      for (; ex.More(); ex.Next()) {
        const k = edgeMap.FindIndex(ex.Current());
        if (k <= 0) continue;
        const ei = edgeStart + k - 1;
        if (!info.edgeIndices.includes(ei)) info.edgeIndices.push(ei);
        const e = edges[ei]!;
        if (!e.faceIndices.includes(index)) e.faceIndices.push(index);
      }
      info.signature = faceSignature(info);
      faces.push(info);
      retained.faces.push(f);
      opts.onProgress('analyzing', (pi + i / nFaces) / input.length);
    }
    for (let k = edgeStart; k < edges.length; k++) edges[k]!.signature = edgeSignature(edges[k]!);

    const pbox = bboxOf(oc, shape) ?? emptyAabb();
    modelBox = unionAabb(modelBox, pbox);
    let volume: number | null = null;
    if (nSolids > 0) {
      const vp = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, vp, true, false, false);
      volume = Math.abs(vp.Mass());
    }
    totalVolume = totalVolume !== null && volume !== null ? totalVolume + volume : null;
    const pprops = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(shape, pprops, false, false);
    let valid = true;
    try {
      valid = !!new oc.BRepCheck_Analyzer(shape, true, false).IsValid_2();
    } catch {
      valid = true;
      messages.push(`${part.name}: validity check unavailable`);
    }
    if (!valid) {
      allValid = false;
      messages.push(`${part.name}: shape failed the B-Rep validity check; measurements may be unreliable.`);
    }
    if (nSolids === 0) messages.push(`${part.name}: no closed solid (surface model); volume and inner/outer classification unavailable.`);
    parts.push({
      index: pi,
      name: part.name,
      path: part.path,
      worldTransform: part.worldTransform,
      solidCount: nSolids,
      shellCount: nShells,
      faceStart,
      faceCount: faces.length - faceStart,
      edgeStart,
      edgeCount: edges.length - edgeStart,
      vertexStart: vertStart,
      vertexCount: vertices.length - vertStart,
      bounds: pbox,
      volumeMm3: volume,
      areaMm2: pprops.Mass(),
      valid,
    });
    retained.parts.push(shape);
  });

  let obb: CadBoundsReport['obb'] = null;
  try {
    const compound = new oc.TopoDS_Compound();
    const builder = new oc.BRep_Builder();
    builder.MakeCompound(compound);
    for (const s of retained.parts) builder.Add(compound, s);
    const o = new oc.Bnd_OBB_1();
    oc.BRepBndLib.AddOBB(compound, o, false, true, false);
    if (!o.IsVoid()) {
      const x = (v: OC): Vec3 => [v.X(), v.Y(), v.Z()];
      obb = { center: x(o.Center()), axes: [x(o.XDirection()), x(o.YDirection()), x(o.ZDirection())], halfSizes: [o.XHSize(), o.YHSize(), o.ZHSize()] };
    }
  } catch {
    warnings.push('Oriented bounding box could not be computed.');
  }

  const size: Vec3 = [modelBox.max[0] - modelBox.min[0], modelBox.max[1] - modelBox.min[1], modelBox.max[2] - modelBox.min[2]];
  const mesh: CadMeshBuffers = {
    positions: Float32Array.from(buf.positions),
    normals: Float32Array.from(buf.normals),
    indices: Uint32Array.from(buf.indices),
    triangleToFace: Uint32Array.from(buf.triToFace),
    edgeSegments: Float32Array.from(buf.segs),
    segmentToEdge: Uint32Array.from(buf.segToEdge),
    vertexPositions: Float32Array.from(buf.verts),
  };
  return {
    parts,
    faces,
    edges,
    vertices,
    mesh,
    bounds: {
      aabb: modelBox,
      size,
      center: scale(add(modelBox.min, modelBox.max), 0.5),
      diagonalMm: len(size),
      obb,
      volumeMm3: totalVolume,
      areaMm2: totalArea,
      quality: 'computed',
    },
    solidCount,
    shellCount,
    validation: { valid: allValid, messages },
    warnings,
    retained,
  };
}

export function faceSignature(f: CadFaceInfo): string {
  const parts: string[] = [f.kind, round(f.areaMm2, 3).toString(), fmtVec(f.centroid)];
  if (f.cylinder) parts.push(`r${round(f.cylinder.radiusMm, 6)}`);
  if (f.plane) parts.push(`n${fmtVec(f.plane.normal, 4)}`);
  return parts.join('|');
}

export function edgeSignature(e: CadEdgeInfo): string {
  const parts: string[] = [e.kind, round(e.lengthMm, 4).toString()];
  if (e.circle) parts.push(`c${fmtVec(e.circle.center)}r${round(e.circle.radiusMm, 6)}`);
  if (e.line) parts.push(`l${fmtVec(e.line.start)}>${fmtVec(e.line.end)}`);
  return parts.join('|');
}
