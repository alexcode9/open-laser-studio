import { describe, expect, it } from 'vitest';

import { fitCircle, fitCylinder, smallestEigenvector } from './fit';

describe('cylinder fitting primitives', () => {
  it('recovers the smallest eigenvector of a rank-2 projector', () => {
    // Projector onto XY: n n^T for n = Z is zero in Z; sum of XY normals has smallest eig along Z.
    const v = smallestEigenvector(2, 0, 0, 2, 0, 0);
    expect(Math.abs(v[2]!)).toBeGreaterThan(0.99);
  });

  it('fits a circle of known radius', () => {
    const xy: [number, number][] = Array.from({ length: 24 }, (_, i) => {
      const a = (2 * Math.PI * i) / 24;
      return [10 + 5 * Math.cos(a), -3 + 5 * Math.sin(a)] as [number, number];
    });
    const c = fitCircle(xy)!;
    expect(Math.abs(c.radius - 5)).toBeLessThan(1e-6);
    expect(Math.hypot(c.center[0] - 10, c.center[1] + 3)).toBeLessThan(1e-6);
    expect(c.rms).toBeLessThan(1e-6);
  });

  it('fits a Z-aligned cylinder from noisy-free samples', () => {
    const points = Array.from({ length: 32 }, (_, i) => {
      const a = (2 * Math.PI * i) / 16;
      const z = i < 16 ? 0 : 40;
      return [8 * Math.cos(a), 8 * Math.sin(a), z] as [number, number, number];
    });
    const normals = Array.from({ length: 16 }, (_, i) => {
      const a = (2 * Math.PI * i) / 16;
      return [Math.cos(a), Math.sin(a), 0] as [number, number, number];
    });
    const c = fitCylinder({ points, normals })!;
    expect(Math.abs(c.radiusMm - 8)).toBeLessThan(1e-6);
    expect(Math.abs(c.axisDirection[2]!)).toBeGreaterThan(0.99);
    expect(c.axialMaxMm - c.axialMinMm).toBeCloseTo(40, 6);
    expect(c.residualMm).toBeLessThan(1e-6);
  });
});
