// Resolution of a raycast hit on the display mesh to B-Rep topology. The triangle gives the face
// (triangleToFace); edges and vertices are only searched among the hit face's own boundary, so a
// hidden edge behind the surface can never be picked.

import type { CadModelData, CadRefKind, CadReference, Vec3 } from '@ols/shared-types';

export type PickMode = 'auto' | 'face' | 'edge' | 'vertex';

export interface CadPick {
  modelId: string;
  kind: Extract<CadRefKind, 'face' | 'edge' | 'vertex'>;
  index: number;
  /** Hit point on the display mesh (model coordinates). */
  point: Vec3;
  /** Face the pick was made on. */
  face: number;
}

/** Screen-space tolerances in pixels. */
export const VERTEX_PICK_PX = 9;
export const EDGE_PICK_PX = 6;

function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
  const d: Vec3 = [ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t];
  return Math.hypot(d[0], d[1], d[2]);
}

export function edgeDistance(model: CadModelData, edge: number, p: Vec3): number {
  const e = model.edges[edge];
  if (!e) return Infinity;
  const s = model.mesh.edgeSegments;
  let best = Infinity;
  for (let k = e.segStart; k < e.segStart + e.segCount; k++) {
    const o = k * 6;
    best = Math.min(best, segmentDistance(p, [s[o]!, s[o + 1]!, s[o + 2]!], [s[o + 3]!, s[o + 4]!, s[o + 5]!]));
  }
  return best;
}

/**
 * @param triangle triangle index in `mesh.indices`
 * @param worldPerPixel model-space size of one screen pixel at the hit point
 */
export function resolvePick(model: CadModelData, triangle: number, point: Vec3, worldPerPixel: number, mode: PickMode): CadPick | null {
  const faceIndex = model.mesh.triangleToFace[triangle];
  if (faceIndex === undefined) return null;
  const face = model.faces[faceIndex];
  if (!face) return null;
  const base = { modelId: model.modelId, point, face: faceIndex };

  if (mode === 'auto' || mode === 'vertex') {
    let best = -1;
    let bestD = mode === 'vertex' ? Infinity : VERTEX_PICK_PX * worldPerPixel;
    for (const ei of face.edgeIndices) {
      for (const vi of model.edges[ei]?.vertexIndices ?? []) {
        const v = model.vertices[vi];
        if (!v) continue;
        const d = Math.hypot(v.position[0] - point[0], v.position[1] - point[1], v.position[2] - point[2]);
        if (d < bestD) {
          bestD = d;
          best = vi;
        }
      }
    }
    if (best >= 0) return { ...base, kind: 'vertex', index: best };
    if (mode === 'vertex') return null;
  }
  if (mode === 'auto' || mode === 'edge') {
    let best = -1;
    let bestD = mode === 'edge' ? Infinity : EDGE_PICK_PX * worldPerPixel;
    for (const ei of face.edgeIndices) {
      const d = edgeDistance(model, ei, point);
      if (d < bestD) {
        bestD = d;
        best = ei;
      }
    }
    if (best >= 0) return { ...base, kind: 'edge', index: best };
    if (mode === 'edge') return null;
  }
  return { ...base, kind: 'face', index: faceIndex };
}

export function samePick(a: CadPick | null, b: CadPick | null): boolean {
  return !!a && !!b && a.modelId === b.modelId && a.kind === b.kind && a.index === b.index;
}

/** Kernel reference for a pick. `asPoint` turns face picks into exact surface points. */
export function pickToReference(model: CadModelData, p: CadPick, asPoint = false): CadReference {
  const base = { modelId: model.modelId, geometryRevision: model.geometryRevision };
  if (asPoint && p.kind === 'face') return { ...base, kind: 'point', index: null, point: p.point, onFace: p.face, signature: model.faces[p.face]?.signature ?? null };
  const signature = p.kind === 'face' ? model.faces[p.index]?.signature : p.kind === 'edge' ? model.edges[p.index]?.signature : null;
  return { ...base, kind: p.kind, index: p.index, point: p.kind === 'vertex' ? (model.vertices[p.index]?.position ?? null) : null, onFace: null, signature: signature ?? null };
}

/** True when every indexed reference still matches the topology of the loaded model. */
export function referenceValid(model: CadModelData, r: CadReference): boolean {
  if (r.modelId !== model.modelId) return false;
  if (r.geometryRevision === model.geometryRevision) return true;
  if (r.signature === null) return false;
  if (r.kind === 'face') return model.faces[r.index ?? -1]?.signature === r.signature;
  if (r.kind === 'edge') return model.edges[r.index ?? -1]?.signature === r.signature;
  if (r.kind === 'point') return model.faces[r.onFace ?? -1]?.signature === r.signature;
  return false;
}
