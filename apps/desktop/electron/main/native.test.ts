// Contract tests between the Rust core (via the built napi module) and the TypeScript side.
// Skipped when the native module has not been built (`pnpm build:native`).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { transformPoint } from '@ols/cad-kernel';
import { InputSchemas, ProjectSchema } from '@ols/ipc-contracts';
import type { CadAlignParams, Project, SessionSnapshot, Vec3 } from '@ols/shared-types';
import { describe, expect, it } from 'vitest';

import { loadNative, type NativeModule, type NativeSimSession } from './native';

const appPath = fileURLToPath(new URL('../..', import.meta.url));
const available = existsSync(fileURLToPath(new URL('../../native/laser_node.node', import.meta.url))) || !!process.env.OLS_NATIVE_PATH;
const native = (): NativeModule => loadNative(appPath, appPath);

function runUntil(s: NativeSimSession, pred: (x: SessionSnapshot) => boolean, maxS: number): SessionSnapshot {
  let snap = s.snapshot();
  for (let t = 0; t < maxS && !pred(snap); t += 0.05) snap = s.tick(0.05);
  return snap;
}

describe.skipIf(!available)('native core contract', () => {
  it('reports API version 3', () => {
    expect(native().nativeInfo().apiVersion).toBe(3);
  });

  it('refuses discover/identify while simulationOnly or without developer mode', async () => {
    const n = native();
    await expect(n.discoverDevices({ transport: 'usb', timeoutMs: 250, simulationOnly: true, developerMode: true })).rejects.toThrow(/SAFETY/);
    await expect(n.discoverDevices({ transport: 'usb', timeoutMs: 250, simulationOnly: false, developerMode: false })).rejects.toThrow(/SAFETY/);
    await expect(n.identifyDevice({ host: '127.0.0.1', simulationOnly: true, developerMode: true })).rejects.toThrow(/SAFETY/);
    await expect(n.identifyDevice({ host: '127.0.0.1', simulationOnly: false, developerMode: false })).rejects.toThrow(/SAFETY/);
  });

  it('sample project passes the IPC schema and survives normalize + .ols roundtrip', () => {
    const n = native();
    const p = n.sampleProject();
    const parsed = ProjectSchema.safeParse(p);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
    expect(n.normalizeProject(p)).toEqual(p);
    const { project } = n.loadOls(n.saveOls(p, null, []));
    expect(project).toEqual(p);
    const flat: Project = { ...p, mode: 'flat' };
    expect(ProjectSchema.safeParse(n.normalizeProject(flat)).success).toBe(true);
  });

  it('CAD alignment matches the shared fixture when applied as a column-major Mat4', () => {
    const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/cad_alignment.json', import.meta.url)), 'utf8')) as {
      tolerance: number;
      cases: { name: string; params: CadAlignParams; lengthMm: number; points: { model: Vec3; workpiece: Vec3 }[] }[];
    };
    for (const c of fx.cases) {
      expect(InputSchemas['cad:alignToRotary'].safeParse(c.params).success, c.name).toBe(true);
      const r = native().cadAlignToRotary(c.params);
      expect(r.modelToWorkpiece).toHaveLength(16);
      expect(Math.abs(r.lengthMm - c.lengthMm)).toBeLessThan(fx.tolerance);
      for (const p of c.points) {
        const got = transformPoint(r.modelToWorkpiece, p.model);
        const back = transformPoint(r.workpieceToModel, p.workpiece);
        for (let i = 0; i < 3; i++) {
          expect(Math.abs(got[i]! - p.workpiece[i]!), `${c.name} ${p.model}`).toBeLessThan(fx.tolerance);
          expect(Math.abs(back[i]! - p.model[i]!)).toBeLessThan(fx.tolerance);
        }
      }
    }
    expect(() => native().cadAlignToRotary({ ...fx.cases[0]!.params, axisDirection: [0, 0, 0] })).toThrow(/INVALID_ARGUMENT/);
  });

  it('CAD workspace survives the .ols roundtrip with its embedded source file', () => {
    const n = native();
    const step = Buffer.from(readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/cad/a-cylinder-30x150.step', import.meta.url))));
    const sha = createHash('sha256').update(step).digest('hex');
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const p: Project = {
      ...n.sampleProject(),
      cad: {
        models: [
          {
            id: 'm1', name: 'cyl', fileName: 'a.step', sourceType: 'step', declaredUnit: 'millimetre', unitScaleToMm: 1, unitsConfirmed: true,
            sha256: sha, byteLength: step.length, assetPath: '', geometryRevision: 'rev', kernelVersion: 'k', deflectionMm: 0.06,
            sourceToModel: id, modelToWorkpiece: id, hiddenParts: [],
          },
        ],
        measurements: [
          {
            id: 'meas-1', kind: 'diameter', value: 30, unit: 'mm', quality: 'analytical', tolerance: 0, label: 'Ø 30.000 mm', anchors: [[0, 15, 75]],
            references: [{ modelId: 'm1', geometryRevision: 'rev', kind: 'face', index: 0, point: null, onFace: null, signature: 'cyl:r15' }],
            details: { radiusMm: 15, note: 'x', exact: true, extra: null }, persistent: true, stale: false,
          },
        ],
        activeWorkpiece: null,
        displayUnit: 'mm',
        displayPrecision: 3,
      },
    };
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    const loaded = n.loadOls(n.saveOls(p, null, [{ path: 'x', sha256: sha, data: step }]));
    expect(loaded.warnings).toEqual([]);
    expect(loaded.cadFiles).toHaveLength(1);
    expect(Buffer.compare(loaded.cadFiles[0]!.data, step)).toBe(0);
    expect(loaded.project.cad!.models[0]!.assetPath).toBe(`cad/${sha}.step`);
    expect(loaded.project.cad!.measurements).toEqual(p.cad!.measurements);
    expect(loaded.project.schemaVersion).toBe(2);
    expect(() => n.saveOls(p, null, [])).toThrow(/not provided/);
  });

  it('mesh request schema accepts what the renderer sends', () => {
    const p = native().sampleProject();
    expect(InputSchemas['geometry:cylinderMesh'].safeParse({ spec: p.workpiece, toleranceMm: 0.05, axialSegments: 8 }).success).toBe(true);
  });

  it('simulated job runs to completion with explicit arming', async () => {
    const n = native();
    const p = n.sampleProject();
    const plan = await n.planToolpath(p);
    expect(plan.summary.executable).toBe(true);
    expect(plan.summary.errors).toEqual([]);
    const s = new n.SimSession(p);
    expect(s.snapshot().simulated).toBe(true);
    s.connect();
    let snap = runUntil(s, (x) => x.f1Connected && x.axesConnected, 10);
    expect(snap.f1Connected && snap.axesConnected).toBe(true);
    s.home();
    snap = runUntil(s, (x) => !x.homing, 120);
    expect(s.prepare().ok).toBe(true);
    expect(() => s.arm(false)).toThrow();
    expect(() => s.start()).toThrow(); // not armed
    s.arm(true);
    s.start();
    snap = runUntil(s, (x) => x.outcome !== null, 600);
    expect(snap.outcome?.type).toBe('completed');
    expect(snap.laserOn).toBe(false);
    expect(snap.armed).toBe(false);
  });

  it('e-stop latches and requires confirmed reset with hardware released', () => {
    const n = native();
    const s = new n.SimSession(n.sampleProject());
    s.connect();
    runUntil(s, (x) => x.f1Connected, 10);
    s.emergencyStop('test');
    let snap = s.tick(0.05);
    expect(snap.safetyState).toBe('ESTOP');
    expect(() => s.resetEstop(true, false)).toThrow();
    expect(() => s.connect()).toThrow();
    snap = runUntil(s, () => false, 2);
    expect(snap.safetyState).toBe('ESTOP'); // never clears on its own
    s.resetEstop(true, true);
    expect(s.snapshot().safetyState).not.toBe('ESTOP');
  });
});
