import type { Aabb, Mat4, Vec3 } from '@ols/shared-types';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** Unsigned angle between two vectors in [0, π]. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c = dot(normalize(a), normalize(b));
  const s = len(cross(normalize(a), normalize(b)));
  return Math.atan2(s, c);
}

/** Distance from point `p` to the infinite line through `o` with unit direction `d`. */
export function pointLineDistance(p: Vec3, o: Vec3, d: Vec3): number {
  return len(cross(sub(p, o), d));
}

/** Directions are parallel (or anti-parallel) within `tolRad`. */
export function parallel(a: Vec3, b: Vec3, tolRad: number): boolean {
  return Math.abs(dot(normalize(a), normalize(b))) >= Math.cos(tolRad);
}

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function scaleMatrix(s: number): Mat4 {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

export function transformDir(m: Mat4, d: Vec3): Vec3 {
  return [m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2], m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2], m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2]];
}

export function emptyAabb(): Aabb {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function growAabb(b: Aabb, p: Vec3): void {
  for (let i = 0; i < 3; i++) {
    if (p[i]! < b.min[i]!) b.min[i] = p[i]!;
    if (p[i]! > b.max[i]!) b.max[i] = p[i]!;
  }
}

export function unionAabb(a: Aabb, b: Aabb): Aabb {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

export const fmtVec = (v: Vec3, digits = 3): string => v.map((x) => round(x, digits)).join(',');
