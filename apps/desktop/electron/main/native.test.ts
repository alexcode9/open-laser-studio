// Contract tests between the Rust core (via the built napi module) and the TypeScript side.
// Skipped when the native module has not been built (`pnpm build:native`).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { InputSchemas, ProjectSchema } from '@ols/ipc-contracts';
import type { Project, SessionSnapshot } from '@ols/shared-types';
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
  it('reports API version 1', () => {
    expect(native().nativeInfo().apiVersion).toBe(1);
  });

  it('sample project passes the IPC schema and survives normalize + .ols roundtrip', () => {
    const n = native();
    const p = n.sampleProject();
    const parsed = ProjectSchema.safeParse(p);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
    expect(n.normalizeProject(p)).toEqual(p);
    const { project } = n.loadOls(n.saveOls(p, null));
    expect(project).toEqual(p);
    const flat: Project = { ...p, mode: 'flat' };
    expect(ProjectSchema.safeParse(n.normalizeProject(flat)).success).toBe(true);
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
