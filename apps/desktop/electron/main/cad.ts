// Main-process side of CAD import: owns the kernel utility process, routes requests to it,
// enforces size/time limits, and keeps the source bytes of every loaded model so the kernel can
// be restarted (cancel, crash, timeout) without losing models and so the files can be embedded
// in the .ols container on save.

import { createHash, randomUUID } from 'node:crypto';

import type { CadImportOptions, CadImportStage, CadMeasureRequest, CadMeasurement, CadModelData, CadModelRef, CadRestoreResult, CadSection, GeometrySourceType, SourceLengthUnit, Vec3 } from '@ols/shared-types';
import { UNIT_TO_MM } from '@ols/shared-types';

import type { KernelCall, KernelReply, KernelRequest } from '../cad/protocol';

export interface KernelChild {
  postMessage(m: KernelRequest): void;
  onMessage(fn: (m: KernelReply) => void): void;
  onExit(fn: (code: number) => void): void;
  kill(): void;
}

export type SpawnKernel = () => KernelChild;

export interface CadLimits {
  maxFileBytes: number;
  importTimeoutMs: number;
  measureTimeoutMs: number;
  maxModels: number;
}

export const DEFAULT_CAD_LIMITS: CadLimits = {
  maxFileBytes: 200 * 1024 * 1024,
  importTimeoutMs: 10 * 60_000,
  measureTimeoutMs: 60_000,
  maxModels: 16,
};

export type ProgressSink = (stage: CadImportStage, fraction: number) => void;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: ProgressSink;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ModelSource {
  bytes: Uint8Array;
  fileName: string;
  options: CadImportOptions;
  sha256: string;
  sourceType: GeometrySourceType;
}

export interface CadFile {
  path: string;
  sha256: string;
  bytes: Uint8Array;
}

const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code });

export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Archive path of a CAD source file inside the .ols container. */
export const cadAssetPath = (sha: string, type: GeometrySourceType): string => `cad/${sha}.${type}`;

function unitForScale(scale: number): SourceLengthUnit | undefined {
  return (Object.keys(UNIT_TO_MM) as SourceLengthUnit[]).find((u) => Math.abs(UNIT_TO_MM[u] - scale) < 1e-12);
}

export class CadHost {
  private child: KernelChild | null = null;
  private seq = 1;
  private readonly pending = new Map<number, Pending>();
  /** Models currently resident in the kernel process. */
  private readonly resident = new Set<string>();
  private readonly sources = new Map<string, ModelSource>();
  /** Source files from the last opened project, by checksum, awaiting `restore`. */
  private stash = new Map<string, Uint8Array>();
  private readonly importsByRequest = new Map<string, number>();

  constructor(
    private readonly spawn: SpawnKernel,
    private readonly limits: CadLimits = DEFAULT_CAD_LIMITS,
    private readonly log: (msg: string, data?: Record<string, unknown>) => void = () => {},
  ) {}

  /** Start the kernel early; the wasm takes several seconds to initialise. */
  warmUp(): void {
    this.call({ op: 'warmUp' }, this.limits.importTimeoutMs).catch((e: unknown) => this.log('cad kernel warm-up failed', { error: String(e) }));
  }

  async import(bytes: Uint8Array, fileName: string, options: CadImportOptions, requestId: string, onProgress?: ProgressSink): Promise<CadModelData> {
    if (bytes.byteLength > this.limits.maxFileBytes) throw fail('INVALID_ARGUMENT', `file exceeds the ${Math.round(this.limits.maxFileBytes / 1048576)} MB import limit`);
    if (bytes.byteLength === 0) throw fail('INVALID_ARGUMENT', 'file is empty');
    if (this.sources.size >= this.limits.maxModels) throw fail('INVALID_STATE', `at most ${this.limits.maxModels} CAD models can be open`);
    const modelId = randomUUID();
    const data = await this.load(modelId, bytes, fileName, options, requestId, onProgress);
    return data;
  }

  /** Cancel an in-flight import. The kernel process is terminated and restarted on demand. */
  cancel(requestId: string): boolean {
    const id = this.importsByRequest.get(requestId);
    if (id === undefined || !this.pending.has(id)) return false;
    this.restartKernel('ABORTED', 'import cancelled');
    return true;
  }

  async confirmUnits(modelId: string, unit: SourceLengthUnit, requestId: string, onProgress?: ProgressSink): Promise<CadModelData> {
    const src = this.sources.get(modelId);
    if (!src) throw fail('NOT_FOUND', 'model is not loaded');
    if (src.sourceType !== 'stl' && src.sourceType !== '3mf') throw fail('INVALID_ARGUMENT', 'units of exact CAD files come from the file itself');
    return this.load(modelId, src.bytes, src.fileName, { ...src.options, unit }, requestId, onProgress);
  }

  async measure(modelId: string, request: CadMeasureRequest): Promise<CadMeasurement> {
    await this.ensureResident(modelId);
    return (await this.call({ op: 'measure', modelId, request }, this.limits.measureTimeoutMs)) as CadMeasurement;
  }

  async section(modelId: string, origin: Vec3, normal: Vec3): Promise<CadSection> {
    await this.ensureResident(modelId);
    return (await this.call({ op: 'section', modelId, origin, normal }, this.limits.measureTimeoutMs)) as CadSection;
  }

  async release(modelId: string): Promise<boolean> {
    const known = this.sources.delete(modelId);
    if (this.resident.delete(modelId) && this.child) await this.call({ op: 'release', modelId }, this.limits.measureTimeoutMs).catch(() => false);
    return known;
  }

  /** Remember the CAD files of a freshly opened project until the renderer restores its models. */
  stashFiles(files: { sha256: string; bytes: Uint8Array }[]): void {
    this.stash = new Map(files.map((f) => [f.sha256, f.bytes]));
  }

  /** Re-import a persisted model from its embedded source file. */
  async restore(ref: CadModelRef, requestId: string, onProgress?: ProgressSink): Promise<CadRestoreResult> {
    const bytes = this.sources.get(ref.id)?.bytes ?? this.stash.get(ref.sha256);
    if (!bytes) return { modelId: ref.id, status: 'missing', message: `The source file of "${ref.name}" is not in the project.`, data: null };
    if (sha256Hex(bytes) !== ref.sha256) return { modelId: ref.id, status: 'missing', message: `The embedded file of "${ref.name}" failed its checksum.`, data: null };
    const mesh = ref.sourceType !== 'step';
    const unit = mesh && ref.unitsConfirmed ? unitForScale(ref.unitScaleToMm) : undefined;
    const options: CadImportOptions = { ...(ref.deflectionMm > 0 ? { deflectionMm: ref.deflectionMm } : {}), ...(unit ? { unit } : {}) };
    const data = await this.load(ref.id, bytes, ref.fileName, options, requestId, onProgress);
    if (data.geometryRevision !== ref.geometryRevision) {
      return { modelId: ref.id, status: 'changed', message: `"${ref.name}" was re-analysed by a different kernel version; saved references were re-validated.`, data };
    }
    return { modelId: ref.id, status: 'ok', message: null, data };
  }

  /** Source files for the models of a project being saved. */
  filesFor(models: CadModelRef[]): CadFile[] {
    const out: CadFile[] = [];
    const seen = new Set<string>();
    for (const m of models) {
      const bytes = this.sources.get(m.id)?.bytes ?? this.stash.get(m.sha256);
      if (!bytes) throw fail('NOT_FOUND', `the source file of CAD model "${m.name}" is not available`);
      const path = cadAssetPath(m.sha256, m.sourceType);
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, sha256: m.sha256, bytes });
    }
    return out;
  }

  loadedModels(): string[] {
    return [...this.sources.keys()];
  }

  dispose(): void {
    this.restartKernel('ABORTED', 'shutting down');
  }

  private async load(modelId: string, bytes: Uint8Array, fileName: string, options: CadImportOptions, requestId: string, onProgress?: ProgressSink): Promise<CadModelData> {
    const id = this.seq;
    this.importsByRequest.set(requestId, id);
    try {
      const data = (await this.call({ op: 'import', bytes, fileName, options, modelId }, this.limits.importTimeoutMs, onProgress)) as CadModelData;
      this.resident.add(modelId);
      this.sources.set(modelId, { bytes, fileName, options, sha256: data.sha256, sourceType: data.sourceType });
      return data;
    } finally {
      this.importsByRequest.delete(requestId);
    }
  }

  private async ensureResident(modelId: string): Promise<void> {
    if (this.resident.has(modelId)) return;
    const src = this.sources.get(modelId);
    if (!src) throw fail('NOT_FOUND', 'model is not loaded');
    this.log('cad model reloaded after kernel restart', { modelId });
    await this.call({ op: 'import', bytes: src.bytes, fileName: src.fileName, options: src.options, modelId }, this.limits.importTimeoutMs);
    this.resident.add(modelId);
  }

  private ensureChild(): KernelChild {
    if (this.child) return this.child;
    const child = this.spawn();
    child.onMessage((m) => {
      if (this.child !== child) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') p.onProgress?.(m.stage, m.fraction);
      else if (m.type === 'result' || m.type === 'error') {
        this.pending.delete(m.id);
        if (p.timer) clearTimeout(p.timer);
        if (m.type === 'result') p.resolve(m.value);
        else p.reject(fail(m.error.code, m.error.message));
      }
    });
    child.onExit((code) => {
      if (this.child !== child) return;
      this.log('cad kernel exited', { code });
      this.child = null;
      this.resident.clear();
      this.rejectAll('KERNEL_CRASHED', `the CAD kernel stopped unexpectedly (exit code ${code}); the file may be malformed or too large`);
    });
    this.child = child;
    return child;
  }

  private call(msg: KernelCall, timeoutMs: number, onProgress?: ProgressSink): Promise<unknown> {
    const child = this.ensureChild();
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) this.restartKernel('TIMEOUT', `the CAD kernel did not answer within ${Math.round(timeoutMs / 1000)} s`);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, ...(onProgress ? { onProgress } : {}), timer });
      child.postMessage({ ...msg, id } as KernelRequest);
    });
  }

  private restartKernel(code: string, message: string): void {
    const child = this.child;
    this.child = null;
    this.resident.clear();
    this.rejectAll(code, message);
    child?.kill();
  }

  private rejectAll(code: string, message: string): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(fail(code, message));
    }
  }
}
