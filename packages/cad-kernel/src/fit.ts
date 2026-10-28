// Least-squares cylinder fit for mesh regions. The result is always `fitted`: it is an ideal
// cylinder approximating samples, never an analytical CAD surface. Residual is RMS radial error.

import type { CadCylinderInfo, Vec3 } from '@ols/shared-types';

import { add, cross, dot, len, normalize, scale, sub } from './vec';

/** Reject a fit whose RMS residual exceeds this fraction of the radius. */
export const MAX_RESIDUAL_RATIO = 0.12;
const MIN_POINTS = 8;
const MIN_RADIUS_MM = 1e-3;

/** Smallest eigenvector of a 3×3 symmetric matrix (Jacobi rotations). */
export function smallestEigenvector(s00: number, s01: number, s02: number, s11: number, s12: number, s22: number): Vec3 {
  const a = [
    [s00, s01, s02],
    [s01, s11, s12],
    [s02, s12, s22],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iter = 0; iter < 32; iter++) {
    let p = 0;
    let q = 1;
    let max = Math.abs(a[0]![1]!);
    if (Math.abs(a[0]![2]!) > max) {
      p = 0;
      q = 2;
      max = Math.abs(a[0]![2]!);
    }
    if (Math.abs(a[1]![2]!) > max) {
      p = 1;
      q = 2;
      max = Math.abs(a[1]![2]!);
    }
    if (max < 1e-18) break;
    const theta = 0.5 * Math.atan2(2 * a[p]![q]!, a[q]![q]! - a[p]![p]!);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const app = a[p]![p]!;
    const aqq = a[q]![q]!;
    const apq = a[p]![q]!;
    a[p]![p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q]![q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p]![q] = 0;
    a[q]![p] = 0;
    for (let r = 0; r < 3; r++) {
      if (r === p || r === q) continue;
      const arp = a[r]![p]!;
      const arq = a[r]![q]!;
      a[r]![p] = a[p]![r] = c * arp - s * arq;
      a[r]![q] = a[q]![r] = s * arp + c * arq;
    }
    for (let r = 0; r < 3; r++) {
      const vrp = v[r]![p]!;
      const vrq = v[r]![q]!;
      v[r]![p] = c * vrp - s * vrq;
      v[r]![q] = s * vrp + c * vrq;
    }
  }
  let best = 0;
  for (let i = 1; i < 3; i++) if (a[i]![i]! < a[best]![best]!) best = i;
  return normalize([v[0]![best]!, v[1]![best]!, v[2]![best]!]);
}

/** Algebraic circle fit in 2D, refined with a few Gauss–Newton steps. */
export function fitCircle(xy: [number, number][]): { center: [number, number]; radius: number; rms: number } | null {
  if (xy.length < MIN_POINTS) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const [x, y] of xy) {
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const n = xy.length;
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [D; E; F] = -[sxz; syz; sz] for x²+y²+Dx+Ey+F=0.
  const m00 = sxx;
  const m01 = sxy;
  const m02 = sx;
  const m11 = syy;
  const m12 = sy;
  const m22 = n;
  const det =
    m00 * (m11 * m22 - m12 * m12) - m01 * (m01 * m22 - m12 * m02) + m02 * (m01 * m12 - m11 * m02);
  if (Math.abs(det) < 1e-18) return null;
  const inv00 = (m11 * m22 - m12 * m12) / det;
  const inv01 = (m02 * m12 - m01 * m22) / det;
  const inv02 = (m01 * m12 - m02 * m11) / det;
  const inv11 = (m00 * m22 - m02 * m02) / det;
  const inv12 = (m02 * m01 - m00 * m12) / det;
  const inv22 = (m00 * m11 - m01 * m01) / det;
  const d = -(inv00 * sxz + inv01 * syz + inv02 * sz);
  const e = -(inv01 * sxz + inv11 * syz + inv12 * sz);
  const f = -(inv02 * sxz + inv12 * syz + inv22 * sz);
  let cx = -d / 2;
  let cy = -e / 2;
  let r = Math.sqrt(Math.max(0, cx * cx + cy * cy - f));
  for (let k = 0; k < 8; k++) {
    let j00 = 0;
    let j01 = 0;
    let j02 = 0;
    let j11 = 0;
    let j12 = 0;
    let j22 = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (const [x, y] of xy) {
      const dx = x - cx;
      const dy = y - cy;
      const dxy = Math.hypot(dx, dy);
      if (dxy < 1e-12) continue;
      const res = dxy - r;
      const g0 = -dx / dxy;
      const g1 = -dy / dxy;
      const g2 = -1;
      j00 += g0 * g0;
      j01 += g0 * g1;
      j02 += g0 * g2;
      j11 += g1 * g1;
      j12 += g1 * g2;
      j22 += g2 * g2;
      b0 -= g0 * res;
      b1 -= g1 * res;
      b2 -= g2 * res;
    }
    const jd = j00 * (j11 * j22 - j12 * j12) - j01 * (j01 * j22 - j12 * j02) + j02 * (j01 * j12 - j11 * j02);
    if (Math.abs(jd) < 1e-18) break;
    const i00 = (j11 * j22 - j12 * j12) / jd;
    const i01 = (j02 * j12 - j01 * j22) / jd;
    const i02 = (j01 * j12 - j02 * j11) / jd;
    const i11 = (j00 * j22 - j02 * j02) / jd;
    const i12 = (j02 * j01 - j00 * j12) / jd;
    const i22 = (j00 * j11 - j01 * j01) / jd;
    cx += i00 * b0 + i01 * b1 + i02 * b2;
    cy += i01 * b0 + i11 * b1 + i12 * b2;
    r += i02 * b0 + i12 * b1 + i22 * b2;
  }
  if (!(r > MIN_RADIUS_MM) || !Number.isFinite(r)) return null;
  let ss = 0;
  for (const [x, y] of xy) ss += (Math.hypot(x - cx, y - cy) - r) ** 2;
  return { center: [cx, cy], radius: r, rms: Math.sqrt(ss / xy.length) };
}

export interface FitSample {
  points: Vec3[];
  normals: Vec3[];
}

/**
 * Fit a cylinder to a mesh region. `normals` are per-triangle (or per-point) estimates used
 * only to recover the axis; they are not assumed to be CAD surface normals.
 */
export function fitCylinder(sample: FitSample): CadCylinderInfo | null {
  const { points, normals } = sample;
  if (points.length < MIN_POINTS || normals.length < 3) return null;
  let s00 = 0;
  let s01 = 0;
  let s02 = 0;
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  for (const n of normals) {
    const u = normalize(n);
    s00 += u[0] * u[0];
    s01 += u[0] * u[1];
    s02 += u[0] * u[2];
    s11 += u[1] * u[1];
    s12 += u[1] * u[2];
    s22 += u[2] * u[2];
  }
  const axis = smallestEigenvector(s00, s01, s02, s11, s12, s22);
  if (len(axis) < 0.5) return null;
  const dir = canonical(axis);
  const origin: Vec3 = [0, 0, 0];
  const e0 = perp(dir);
  const e1 = cross(dir, e0);
  const xy: [number, number][] = points.map((p) => [dot(sub(p, origin), e0), dot(sub(p, origin), e1)]);
  const circle = fitCircle(xy);
  if (!circle) return null;
  if (circle.rms > MAX_RESIDUAL_RATIO * circle.radius) return null;
  const axisOrigin = add(add(origin, scale(e0, circle.center[0])), scale(e1, circle.center[1]));
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const t = dot(sub(p, axisOrigin), dir);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  if (!(hi - lo > MIN_RADIUS_MM)) return null;
  return {
    radiusMm: circle.radius,
    axisOrigin,
    axisDirection: dir,
    axialMinMm: lo,
    axialMaxMm: hi,
    angularSpanRad: 2 * Math.PI,
    inner: null,
    residualMm: circle.rms,
  };
}

function canonical(d: Vec3): Vec3 {
  for (const c of d) {
    if (Math.abs(c) > 1e-9) return c < 0 ? scale(d, -1) : d;
  }
  return d;
}

function perp(d: Vec3): Vec3 {
  return normalize(cross(Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], d));
}

/** Unique vertices and triangle normals of a contiguous face in a triangle mesh. */
export function sampleFace(positions: ArrayLike<number>, indices: ArrayLike<number>, triStart: number, triCount: number): FitSample {
  const seen = new Set<number>();
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[(triStart + t) * 3]!;
    const i1 = indices[(triStart + t) * 3 + 1]!;
    const i2 = indices[(triStart + t) * 3 + 2]!;
    const p = (i: number): Vec3 => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    const a = p(i0);
    const b = p(i1);
    const c = p(i2);
    const n = cross(sub(b, a), sub(c, a));
    if (len(n) > 0) normals.push(normalize(n));
    for (const i of [i0, i1, i2]) {
      if (seen.has(i)) continue;
      seen.add(i);
      points.push(p(i));
    }
  }
  return { points, normals };
}
