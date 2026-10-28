// Cutting-plane sections. STEP uses the CAD kernel (BRepAlgoAPI_Section); meshes are clipped
// triangle-by-triangle. Results are always classified (`computed` vs `mesh-derived`).

import type { CadSection, Vec3 } from '@ols/shared-types';

import type { RetainedBrep } from './brep';
import { type OC, progress } from './occt';
import { add, cross, dist, dot, len, normalize, scale, sub } from './vec';

const pt = (p: OC): Vec3 => [p.X(), p.Y(), p.Z()];

function joinSegments(segs: [Vec3, Vec3][], tol: number): Vec3[][] {
  const used = new Array(segs.length).fill(false);
  const chains: Vec3[][] = [];
  const close = (a: Vec3, b: Vec3) => dist(a, b) < tol;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = [...segs[i]!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const [a, b] = segs[j]!;
        if (close(chain[chain.length - 1]!, a)) {
          chain.push(b);
          used[j] = true;
          grew = true;
        } else if (close(chain[chain.length - 1]!, b)) {
          chain.push(a);
          used[j] = true;
          grew = true;
        } else if (close(chain[0]!, b)) {
          chain.unshift(a);
          used[j] = true;
          grew = true;
        } else if (close(chain[0]!, a)) {
          chain.unshift(b);
          used[j] = true;
          grew = true;
        }
      }
    }
    if (chain.length >= 2) chains.push(chain);
  }
  return chains;
}

function lengthOf(polylines: Vec3[][]): number {
  let n = 0;
  for (const c of polylines) for (let i = 1; i < c.length; i++) n += dist(c[i - 1]!, c[i]!);
  return n;
}

function clipTriangle(a: Vec3, b: Vec3, c: Vec3, origin: Vec3, n: Vec3): [Vec3, Vec3] | null {
  const h = (p: Vec3) => dot(sub(p, origin), n);
  const pts = [a, b, c];
  const hs = pts.map(h);
  const hits: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const ha = hs[i]!;
    const hb = hs[j]!;
    if (Math.abs(ha) < 1e-9) hits.push(pts[i]!);
    if (ha === 0 || hb === 0) continue;
    if (ha * hb < 0) {
      const t = ha / (ha - hb);
      hits.push(add(pts[i]!, scale(sub(pts[j]!, pts[i]!), t)));
    }
  }
  // Deduplicate.
  const uniq: Vec3[] = [];
  for (const p of hits) if (!uniq.some((q) => dist(p, q) < 1e-9)) uniq.push(p);
  return uniq.length >= 2 ? [uniq[0]!, uniq[1]!] : null;
}

export function sectionMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, origin: Vec3, normal: Vec3): CadSection {
  const n = normalize(normal);
  if (len(n) < 0.5) throw Object.assign(new Error('section plane normal must be non-zero'), { code: 'INVALID_ARGUMENT' });
  const segs: [Vec3, Vec3][] = [];
  const p = (i: number): Vec3 => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
  for (let t = 0; t < indices.length / 3; t++) {
    const hit = clipTriangle(p(indices[t * 3]!), p(indices[t * 3 + 1]!), p(indices[t * 3 + 2]!), origin, n);
    if (hit && dist(hit[0], hit[1]) > 1e-8) segs.push(hit);
  }
  const boxDiag = Math.hypot(
    ...([0, 1, 2] as const).map((k) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        lo = Math.min(lo, positions[i + k]!);
        hi = Math.max(hi, positions[i + k]!);
      }
      return hi - lo;
    }),
  );
  const polylines = joinSegments(segs, Math.max(1e-6, boxDiag * 1e-6));
  return { origin, normal: n, polylines, lengthMm: lengthOf(polylines), quality: 'mesh-derived' };
}

export function sectionBrep(oc: OC, brep: RetainedBrep, origin: Vec3, normal: Vec3): CadSection {
  const n = normalize(normal);
  if (len(n) < 0.5) throw Object.assign(new Error('section plane normal must be non-zero'), { code: 'INVALID_ARGUMENT' });
  const pln = new oc.gp_Pln_3(new oc.gp_Pnt_3(...origin), new oc.gp_Dir_4(...n));
  const segs: [Vec3, Vec3][] = [];
  let lengthMm = 0;
  for (const shape of brep.parts) {
    const sec = new oc.BRepAlgoAPI_Section_5(shape, pln, false);
    sec.ComputePCurveOn1(false);
    sec.Approximation(true);
    sec.Build(progress(oc));
    if (!sec.IsDone()) continue;
    const result = sec.Shape();
    const exp = new oc.TopExp_Explorer_2(result, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (exp.More()) {
      const edge = oc.TopoDS.Edge_1(exp.Current());
      if (!oc.BRep_Tool.Degenerated(edge)) {
        const adaptor = new oc.BRepAdaptor_Curve_2(edge);
        try {
          lengthMm += oc.GCPnts_AbscissaPoint.Length_3(adaptor, 1e-7) as number;
        } catch {
          lengthMm += Math.abs(adaptor.LastParameter() - adaptor.FirstParameter());
        }
        const d = new oc.GCPnts_QuasiUniformDeflection_2(adaptor, 0.02, oc.GeomAbs_Shape.GeomAbs_C1);
        if (d.IsDone() && d.NbPoints() >= 2) {
          let prev = pt(d.Value(1));
          for (let k = 2; k <= d.NbPoints(); k++) {
            const cur = pt(d.Value(k));
            if (dist(prev, cur) > 1e-9) segs.push([prev, cur]);
            prev = cur;
          }
        }
      }
      exp.Next();
    }
  }
  const polylines = joinSegments(segs, 1e-4);
  return { origin, normal: n, polylines, lengthMm, quality: 'computed' };
}

export function planeThrough(origin: Vec3, normal: Vec3, size: number): { points: Vec3[]; n: Vec3 } {
  const n = normalize(normal);
  const t = normalize(cross(Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n));
  const b = cross(n, t);
  const h = size / 2;
  const at = (u: number, v: number): Vec3 => add(add(origin, scale(t, u)), scale(b, v));
  return { points: [at(-h, -h), at(h, -h), at(h, h), at(-h, h)], n };
}
