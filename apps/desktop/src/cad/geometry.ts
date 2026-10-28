// three.js geometry for analysed CAD models, shared by the CAD viewer and the cylinder preview.
// Built once per CadModelData and disposed when the model is replaced or released.

import type { CadModelData } from '@ols/shared-types';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

import { useCad } from '@/stores/cad';

export interface ModelGeometry {
  mesh: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  vertices: THREE.BufferGeometry;
}

const cache = new Map<CadModelData, ModelGeometry>();

export function modelGeometry(d: CadModelData): ModelGeometry {
  let g = cache.get(d);
  if (g) return g;
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.BufferAttribute(d.mesh.positions, 3));
  mesh.setAttribute('normal', new THREE.BufferAttribute(d.mesh.normals, 3));
  mesh.setIndex(new THREE.BufferAttribute(d.mesh.indices, 1));
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  // BVH-accelerated raycasting keeps picking interactive on large models.
  if (d.mesh.indices.length > 0) mesh.boundsTree = new MeshBVH(mesh);
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.BufferAttribute(d.mesh.edgeSegments, 3));
  const vertices = new THREE.BufferGeometry();
  vertices.setAttribute('position', new THREE.BufferAttribute(d.mesh.vertexPositions, 3));
  g = { mesh, edges, vertices };
  cache.set(d, g);
  return g;
}

/** Geometry with only the given triangles of `base` (shares the vertex attributes). */
export function triangleSubset(base: THREE.BufferGeometry, ranges: [start: number, count: number][]): THREE.BufferGeometry {
  const src = base.getIndex()!.array as Uint32Array;
  const total = ranges.reduce((n, [, c]) => n + c, 0);
  const idx = new Uint32Array(total * 3);
  let o = 0;
  for (const [s, c] of ranges) {
    idx.set(src.subarray(s * 3, (s + c) * 3), o);
    o += c * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('normal', base.getAttribute('normal'));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Index buffer without the triangles of hidden parts, with a map back to the original triangles. */
export function visibleTriangles(d: CadModelData, hiddenParts: number[]): { index: Uint32Array; triMap: Uint32Array } | null {
  if (hiddenParts.length === 0) return null;
  const hidden = new Set(hiddenParts);
  const keep: number[] = [];
  for (const f of d.faces) if (!hidden.has(f.partIndex)) for (let t = f.triStart; t < f.triStart + f.triCount; t++) keep.push(t);
  const triMap = Uint32Array.from(keep);
  const index = new Uint32Array(triMap.length * 3);
  for (let i = 0; i < triMap.length; i++) index.set(d.mesh.indices.subarray(triMap[i]! * 3, triMap[i]! * 3 + 3), i * 3);
  return { index, triMap };
}

export function edgePoints(d: CadModelData, edges: number[]): Float32Array {
  const segs = edges.reduce((n, e) => n + (d.edges[e]?.segCount ?? 0), 0);
  const out = new Float32Array(segs * 6);
  let o = 0;
  for (const e of edges) {
    const info = d.edges[e];
    if (!info) continue;
    out.set(d.mesh.edgeSegments.subarray(info.segStart * 6, (info.segStart + info.segCount) * 6), o);
    o += info.segCount * 6;
  }
  return out;
}

function dispose(g: ModelGeometry): void {
  g.mesh.boundsTree = undefined;
  g.mesh.dispose();
  g.edges.dispose();
  g.vertices.dispose();
}

useCad.subscribe((s, prev) => {
  if (s.models === prev.models) return;
  const live = new Set(Object.values(s.models));
  for (const [d, g] of cache) {
    if (!live.has(d)) {
      dispose(g);
      cache.delete(d);
    }
  }
});
