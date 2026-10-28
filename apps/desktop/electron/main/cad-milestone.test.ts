// Milestone flow without the UI: import the Ø30 × 150 STEP cylinder, pick its cylindrical face via
// the viewer's pick resolution, align it to the rotary axis in Rust and populate the workpiece.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CadKernel, transformPoint } from '@ols/cad-kernel';
import { ProjectSchema } from '@ols/ipc-contracts';
import type { CadModelData, Project, Vec3 } from '@ols/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { pickToReference, referenceValid, resolvePick } from '../../src/cad/picking';
import { alignParamsFor, applyWorkpiece, clearWorkpiece, cylinderForFace, modelRefFor, rankCylinders } from '../../src/cad/workpiece';
import { loadNative, type NativeModule } from './native';

const appPath = fileURLToPath(new URL('../..', import.meta.url));
const nativeAvailable = existsSync(fileURLToPath(new URL('../../native/laser_node.node', import.meta.url))) || !!process.env.OLS_NATIVE_PATH;
const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/cad/${name}`, import.meta.url))));

const kernel = new CadKernel();
let cyl: CadModelData;
let shaft: CadModelData;
let plate: CadModelData;

beforeAll(async () => {
  await kernel.warmUp();
  cyl = await kernel.import(fixture('a-cylinder-30x150.step'), 'a-cylinder-30x150.step', {});
  shaft = await kernel.import(fixture('b-stepped-shaft.step'), 'b-stepped-shaft.step', {});
  plate = await kernel.import(fixture('c-plate-with-hole.step'), 'c-plate-with-hole.step', {});
}, 180_000);

function vertex(m: CadModelData, i: number): Vec3 {
  const p = m.mesh.positions;
  return [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
}

function triangleCentroid(m: CadModelData, tri: number): Vec3 {
  const [a, b, c] = [0, 1, 2].map((k) => vertex(m, m.mesh.indices[tri * 3 + k]!));
  return [0, 1, 2].map((k) => (a![k]! + b![k]! + c![k]!) / 3) as Vec3;
}

const cylinderFace = (m: CadModelData) => m.faces.find((f) => f.kind === 'cylinder')!;

describe('viewer pick resolution', () => {
  it('resolves triangle hits to the B-Rep face, edge or vertex', () => {
    const face = cylinderFace(cyl);
    const tri = face.triStart + Math.floor(face.triCount / 2);
    const wpp = 0.1;

    const onFace = resolvePick(cyl, tri, triangleCentroid(cyl, tri), wpp, 'auto');
    expect(onFace).toMatchObject({ kind: 'face', index: face.index, face: face.index });

    const circle = face.edgeIndices.map((e) => cyl.edges[e]!).find((e) => e.kind === 'circle')!;
    const s = cyl.mesh.edgeSegments;
    const k = (circle.segStart + Math.floor(circle.segCount / 2)) * 6;
    const mid: Vec3 = [(s[k]! + s[k + 3]!) / 2, (s[k + 1]! + s[k + 4]!) / 2, (s[k + 2]! + s[k + 5]!) / 2];
    expect(resolvePick(cyl, tri, mid, wpp, 'auto')).toMatchObject({ kind: 'edge', index: circle.index });
    expect(resolvePick(cyl, tri, mid, wpp, 'face')).toMatchObject({ kind: 'face' });

    const v = cyl.vertices[circle.vertexIndices[0]!]!;
    expect(resolvePick(cyl, tri, v.position, wpp, 'auto')).toMatchObject({ kind: 'vertex', index: v.index });
  });

  it('builds kernel references that survive re-analysis only when the topology matches', () => {
    const face = cylinderFace(cyl);
    const pick = resolvePick(cyl, face.triStart, triangleCentroid(cyl, face.triStart), 0.1, 'face')!;
    const ref = pickToReference(cyl, pick);
    expect(ref).toMatchObject({ kind: 'face', index: face.index, signature: face.signature });
    const asPoint = pickToReference(cyl, pick, true);
    expect(asPoint).toMatchObject({ kind: 'point', index: null, onFace: face.index });

    expect(referenceValid(cyl, { ...ref, geometryRevision: 'older' })).toBe(true);
    expect(referenceValid(cyl, { ...ref, geometryRevision: 'older', signature: 'other' })).toBe(false);
    expect(referenceValid(cyl, { ...ref, modelId: 'another' })).toBe(false);
  });
});

describe('workpiece candidates', () => {
  it('offers only outer full cylinders and never a bore', () => {
    const ranked = rankCylinders(plate);
    expect(ranked.every((r) => !r.usable)).toBe(true);
    expect(ranked.some((r) => r.problem === 'Inner surface (bore/hole)')).toBe(true);
  });

  it('ranks the stepped shaft cylinders and maps every cylindrical face to its feature', () => {
    const ranked = rankCylinders(shaft);
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => r.usable)).toBe(true);
    expect(ranked[0]!.feature.diameterMm).toBeCloseTo(30, 9);
    expect(ranked[0]!.reason).toMatch(/axial extent 130 mm/);
    for (const f of shaft.faces.filter((x) => x.kind === 'cylinder')) expect(cylinderForFace(shaft, f.index)).not.toBeNull();
  });
});

describe.skipIf(!nativeAvailable)('milestone: STEP cylinder → rotary workpiece', () => {
  const native = (): NativeModule => loadNative(appPath, appPath);

  it('aligns the picked cylinder and populates the cylinder workspace in one transformation', () => {
    const n = native();
    const face = cylinderFace(cyl);
    const pick = resolvePick(cyl, face.triStart, triangleCentroid(cyl, face.triStart), 0.1, 'face')!;
    const feature = cylinderForFace(cyl, pick.index)!;
    expect(cyl.name).toBe('a-cylinder-30x150');
    expect(feature.diameterMm).toBeCloseTo(30, 9);
    expect(rankCylinders(cyl)[0]!.feature.id).toBe(feature.id);

    const alignment = n.cadAlignToRotary(alignParamsFor(feature, 0, false));
    expect(alignment.lengthMm).toBeCloseTo(150, 9);

    const base = n.sampleProject();
    const withModel: Project = { ...base, cad: { models: [modelRefFor(cyl)], measurements: [], activeWorkpiece: null, displayUnit: 'mm', displayPrecision: 3 } };
    const p = applyWorkpiece(withModel, { model: cyl, cylinder: feature, seamAngleDeg: 0, reversed: false, alignment });

    expect(p.mode).toBe('cylinder');
    expect(p.workpiece.diameterMm).toBeCloseTo(30, 9);
    expect(p.workpiece.lengthMm).toBeCloseTo(150, 9);
    // Machine calibration is untouched.
    expect(p.machine).toEqual(base.machine);
    expect(p.workpiece.angularZeroDeg).toBe(base.workpiece.angularZeroDeg);
    expect(p.workpiece.axialZeroMm).toBe(base.workpiece.axialZeroMm);

    // The axis maps onto +X from u = 0 to u = L; the surface lies at radius 15.
    const m2w = p.cad!.activeWorkpiece!.modelToWorkpiece;
    const a0 = transformPoint(m2w, feature.axisOrigin);
    const dir = feature.axisDirection;
    const end: Vec3 = [0, 1, 2].map((k) => feature.axisOrigin[k]! + dir[k]! * feature.axialMaxMm) as Vec3;
    const start: Vec3 = [0, 1, 2].map((k) => feature.axisOrigin[k]! + dir[k]! * feature.axialMinMm) as Vec3;
    expect(transformPoint(m2w, start).map((c) => Math.abs(c) < 1e-9 ? 0 : c)).toEqual([0, 0, 0]);
    const e = transformPoint(m2w, end);
    expect(e[0]).toBeCloseTo(150, 9);
    expect(Math.hypot(e[1], e[2])).toBeLessThan(1e-9);
    expect(Math.hypot(a0[1], a0[2])).toBeLessThan(1e-9);
    for (let i = 0; i < cyl.vertices.length; i++) {
      const w = transformPoint(m2w, cyl.vertices[i]!.position);
      expect(Math.hypot(w[1], w[2])).toBeCloseTo(15, 9);
    }

    const parsed = ProjectSchema.safeParse(p);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
    expect(n.normalizeProject(p)).toEqual(p);

    const bytes = Buffer.from(fixture('a-cylinder-30x150.step'));
    const loaded = n.loadOls(n.saveOls(p, null, [{ path: `cad/${cyl.sha256}.step`, sha256: cyl.sha256, data: bytes }]));
    expect(loaded.warnings).toEqual([]);
    expect(loaded.project.cad?.activeWorkpiece).toEqual(p.cad!.activeWorkpiece);
    expect(loaded.project.workpiece).toEqual(p.workpiece);

    const detached = clearWorkpiece(p);
    expect(detached.cad!.activeWorkpiece).toBeNull();
    expect(detached.workpiece).toEqual(p.workpiece);
  });
});
