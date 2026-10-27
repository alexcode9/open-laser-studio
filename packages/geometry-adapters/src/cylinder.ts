// Display-side mirror of crates/laser-geometry/src/cylinder.rs. Used only for UI readouts and
// overlays (rulers, seam lines, A/U labels); toolpaths are always computed in Rust. Both
// implementations are checked against tests/fixtures/coordinates.json.

import type { CylinderSpec } from '@ols/shared-types';

export const radius = (c: CylinderSpec): number => c.diameterMm / 2;
export const circumference = (c: CylinderSpec): number => Math.PI * c.diameterMm;

export function sToADeg(c: CylinderSpec, sMm: number): number {
  return c.angularZeroDeg + (c.rotationSign * sMm) / circumference(c) * 360;
}

export function aDegToS(c: CylinderSpec, aDeg: number): number {
  return ((aDeg - c.angularZeroDeg) * c.rotationSign) / 360 * circumference(c);
}

export const uToMachineU = (c: CylinderSpec, uMm: number): number => c.axialZeroMm + uMm;
export const machineUToU = (c: CylinderSpec, machineUMm: number): number => machineUMm - c.axialZeroMm;

export function surfaceToMachine(c: CylinderSpec, u: number, s: number): { aDeg: number; uMm: number } {
  return { aDeg: sToADeg(c, s), uMm: uToMachineU(c, u) };
}

export function wrapS(c: CylinderSpec, sMm: number): { rev: number; s: number } {
  const circ = circumference(c);
  const rev = Math.floor(sMm / circ);
  return { rev, s: sMm - rev * circ };
}

export function arcToGalvoOffset(c: CylinderSpec, dsMm: number): number {
  const r = radius(c);
  return r * Math.sin(dsMm / r);
}

export function focusErrorMm(c: CylinderSpec, dsMm: number): number {
  const r = radius(c);
  return r * (1 - Math.cos(dsMm / r));
}

/** Cylinder-local point for surface `(u, s)`: `(u, R cos(s/R), R sin(s/R))`. */
export function surfaceToLocal(c: CylinderSpec, u: number, s: number): [number, number, number] {
  const r = radius(c);
  const phi = s / r;
  return [u, r * Math.cos(phi), r * Math.sin(phi)];
}

/** Seam positions (s values that are whole circumferences) within `[s0, s1]`. */
export function seamLines(c: CylinderSpec, s0: number, s1: number): number[] {
  const circ = circumference(c);
  const out: number[] = [];
  for (let k = Math.ceil(s0 / circ); k * circ <= s1; k++) out.push(k * circ);
  return out;
}
