import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { CadModelData, CadReference, Vec3 } from '@ols/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { CadKernel, detectFormat } from './kernel';
import { cube3mf } from './threemf';
import { dot, len, normalize, pointLineDistance, sub } from './vec';

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/cad/${name}`, import.meta.url))));

const kernel = new CadKernel();
const cache = new Map<string, Promise<CadModelData>>();
const load = (name: string, unit?: 'mm' | 'in') => {
  const key = `${name}|${unit ?? ''}`;
  if (!cache.has(key)) cache.set(key, kernel.import(fixture(name), name, unit ? { unit } : {}));
  return cache.get(key)!;
};

const ref = (m: CadModelData, kind: CadReference['kind'], index: number | null, point: Vec3 | null = null, onFace: number | null = null): CadReference => ({
  modelId: m.modelId,
  geometryRevision: m.geometryRevision,
  kind,
  index,
  point,
  onFace,
  signature: null,
});

const near = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);
const parallelTo = (a: Vec3, b: Vec3) => near(Math.abs(dot(normalize(a), normalize(b))), 1, 1e-12);

beforeAll(async () => {
  await kernel.warmUp();
}, 120_000);

describe('format detection', () => {
  it('rejects unsupported and mislabelled files', () => {
    expect(() => detectFormat('x.obj', new Uint8Array([1, 2]))).toThrow(/unsupported/);
    expect(() => detectFormat('x.step', new TextEncoder().encode('hello'))).toThrow(/ISO-10303-21/);
    expect(detectFormat('anything.dat', new TextEncoder().encode('ISO-10303-21;\nHEADER;'))).toBe('step');
  });
});

describe('Test A: perfect cylinder Ø30 × 150', () => {
  it('detects the analytical cylinder, axis, extent and circumference', async () => {
    const m = await load('a-cylinder-30x150.step');
    expect(m.exact).toBe(true);
    expect(m.declaredUnit).toBe('millimetre');
    expect(m.stats).toMatchObject({ partCount: 1, solidCount: 1, faceCount: 3 });
    expect(m.features.cylinders).toHaveLength(1);
    const c = m.features.cylinders[0]!;
    near(c.radiusMm, 15);
    near(c.diameterMm, 30);
    near(c.lengthMm, 150);
    parallelTo(c.axisDirection, [0, 0, 1]);
    near(pointLineDistance([0, 0, 0], c.axisOrigin, c.axisDirection), 0);
    expect(c.fullRevolution).toBe(true);
    expect(c.inner).toBe(false);
    expect(c.quality).toBe('analytical');
    near(Math.PI * c.diameterMm, 94.24777960769379, 1e-9);
    near(m.bounds.size[0], 30, 1e-6);
    near(m.bounds.size[2], 150, 1e-6);
    near(m.bounds.volumeMm3!, Math.PI * 15 * 15 * 150, 1e-3);
    expect(m.features.axisCandidates[0]!.cylinderIds).toEqual([c.id]);
  });

  it('maps every display triangle back to a B-Rep face', async () => {
    const m = await load('a-cylinder-30x150.step');
    expect(m.mesh.triangleToFace.length).toBe(m.mesh.indices.length / 3);
    for (const f of m.faces) {
      expect(f.triCount).toBeGreaterThan(0);
      for (let t = f.triStart; t < f.triStart + f.triCount; t++) expect(m.mesh.triangleToFace[t]).toBe(f.index);
    }
    const cyl = m.faces.find((f) => f.kind === 'cylinder')!;
    // Display vertices of the cylindrical face lie on the analytical surface within the chordal deflection.
    const t = cyl.triStart * 3;
    const v = m.mesh.indices[t]!;
    const p: Vec3 = [m.mesh.positions[v * 3]!, m.mesh.positions[v * 3 + 1]!, m.mesh.positions[v * 3 + 2]!];
    near(Math.hypot(p[0], p[1]), 15, 1e-4);
  });

  it('measures radius analytically and projects surface points exactly', async () => {
    const m = await load('a-cylinder-30x150.step');
    const cyl = m.faces.find((f) => f.kind === 'cylinder')!;
    const r = await kernel.measure(m.modelId, { kind: 'radius', a: ref(m, 'face', cyl.index) });
    expect(r.quality).toBe('analytical');
    near(r.value, 15);
    near(Number(r.details.diameterMm), 30);
    // Two surface points picked slightly off the surface are projected onto the exact cylinder.
    const d = await kernel.measure(m.modelId, {
      kind: 'distance',
      a: ref(m, 'point', null, [15.01, 0, 10], cyl.index),
      b: ref(m, 'point', null, [-14.99, 0, 10], cyl.index),
    });
    expect(d.quality).toBe('computed');
    near(d.value, 30, 1e-6);
    const caps = m.faces.filter((f) => f.kind === 'plane');
    const sep = await kernel.measure(m.modelId, { kind: 'face-distance', a: ref(m, 'face', caps[0]!.index), b: ref(m, 'face', caps[1]!.index) });
    expect(sep.kind).toBe('plane-distance');
    near(sep.value, 150, 1e-9);
    const circle = m.edges.find((e) => e.kind === 'circle')!;
    const l = await kernel.measure(m.modelId, { kind: 'length', a: ref(m, 'edge', circle.index) });
    near(l.value, Math.PI * 30, 1e-9);
    const area = await kernel.measure(m.modelId, { kind: 'area', refs: [ref(m, 'face', cyl.index)] });
    near(area.value, Math.PI * 30 * 150, 1e-6);
  });

  it('rejects stale references', async () => {
    const m = await load('a-cylinder-30x150.step');
    await expect(kernel.measure(m.modelId, { kind: 'radius', a: { ...ref(m, 'face', 0), geometryRevision: 'other' } })).rejects.toThrow(/stale/);
  });
});

describe('Test B: stepped shaft', () => {
  it('finds two coaxial cylindrical regions with the right radii and overall extent', async () => {
    const m = await load('b-stepped-shaft.step');
    const outer = m.features.cylinders.filter((c) => c.inner === false).sort((a, b) => b.radiusMm - a.radiusMm);
    expect(outer).toHaveLength(2);
    near(outer[0]!.diameterMm, 30);
    near(outer[0]!.lengthMm, 80, 1e-7);
    near(outer[1]!.diameterMm, 20);
    near(outer[1]!.lengthMm, 50, 1e-7);
    parallelTo(outer[0]!.axisDirection, outer[1]!.axisDirection);
    near(pointLineDistance(outer[1]!.axisOrigin, outer[0]!.axisOrigin, outer[0]!.axisDirection), 0, 1e-9);
    const axis = m.features.axisCandidates[0]!;
    expect(axis.cylinderIds.sort()).toEqual(outer.map((c) => c.id).sort());
    expect(m.features.axisCandidates).toHaveLength(1);
    expect(axis.reason).toMatch(/axial extent 130 mm/);
    near(m.bounds.size[2], 130, 1e-6);
  });
});

describe('Test C: plate with hole', () => {
  it('reports dimensions, planes and the through-hole', async () => {
    const m = await load('c-plate-with-hole.step');
    near(m.bounds.size[0], 100, 1e-6);
    near(m.bounds.size[1], 60, 1e-6);
    near(m.bounds.size[2], 10, 1e-6);
    expect(m.features.planeFaceIndices).toHaveLength(6);
    const holes = m.features.circles.filter((c) => c.kind === 'hole');
    expect(holes).toHaveLength(1);
    const h = holes[0]!;
    near(h.diameterMm, 12);
    expect(h.through).toBe(true);
    near(h.depthMm!, 10, 1e-7);
    parallelTo(h.axisDirection, [0, 0, 1]);
    near(pointLineDistance([50, 30, 0], h.center, h.axisDirection), 0, 1e-9);
    const cyl = m.features.cylinders.find((c) => c.inner === true)!;
    expect(cyl).toBeDefined();
    // The bore must not be offered as a rotary axis ahead of nothing else; it is the only axis but weighted as inner.
    expect(m.features.axisCandidates[0]!.reason).toMatch(/0 outer/);
  });

  it('measures the plate thickness and the angle between faces', async () => {
    const m = await load('c-plate-with-hole.step');
    const planes = m.features.planeFaceIndices.map((i) => m.faces[i]!);
    const top = planes.find((f) => f.plane!.normal[2] > 0.99)!;
    const bottom = planes.find((f) => f.plane!.normal[2] < -0.99)!;
    const side = planes.find((f) => Math.abs(f.plane!.normal[0]) > 0.99)!;
    const t = await kernel.measure(m.modelId, { kind: 'face-distance', a: ref(m, 'face', top.index), b: ref(m, 'face', bottom.index) });
    near(t.value, 10, 1e-9);
    near(Number(t.details.shortestMm), 10, 1e-7);
    const a = await kernel.measure(m.modelId, { kind: 'angle', a: ref(m, 'face', top.index), b: ref(m, 'face', side.index) });
    near(a.value, 90, 1e-9);
    const v = m.vertices;
    const far = v.reduce((best, x) => (len(sub(x.position, v[0]!.position)) > len(sub(best.position, v[0]!.position)) ? x : best));
    const d = await kernel.measure(m.modelId, { kind: 'distance', a: ref(m, 'vertex', v[0]!.index), b: ref(m, 'vertex', far.index) });
    expect(d.quality).toBe('analytical');
    near(d.value, Math.hypot(100, 60, 10), 1e-9);
  });
});

describe('Test D: rotated cylinder', () => {
  it('detects the cylinder on its true axis without modifying coordinates', async () => {
    const m = await load('d-rotated-cylinder.step');
    const c = m.features.cylinders[0]!;
    near(c.diameterMm, 30);
    near(c.lengthMm, 150, 1e-7);
    parallelTo(c.axisDirection, [1 / 3, 2 / 3, 2 / 3]);
    near(pointLineDistance([12, -7, 5], c.axisOrigin, c.axisDirection), 0, 1e-9);
    // Axial extent starts at the base point (12, -7, 5).
    const t0 = dot(sub([12, -7, 5], c.axisOrigin), c.axisDirection);
    near(Math.min(Math.abs(c.axialMinMm - t0), Math.abs(c.axialMaxMm - t0)), 0, 1e-7);
  });
});

describe('Test E: low-resolution STL', () => {
  it('imports as a mesh, requires unit confirmation and never claims analytical precision', async () => {
    const m = await load('e-cylinder-lowres.stl');
    expect(m.exact).toBe(false);
    expect(m.unitsConfirmed).toBe(false);
    expect(m.bounds.quality).toBe('mesh-derived');
    expect(m.vertices).toHaveLength(0);
    // Side + two caps.
    expect(m.faces).toHaveLength(3);
    expect(m.faces.filter((f) => f.kind === 'plane')).toHaveLength(2);
    expect(m.faces.filter((f) => f.kind === 'plane').every((f) => f.quality === 'mesh-derived')).toBe(true);
    const side = m.faces.find((f) => f.kind === 'cylinder')!;
    expect(side.quality).toBe('fitted');
    expect(m.features.cylinders).toHaveLength(1);
    const c = m.features.cylinders[0]!;
    expect(c.quality).toBe('fitted');
    near(c.radiusMm, 15, 0.05);
    expect(c.residualMm).toBeDefined();
    expect(c.residualMm!).toBeLessThan(0.2);
    // A 16-gon inscribed in R = 15: the mesh area is smaller than the analytical cylinder.
    const exactSide = Math.PI * 30 * 150;
    expect(side.areaMm2).toBeLessThan(exactSide);
    near(side.areaMm2, 16 * 2 * 15 * Math.sin(Math.PI / 16) * 150, 1e-3);
    expect(m.bounds.volumeMm3).not.toBeNull();
    const r = await kernel.measure(m.modelId, { kind: 'radius', a: ref(m, 'face', side.index) });
    expect(r.quality).toBe('fitted');
    near(r.value, 15, 0.05);
    const caps = m.faces.filter((f) => f.kind === 'plane');
    const sep = await kernel.measure(m.modelId, { kind: 'face-distance', a: ref(m, 'face', caps[0]!.index), b: ref(m, 'face', caps[1]!.index) });
    expect(sep.quality).toBe('mesh-derived');
    near(sep.value, 150, 1e-3);
  });

  it('parses the ASCII variant identically and applies confirmed units', async () => {
    const bin = await load('e-cylinder-lowres.stl');
    const ascii = await load('e-cylinder-lowres-ascii.stl');
    expect(ascii.stats.triangleCount).toBe(bin.stats.triangleCount);
    near(ascii.bounds.size[2], bin.bounds.size[2], 1e-3);
    const inches = await load('e-cylinder-lowres.stl', 'in');
    expect(inches.unitsConfirmed).toBe(true);
    near(inches.bounds.size[2], 150 * 25.4, 1e-2);
    expect(inches.geometryRevision).not.toBe(bin.geometryRevision);
  });
});

describe('Test F: units', () => {
  it('normalises inch and millimetre files to identical geometry', async () => {
    const mm = await load('f-plate-mm.step');
    const inch = await load('f-plate-inch.step');
    expect(mm.declaredUnit).toBe('millimetre');
    expect(inch.declaredUnit.toUpperCase()).toBe('INCH');
    near(inch.unitScaleToMm, 25.4);
    for (let i = 0; i < 3; i++) near(inch.bounds.size[i]!, mm.bounds.size[i]!, 1e-6);
    near(inch.features.circles.find((c) => c.kind === 'hole')!.diameterMm, 12, 1e-9);
  });
});

describe('Test G: assembly', () => {
  it('preserves hierarchy, instance transforms, per-part and aggregate bounds', async () => {
    const m = await load('g-assembly.step');
    expect(m.tree).toHaveLength(1);
    const root = m.tree[0]!;
    expect(root.kind).toBe('assembly');
    expect(root.name).toBe('Fixture assembly');
    expect(root.children).toHaveLength(2);
    expect(m.parts).toHaveLength(2);
    const pin = m.parts.find((p) => p.name.startsWith('Pin'))!;
    const plate = m.parts.find((p) => p.name.startsWith('Plate'))!;
    near(pin.worldTransform[12]!, 100, 1e-9);
    near(pin.bounds.min[0], 90, 1e-6);
    near(pin.bounds.max[0], 110, 1e-6);
    // Plate rotated 90° about Z: x in [-30, 0], y in [0, 20].
    near(plate.bounds.min[0], -30, 1e-6);
    near(plate.bounds.max[1], 20, 1e-6);
    near(m.bounds.aabb.min[0], -30, 1e-6);
    near(m.bounds.aabb.max[0], 110, 1e-6);
    near(m.bounds.size[2], 40, 1e-6);
    const pinCyl = m.features.cylinders.find((c) => c.partIndex === pin.index)!;
    near(pinCyl.diameterMm, 20);
    near(pointLineDistance([100, 0, 0], pinCyl.axisOrigin, pinCyl.axisDirection), 0, 1e-9);
  });
});

describe('3MF import', () => {
  it('applies declared millimetre and inch units', async () => {
    const mm = await kernel.import(cube3mf(10, 'millimeter'), 'i-cube-10mm.3mf');
    expect(mm.sourceType).toBe('3mf');
    expect(mm.unitsConfirmed).toBe(true);
    expect(mm.declaredUnit.toLowerCase()).toMatch(/millimet/);
    near(mm.bounds.size[0], 10, 1e-6);
    near(mm.bounds.size[1], 10, 1e-6);
    near(mm.bounds.size[2], 10, 1e-6);
    const inch = await kernel.import(cube3mf(10, 'inch'), 'i-cube-10inch.3mf');
    expect(inch.unitsConfirmed).toBe(true);
    near(inch.unitScaleToMm, 25.4);
    near(inch.bounds.size[0], 254, 1e-4);
  });
});

describe('section plane', () => {
  it('intersects the analytical cylinder in a circle of circumference πD', async () => {
    const m = await load('a-cylinder-30x150.step');
    const s = await kernel.section(m.modelId, [0, 0, 75], [0, 0, 1]);
    expect(s.quality).toBe('computed');
    expect(s.polylines.length).toBeGreaterThan(0);
    near(s.lengthMm, Math.PI * 30, 0.05);
  });

  it('intersects the STL cylinder as a mesh-derived polygon shorter than the true circle', async () => {
    const m = await load('e-cylinder-lowres.stl');
    const s = await kernel.section(m.modelId, [0, 0, 75], [0, 0, 1]);
    expect(s.quality).toBe('mesh-derived');
    const nGon = 16 * 2 * 15 * Math.sin(Math.PI / 16);
    near(s.lengthMm, nGon, 0.05);
    expect(s.lengthMm).toBeLessThan(Math.PI * 30);
  });
});
