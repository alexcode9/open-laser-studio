import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CadKernel } from '@ols/cad-kernel';
import type { CadModelRef } from '@ols/shared-types';
import { describe, expect, it } from 'vitest';

import type { KernelReply, KernelRequest } from '../cad/protocol';
import { CadHost, DEFAULT_CAD_LIMITS, type KernelChild, cadAssetPath, sha256Hex } from './cad';

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../tests/fixtures/cad/${name}`, import.meta.url))));

/** In-process stand-in for the utility process; `hang` makes it swallow requests. */
function fakeKernel(opts: { hang?: (r: KernelRequest) => boolean } = {}) {
  const stats = { spawned: 0, killed: 0 };
  const spawn = (): KernelChild => {
    stats.spawned++;
    const kernel = new CadKernel();
    let onMsg: (m: KernelReply) => void = () => {};
    let onExit: (c: number) => void = () => {};
    let dead = false;
    const reply = (m: KernelReply) => {
      if (!dead) onMsg(m);
    };
    return {
      postMessage: (r) => {
        if (opts.hang?.(r)) return;
        const run = async (): Promise<unknown> => {
          if (r.op === 'warmUp') return kernel.warmUp();
          if (r.op === 'import') return kernel.import(r.bytes, r.fileName, r.options, (stage, fraction) => reply({ id: r.id, type: 'progress', stage, fraction }), r.modelId);
          if (r.op === 'measure') return kernel.measure(r.modelId, r.request);
          if (r.op === 'section') return kernel.section(r.modelId, r.origin, r.normal);
          return kernel.release(r.modelId);
        };
        run().then(
          (value) => reply({ id: r.id, type: 'result', value }),
          (e: unknown) => reply({ id: r.id, type: 'error', error: { code: (e as { code?: string }).code ?? 'KERNEL', message: String((e as Error).message) } }),
        );
      },
      onMessage: (fn) => (onMsg = fn),
      onExit: (fn) => (onExit = fn),
      kill: () => {
        stats.killed++;
        dead = true;
        onExit(1);
      },
    };
  };
  return { spawn, stats };
}

const refOf = (d: Awaited<ReturnType<CadHost['import']>>): CadModelRef => ({
  id: d.modelId,
  name: d.name,
  fileName: d.fileName,
  sourceType: d.sourceType,
  declaredUnit: d.declaredUnit,
  unitScaleToMm: d.unitScaleToMm,
  unitsConfirmed: d.unitsConfirmed,
  sha256: d.sha256,
  byteLength: d.byteLength,
  assetPath: cadAssetPath(d.sha256, d.sourceType),
  geometryRevision: d.geometryRevision,
  kernelVersion: d.kernelVersion,
  deflectionMm: d.deflectionMm,
  sourceToModel: d.sourceToModel,
  modelToWorkpiece: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  hiddenParts: [],
});

describe('CadHost', () => {
  it('imports with progress, measures, and survives a kernel restart', async () => {
    const k = fakeKernel();
    const host = new CadHost(k.spawn);
    const stages: string[] = [];
    const m = await host.import(fixture('a-cylinder-30x150.step'), 'a.step', {}, 'r1', (s) => stages.push(s));
    expect(stages).toContain('meshing');
    expect(stages.at(-1)).toBe('done');
    const face = m.faces.find((f) => f.kind === 'cylinder')!;
    const ref = { modelId: m.modelId, geometryRevision: m.geometryRevision, kind: 'face' as const, index: face.index, point: null, onFace: null, signature: null };
    expect((await host.measure(m.modelId, { kind: 'radius', a: ref })).value).toBeCloseTo(15, 12);
    const cut = await host.section(m.modelId, [0, 0, 75], [0, 0, 1]);
    expect(cut.lengthMm).toBeCloseTo(Math.PI * 30, 1);

    // A crash drops resident models; the host reloads from the retained bytes transparently.
    host.dispose();
    expect((await host.measure(m.modelId, { kind: 'radius', a: ref })).value).toBeCloseTo(15, 12);
    expect(k.stats.spawned).toBe(2);
  }, 120_000);

  it('cancels an in-flight import by restarting the kernel', async () => {
    const k = fakeKernel({ hang: (r) => r.op === 'import' && r.fileName === 'hang.step' });
    const host = new CadHost(k.spawn);
    const p = host.import(fixture('a-cylinder-30x150.step'), 'hang.step', {}, 'r-cancel');
    expect(host.cancel('r-cancel')).toBe(true);
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
    expect(k.stats.killed).toBe(1);
    expect(host.cancel('r-cancel')).toBe(false);
    expect(host.loadedModels()).toHaveLength(0);
  });

  it('times out a hung kernel', async () => {
    const k = fakeKernel({ hang: () => true });
    const host = new CadHost(k.spawn, { ...DEFAULT_CAD_LIMITS, importTimeoutMs: 50 });
    await expect(host.import(fixture('a-cylinder-30x150.step'), 'a.step', {}, 'r')).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(k.stats.killed).toBe(1);
  });

  it('enforces the file size limit before touching the kernel', async () => {
    const k = fakeKernel();
    const host = new CadHost(k.spawn, { ...DEFAULT_CAD_LIMITS, maxFileBytes: 100 });
    await expect(host.import(new Uint8Array(101), 'a.step', {}, 'r')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(k.stats.spawned).toBe(0);
  });

  it('reports parse errors from malformed files', async () => {
    const host = new CadHost(fakeKernel().spawn);
    const junk = new TextEncoder().encode('ISO-10303-21;\nHEADER;\nthis is not a step file\n');
    await expect(host.import(junk, 'bad.step', {}, 'r')).rejects.toMatchObject({ code: 'PARSE' });
  }, 120_000);

  it('confirms STL units by re-importing under the same model id', async () => {
    const host = new CadHost(fakeKernel().spawn);
    const m = await host.import(fixture('e-cylinder-lowres.stl'), 'e.stl', {}, 'r');
    expect(m.unitsConfirmed).toBe(false);
    const c = await host.confirmUnits(m.modelId, 'cm', 'r2');
    expect(c.modelId).toBe(m.modelId);
    expect(c.unitsConfirmed).toBe(true);
    expect(c.bounds.size[2]).toBeCloseTo(1500, 3);
  });

  it('provides files for saving and restores models from a reopened project', async () => {
    const host = new CadHost(fakeKernel().spawn);
    const m = await host.import(fixture('c-plate-with-hole.step'), 'c.step', {}, 'r');
    const ref = refOf(m);
    const files = host.filesFor([ref, ref]);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe(`cad/${m.sha256}.step`);
    expect(sha256Hex(files[0]!.bytes)).toBe(m.sha256);

    // A fresh session (app restart) only has the files read from the .ols container.
    const reopened = new CadHost(fakeKernel().spawn);
    expect(() => reopened.filesFor([ref])).toThrow(/not available/);
    reopened.stashFiles([{ sha256: files[0]!.sha256, bytes: files[0]!.bytes }]);
    const r = await reopened.restore(ref, 'r3');
    expect(r.status).toBe('ok');
    expect(r.data!.modelId).toBe(m.modelId);
    expect(r.data!.geometryRevision).toBe(m.geometryRevision);

    const tampered = new CadHost(fakeKernel().spawn);
    const bad = new Uint8Array(files[0]!.bytes);
    bad[100] = bad[100]! ^ 1;
    tampered.stashFiles([{ sha256: m.sha256, bytes: bad }]);
    expect((await tampered.restore(ref, 'r4')).status).toBe('missing');
    expect((await new CadHost(fakeKernel().spawn).restore(ref, 'r5')).status).toBe('missing');
  }, 120_000);
});
