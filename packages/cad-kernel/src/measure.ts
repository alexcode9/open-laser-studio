import type { CadEdgeInfo, CadFaceInfo, CadMeasureRequest, CadMeasurement, CadReference, CadVertexInfo, MeasurementQuality, Vec3 } from '@ols/shared-types';

import { add, angleBetween, cross, dot, len, normalize, parallel, scale, sub } from './vec';

export interface MeasureTables {
  modelId: string;
  geometryRevision: string;
  exact: boolean;
  faces: CadFaceInfo[];
  edges: CadEdgeInfo[];
  vertices: CadVertexInfo[];
}

/** Exact kernel operations, available only when the B-Rep is retained. */
export interface ExactOps {
  /** Shortest distance between two topology entities (BRepExtrema). */
  shortest(a: CadReference, b: CadReference): { value: number; pa: Vec3; pb: Vec3; tolerance: number };
  /** Closest point on the exact face to `p`. */
  projectOnFace(face: number, p: Vec3): Vec3;
}

/** Tolerance reported for kernel extrema / projections (mm). */
export const EXTREMA_TOLERANCE_MM = 1e-7;
/** Planes count as parallel within this angle (rad). */
export const PARALLEL_TOL_RAD = 1e-6;

const RANK: Record<MeasurementQuality, number> = { analytical: 0, computed: 1, fitted: 2, 'mesh-derived': 3 };
export const worst = (...q: MeasurementQuality[]): MeasurementQuality => q.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'analytical');

export class MeasureError extends Error {
  code = 'INVALID_ARGUMENT';
}

let seq = 0;
const newId = () => `meas-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function measurement(m: Omit<CadMeasurement, 'id' | 'persistent' | 'stale'>): CadMeasurement {
  return { id: newId(), persistent: false, stale: false, ...m };
}

function face(t: MeasureTables, r: CadReference): CadFaceInfo {
  const f = r.index !== null ? t.faces[r.index] : undefined;
  if (!f) throw new MeasureError('reference is not a face of this model');
  return f;
}

function edge(t: MeasureTables, r: CadReference): CadEdgeInfo {
  const e = r.index !== null ? t.edges[r.index] : undefined;
  if (!e) throw new MeasureError('reference is not an edge of this model');
  return e;
}

/** Resolve a point-like reference to coordinates and provenance. */
function pointOf(t: MeasureTables, r: CadReference, exact: ExactOps | null): { p: Vec3; quality: MeasurementQuality; tol: number } {
  if (r.kind === 'vertex') {
    const v = r.index !== null ? t.vertices[r.index] : undefined;
    if (!v) throw new MeasureError('reference is not a vertex of this model');
    return { p: v.position, quality: 'analytical', tol: 0 };
  }
  if (r.kind === 'point' && r.point) {
    if (exact && r.onFace !== null && t.exact) return { p: exact.projectOnFace(r.onFace, r.point), quality: 'computed', tol: EXTREMA_TOLERANCE_MM };
    return { p: r.point, quality: 'mesh-derived', tol: 0 };
  }
  throw new MeasureError('point-to-point distance needs vertices or surface points');
}

/** Direction carried by a reference for angle measurements. */
function directionOf(t: MeasureTables, r: CadReference): { d: Vec3; line: boolean; at: Vec3; what: string; quality: MeasurementQuality } {
  if (r.kind === 'edge') {
    const e = edge(t, r);
    if (e.line) return { d: e.line.direction, line: true, at: scale(add(e.line.start, e.line.end), 0.5), what: 'line', quality: e.quality };
    if (e.circle) return { d: e.circle.normal, line: true, at: e.circle.center, what: 'circle axis', quality: e.quality };
    throw new MeasureError('angle needs straight edges, circular edges, planar faces or cylindrical axes');
  }
  if (r.kind === 'face') {
    const f = face(t, r);
    if (f.plane) return { d: f.plane.normal, line: false, at: f.centroid, what: 'plane', quality: f.quality };
    if (f.cylinder) return { d: f.cylinder.axisDirection, line: true, at: f.centroid, what: 'cylinder axis', quality: f.quality };
    if (f.cone) return { d: f.cone.axisDirection, line: true, at: f.centroid, what: 'cone axis', quality: f.quality };
  }
  throw new MeasureError('angle needs straight edges, circular edges, planar faces or cylindrical axes');
}

const rad2deg = (r: number) => (r * 180) / Math.PI;

export function runMeasure(t: MeasureTables, req: CadMeasureRequest, exact: ExactOps | null): CadMeasurement {
  const refs = 'refs' in req ? req.refs : 'b' in req ? [req.a, req.b] : [req.a];
  for (const r of refs) {
    if (r.modelId !== t.modelId) throw new MeasureError('references belong to a different model');
    if (r.geometryRevision !== t.geometryRevision) throw new MeasureError('reference is stale: the model geometry changed');
  }
  switch (req.kind) {
    case 'distance': {
      const pointLike = (r: CadReference) => r.kind === 'vertex' || r.kind === 'point';
      if (pointLike(req.a) && pointLike(req.b)) {
        const a = pointOf(t, req.a, exact);
        const b = pointOf(t, req.b, exact);
        const d = sub(b.p, a.p);
        return measurement({
          kind: 'distance',
          value: len(d),
          unit: 'mm',
          quality: worst(a.quality, b.quality),
          references: refs,
          tolerance: Math.max(a.tol, b.tol) || null,
          label: 'Point to point',
          anchors: [a.p, b.p],
          details: { dx: d[0], dy: d[1], dz: d[2] },
        });
      }
      return shortest(t, req.a, req.b, exact, 'Shortest distance');
    }
    case 'face-distance': {
      const fa = face(t, req.a);
      const fb = face(t, req.b);
      if (fa.plane && fb.plane && parallel(fa.plane.normal, fb.plane.normal, PARALLEL_TOL_RAD * (fa.quality === 'mesh-derived' ? 1e4 : 1))) {
        const n = normalize(fa.plane.normal);
        const sep = dot(sub(fb.plane.origin, fa.plane.origin), n);
        const pa = fa.centroid;
        const pb = add(pa, scale(n, dot(sub(fb.plane.origin, pa), n)));
        const details: CadMeasurement['details'] = { method: 'normal separation of parallel planes', signedMm: sep };
        if (exact && t.exact) {
          const s = exact.shortest(req.a, req.b);
          details.shortestMm = s.value;
        }
        return measurement({
          kind: 'plane-distance',
          value: Math.abs(sep),
          unit: 'mm',
          quality: worst(fa.quality, fb.quality),
          references: refs,
          tolerance: null,
          label: 'Parallel plane separation',
          anchors: [pa, pb],
          details,
        });
      }
      return shortest(t, req.a, req.b, exact, 'Shortest face-to-face distance');
    }
    case 'length': {
      const e = edge(t, req.a);
      const anchors: Vec3[] = e.line ? [e.line.start, e.line.end] : e.circle ? [e.circle.center] : [];
      return measurement({
        kind: 'length',
        value: e.lengthMm,
        unit: 'mm',
        quality: e.quality,
        references: refs,
        tolerance: e.lengthToleranceMm || null,
        label: `${e.kind} edge length`,
        anchors,
        details: { curve: e.kind, ...(e.circle ? { radiusMm: e.circle.radiusMm, arcDeg: rad2deg(e.circle.angularSpanRad) } : {}) },
      });
    }
    case 'radius': {
      const r = req.a;
      if (r.kind === 'edge') {
        const e = edge(t, r);
        if (!e.circle) throw new MeasureError('radius needs a circular edge or a cylindrical/spherical face');
        const u = anyPerpendicular(e.circle.normal);
        return measurement({
          kind: 'radius',
          value: e.circle.radiusMm,
          unit: 'mm',
          quality: e.quality,
          references: refs,
          tolerance: null,
          label: 'Circular edge',
          anchors: [e.circle.center, add(e.circle.center, scale(u, e.circle.radiusMm))],
          details: { diameterMm: e.circle.radiusMm * 2, cx: e.circle.center[0], cy: e.circle.center[1], cz: e.circle.center[2], nx: e.circle.normal[0], ny: e.circle.normal[1], nz: e.circle.normal[2] },
        });
      }
      const f = face(t, r);
      if (f.cylinder) {
        const c = f.cylinder;
        const along = dot(sub(f.centroid, c.axisOrigin), c.axisDirection);
        const onAxis = add(c.axisOrigin, scale(c.axisDirection, along));
        let u = sub(f.centroid, onAxis);
        u = len(u) > 1e-9 ? normalize(u) : anyPerpendicular(c.axisDirection);
        return measurement({
          kind: 'radius',
          value: c.radiusMm,
          unit: 'mm',
          quality: f.quality,
          references: refs,
          tolerance: null,
          label: c.angularSpanRad < 2 * Math.PI - 1e-6 ? 'Cylinder (partial face, full-cylinder radius)' : 'Cylinder',
          anchors: [onAxis, add(onAxis, scale(u, c.radiusMm))],
          details: {
            diameterMm: c.radiusMm * 2,
            ax: c.axisDirection[0],
            ay: c.axisDirection[1],
            az: c.axisDirection[2],
            ox: c.axisOrigin[0],
            oy: c.axisOrigin[1],
            oz: c.axisOrigin[2],
            faceArcDeg: rad2deg(c.angularSpanRad),
            ...(c.residualMm !== undefined ? { residualMm: c.residualMm } : {}),
          },
        });
      }
      if (f.sphere) {
        return measurement({
          kind: 'radius',
          value: f.sphere.radiusMm,
          unit: 'mm',
          quality: f.quality,
          references: refs,
          tolerance: null,
          label: 'Sphere',
          anchors: [f.sphere.center, f.centroid],
          details: { diameterMm: f.sphere.radiusMm * 2 },
        });
      }
      throw new MeasureError(f.quality === 'mesh-derived' ? 'mesh region has no fitted cylinder; use Fit cylinder first' : 'radius needs a circular edge or a cylindrical/spherical face');
    }
    case 'angle': {
      const a = directionOf(t, req.a);
      const b = directionOf(t, req.b);
      const theta = rad2deg(angleBetween(a.d, b.d));
      let value: number;
      let label: string;
      if (a.line && b.line) {
        value = Math.min(theta, 180 - theta);
        label = `Angle between ${a.what} and ${b.what} (unsigned)`;
      } else if (!a.line && !b.line) {
        value = theta;
        label = 'Angle between plane normals';
      } else {
        value = 90 - Math.min(theta, 180 - theta);
        label = `Angle between ${a.line ? a.what : b.what} and plane`;
      }
      return measurement({
        kind: 'angle',
        value,
        unit: 'deg',
        quality: worst(a.quality, b.quality),
        references: refs,
        tolerance: null,
        label,
        anchors: [a.at, b.at],
        details: { directedDeg: theta, supplementDeg: 180 - theta, oriented: !a.line && !b.line },
      });
    }
    case 'area': {
      if (req.refs.length === 0) throw new MeasureError('select at least one face');
      const fs = req.refs.map((r) => face(t, r));
      const total = fs.reduce((s, f) => s + f.areaMm2, 0);
      const c = scale(
        fs.reduce<Vec3>((s, f) => add(s, scale(f.centroid, f.areaMm2)), [0, 0, 0]),
        1 / Math.max(total, 1e-12),
      );
      return measurement({
        kind: 'area',
        value: total,
        unit: 'mm2',
        quality: worst(...fs.map((f) => (f.quality === 'analytical' ? 'computed' : f.quality))),
        references: refs,
        tolerance: null,
        label: fs.length > 1 ? `Area of ${fs.length} faces` : 'Face area',
        anchors: [c],
        details: { faceCount: fs.length },
      });
    }
  }
}

function shortest(t: MeasureTables, a: CadReference, b: CadReference, exact: ExactOps | null, label: string): CadMeasurement {
  if (!exact || !t.exact) throw new MeasureError('shortest distance between faces/edges needs exact CAD geometry');
  const s = exact.shortest(a, b);
  return measurement({
    kind: 'distance',
    value: s.value,
    unit: 'mm',
    quality: 'computed',
    references: [a, b],
    tolerance: s.tolerance,
    label,
    anchors: [s.pa, s.pb],
    details: { method: 'BRepExtrema minimum distance', dx: s.pb[0] - s.pa[0], dy: s.pb[1] - s.pa[1], dz: s.pb[2] - s.pa[2] },
  });
}

export function anyPerpendicular(d: Vec3): Vec3 {
  const n = normalize(d);
  const t: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(n, t));
}
