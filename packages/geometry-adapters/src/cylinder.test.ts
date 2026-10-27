import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { CylinderSpec } from '@ols/shared-types';
import { describe, expect, it } from 'vitest';

import {
  aDegToS,
  arcToGalvoOffset,
  correctedStepsPerUnit,
  focusErrorMm,
  linearStepsPerMm,
  machineUToU,
  normalizePath,
  pathBounds,
  rotaryStepsPerDeg,
  seamLines,
  surfaceToMachine,
  toSvgPathData,
  wrapS,
} from './index';

interface Fixture {
  tolerance: number;
  cases: { name: string; spec: CylinderSpec; surface: { u: number; s: number }; machine: { aDeg: number; uMm: number } }[];
  galvo: { diameterMm: number; dsMm: number; offsetMm: number; focusErrorMm: number }[];
  wrap: { diameterMm: number; sMm: number; rev: number; sWrapped: number }[];
}

const fx = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../tests/fixtures/coordinates.json', import.meta.url)), 'utf8'),
) as Fixture;

const spec = (diameterMm: number): CylinderSpec => ({
  diameterMm,
  lengthMm: 200,
  angularZeroDeg: 0,
  axialZeroMm: 0,
  rotationSign: 1,
});

describe('cylinder adapters match the shared Rust fixtures', () => {
  for (const c of fx.cases) {
    it(c.name, () => {
      const m = surfaceToMachine(c.spec, c.surface.u, c.surface.s);
      expect(Math.abs(m.aDeg - c.machine.aDeg)).toBeLessThan(fx.tolerance);
      expect(Math.abs(m.uMm - c.machine.uMm)).toBeLessThan(fx.tolerance);
      expect(Math.abs(aDegToS(c.spec, m.aDeg) - c.surface.s)).toBeLessThan(fx.tolerance);
      expect(Math.abs(machineUToU(c.spec, m.uMm) - c.surface.u)).toBeLessThan(fx.tolerance);
    });
  }

  it('galvo arc projection and focus error', () => {
    for (const g of fx.galvo) {
      expect(Math.abs(arcToGalvoOffset(spec(g.diameterMm), g.dsMm) - g.offsetMm)).toBeLessThan(fx.tolerance);
      expect(Math.abs(focusErrorMm(spec(g.diameterMm), g.dsMm) - g.focusErrorMm)).toBeLessThan(fx.tolerance);
    }
  });

  it('seam wrapping', () => {
    for (const w of fx.wrap) {
      const r = wrapS(spec(w.diameterMm), w.sMm);
      expect(r.rev).toBe(w.rev);
      expect(Math.abs(r.s - w.sWrapped)).toBeLessThan(fx.tolerance);
    }
    expect(seamLines(spec(30), 0, 200)).toHaveLength(3);
  });
});

describe('path helpers', () => {
  it('formats svg path data and bounds', () => {
    const cmds = [
      { t: 'M', x: 10, y: 5 },
      { t: 'L', x: 20, y: 5 },
      { t: 'C', x1: 25, y1: 0, x2: 25, y2: 15, x: 20, y: 10 },
      { t: 'Z' },
    ] as const;
    expect(toSvgPathData(cmds)).toBe('M10 5 L20 5 C25 0 25 15 20 10 Z');
    expect(pathBounds(cmds)).toEqual({ minX: 10, minY: 0, maxX: 25, maxY: 15 });
    const n = normalizePath(cmds);
    expect(n.dx).toBe(10);
    expect(pathBounds(n.commands)).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 15 });
  });
});

describe('calibration helpers', () => {
  it('matches spec section 13 mechanics', () => {
    expect(rotaryStepsPerDeg(200, 16, 3)).toBeCloseTo(26.6667, 4);
    expect(linearStepsPerMm(200, 16, 1, 2)).toBe(1600);
    expect(correctedStepsPerUnit(1600, 100, 98)).toBeCloseTo(1632.653, 3);
    expect(Number.isNaN(correctedStepsPerUnit(1600, 100, 0))).toBe(true);
  });
});
