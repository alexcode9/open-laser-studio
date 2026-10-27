import { aDegToS, machineUToU, radius } from '@ols/geometry-adapters';
import type { Bounds, Project } from '@ols/shared-types';

/** Design-space workspace: galvo field (flat) or unwrapped surface (cylinder). */
export function workspaceBounds(p: Project): Bounds {
  if (p.mode === 'cylinder') return { minX: 0, minY: 0, maxX: p.workpiece.lengthMm, maxY: Math.PI * p.workpiece.diameterMm };
  return { minX: 0, minY: 0, maxX: p.machine.galvo.fieldWidthMm, maxY: p.machine.galvo.fieldHeightMm };
}

/**
 * Design-space position of the laser spot for a machine state. Cylinder mode inverts the
 * indexed mapping: `u = (U - U0) + sx (gx - cx)`, `s = s(A) + sy R asin((gy - cy) / R)`.
 */
export function headDesignPos(p: Project, gx: number, gy: number, aDeg: number, uMm: number): [number, number] {
  const g = p.machine.galvo;
  const fx = g.invertX ? g.fieldWidthMm - gx : gx;
  const fy = g.invertY ? g.fieldHeightMm - gy : gy;
  if (p.mode === 'flat') return [fx, fy];
  const sx = g.invertX ? -1 : 1;
  const sy = g.invertY ? -1 : 1;
  const r = radius(p.workpiece);
  const d = Math.max(-1, Math.min(1, (gy - g.centerYMm) / r));
  return [machineUToU(p.workpiece, uMm) + sx * (gx - g.centerXMm), aDegToS(p.workpiece, aDeg) + sy * r * Math.asin(d)];
}
