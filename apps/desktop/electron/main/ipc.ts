import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import { InputSchemas, type Envelope, type InvokeChannel, type Outputs, parseNativeError } from '@ols/ipc-contracts';
import type { AppInfo, CadAlignParams, CadImportStage, CadMeasureRequest, CadModelRef, Project, Vec3 } from '@ols/shared-types';
import { type BrowserWindow, type IpcMainInvokeEvent, app, dialog, ipcMain } from 'electron';

import type { CadHost } from './cad';
import { log } from './logger';
import type { MachineHost } from './machine';
import type { NativeModule } from './native';
import type { SettingsStore } from './settings';

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
};

export interface IpcDeps {
  window: () => BrowserWindow | null;
  native: NativeModule | null;
  nativeError: string | null;
  settings: SettingsStore;
  machine: MachineHost | null;
  cad: CadHost;
  isTrustedSender: (url: string) => boolean;
}

const CAD_EXTENSIONS = ['step', 'stp', 'stl', '3mf'];

type Handler<C extends InvokeChannel> = (input: unknown) => Promise<Outputs[C]> | Outputs[C];

function codeOf(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}

export function registerIpc(d: IpcDeps): void {
  // Paths the user picked through a main-process dialog; the renderer may only reuse these.
  const allowedPaths = new Set<string>();
  const aborts = new Map<string, AbortController>();

  const native = (): NativeModule => {
    if (!d.native) throw Object.assign(new Error(d.nativeError ?? 'native core unavailable'), { code: 'UNAVAILABLE' });
    return d.native;
  };
  const machine = (): MachineHost => {
    if (!d.machine) throw Object.assign(new Error(d.nativeError ?? 'native core unavailable'), { code: 'UNAVAILABLE' });
    return d.machine;
  };
  const win = (): BrowserWindow => {
    const w = d.window();
    if (!w) throw new Error('no window');
    return w;
  };
  /** Cancel the previous task of the same kind (latest request wins). */
  const abortable = (key: string): AbortSignal => {
    aborts.get(key)?.abort();
    const ac = new AbortController();
    aborts.set(key, ac);
    return ac.signal;
  };

  function handle<C extends InvokeChannel>(channel: C, fn: Handler<C>): void {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, raw: unknown): Promise<Envelope<Outputs[C]>> => {
      const url = event.senderFrame?.url ?? '';
      if (!d.isTrustedSender(url)) {
        log('warn', 'ipc from untrusted sender rejected', { channel, url });
        return { ok: false, error: { code: 'FORBIDDEN', message: 'untrusted sender' } };
      }
      const parsed = InputSchemas[channel].safeParse(raw);
      if (!parsed.success) {
        log('warn', 'ipc input rejected', { channel, issues: parsed.error.issues.slice(0, 3) });
        return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 5).join('; ') } };
      }
      try {
        return { ok: true, value: await fn(parsed.data) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const err = codeOf(e) && !msg.startsWith('[') ? { code: codeOf(e)!, message: msg } : parseNativeError(msg);
        if (err.code !== 'ABORTED') log('warn', 'ipc handler error', { channel, ...err });
        return { ok: false, error: err };
      }
    });
  }

  const input = <C extends InvokeChannel>(_c: C, v: unknown) => v as ReturnType<(typeof InputSchemas)[C]['parse']>;

  handle('app:info', (): AppInfo => {
    let nativeInfo = null;
    try {
      nativeInfo = d.native?.nativeInfo() ?? null;
    } catch {
      nativeInfo = null;
    }
    return { version: app.getVersion(), native: nativeInfo, nativeError: d.nativeError, platform: process.platform };
  });

  handle('settings:get', () => d.settings.get());
  handle('settings:update', (v) => {
    const p = input('settings:update', v);
    const out = d.settings.update(p);
    if (p.simSpeed !== undefined && d.machine) d.machine.speed = p.simSpeed;
    return out;
  });

  handle('settings:requestDeveloperMode', async (v) => {
    const { enable } = input('settings:requestDeveloperMode', v);
    if (!enable) return d.settings.setDeveloperMode(false);
    const r = await dialog.showMessageBox(win(), {
      type: 'warning',
      title: 'Enable developer mode',
      message: 'Developer mode allows read-only communication with real hardware.',
      detail:
        'Milestone 1 never sends motion or laser commands to real devices. Only connect to hardware you own, ' +
        'with the enclosure closed and the emergency stop within reach. Developer mode is reset on every launch.',
      buttons: ['Cancel', 'Enable developer mode'],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: 'I understand the risks of connecting to real laser hardware',
    });
    if (r.response !== 1 || !r.checkboxChecked) return d.settings.get();
    return d.settings.setDeveloperMode(true);
  });

  handle('settings:setSimulationOnly', async (v) => {
    const { simulationOnly } = input('settings:setSimulationOnly', v);
    if (simulationOnly) return d.settings.setSimulationOnly(true);
    const r = await dialog.showMessageBox(win(), {
      type: 'warning',
      title: 'Leave simulation-only mode',
      message: 'Allow read-only real-device queries?',
      detail: 'Laser emission and motion on real hardware remain disabled in this build.',
      buttons: ['Cancel', 'Allow'],
      defaultId: 0,
      cancelId: 0,
    });
    if (r.response !== 1) return d.settings.get();
    return d.settings.setSimulationOnly(false);
  });

  handle('project:sample', () => native().sampleProject());
  handle('project:normalize', (v) => native().normalizeProject(input('project:normalize', v) as unknown as Project));

  handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Open project',
      filters: [{ name: 'Open Laser Studio project', extensions: ['ols'] }],
      properties: ['openFile'],
    });
    const path = r.filePaths[0];
    if (r.canceled || !path) return null;
    if (statSync(path).size > 512 * 1024 * 1024) throw Object.assign(new Error('file too large'), { code: 'INVALID_ARGUMENT' });
    const loaded = native().loadOls(readFileSync(path));
    d.cad.stashFiles(loaded.cadFiles.map((f) => ({ sha256: f.sha256, bytes: new Uint8Array(f.data) })));
    allowedPaths.add(path);
    d.settings.addRecent(path);
    log('info', 'project opened', { path, cadFiles: loaded.cadFiles.length, warnings: loaded.warnings.length });
    return { project: loaded.project, path, warnings: loaded.warnings };
  });

  handle('project:save', async (v) => {
    const p = input('project:save', v);
    let path = p.path && allowedPaths.has(p.path) && !p.saveAs ? p.path : null;
    if (!path) {
      const r = await dialog.showSaveDialog(win(), {
        title: 'Save project',
        defaultPath: `${p.project.name || 'project'}.ols`,
        filters: [{ name: 'Open Laser Studio project', extensions: ['ols'] }],
      });
      if (r.canceled || !r.filePath) return null;
      path = r.filePath;
    }
    const cadFiles = d.cad.filesFor((p.project.cad?.models ?? []) as CadModelRef[]);
    const bytes = native().saveOls(
      p.project as unknown as Project,
      p.thumbnailPng ? Buffer.from(p.thumbnailPng) : null,
      cadFiles.map((f) => ({ path: f.path, sha256: f.sha256, data: Buffer.from(f.bytes) })),
    );
    writeFileSync(path, bytes);
    allowedPaths.add(path);
    d.settings.addRecent(path);
    log('info', 'project saved', { path, bytes: bytes.length });
    return { path };
  });

  handle('import:svg', async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Import SVG',
      filters: [{ name: 'SVG', extensions: ['svg'] }],
      properties: ['openFile'],
    });
    const path = r.filePaths[0];
    if (r.canceled || !path) return null;
    if (statSync(path).size > MAX_IMPORT_BYTES) throw Object.assign(new Error('file too large'), { code: 'INVALID_ARGUMENT' });
    const paths = native().importSvg(readFileSync(path, 'utf8'));
    return { name: basename(path), paths };
  });

  handle('import:image', async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Import image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }],
      properties: ['openFile'],
    });
    const path = r.filePaths[0];
    if (r.canceled || !path) return null;
    const mime = IMAGE_MIME[extname(path).toLowerCase()];
    if (!mime) throw Object.assign(new Error('unsupported image type'), { code: 'INVALID_ARGUMENT' });
    if (statSync(path).size > MAX_IMPORT_BYTES) throw Object.assign(new Error('file too large'), { code: 'INVALID_ARGUMENT' });
    return { name: basename(path), dataUrl: `data:${mime};base64,${readFileSync(path).toString('base64')}` };
  });

  handle('text:toPath', (v) => {
    const p = input('text:toPath', v);
    return native().textToPath(p.text, p.fontSizeMm, p.fontFamily);
  });

  handle('geometry:cylinderMesh', (v) => {
    const p = input('geometry:cylinderMesh', v);
    return native().cylinderMesh(p.spec, p.toleranceMm, p.axialSegments);
  });

  handle('toolpath:plan', async (v) => {
    const p = input('toolpath:plan', v);
    const signal = abortable('plan');
    try {
      return await native().planToolpath(p.project as unknown as Project, signal);
    } catch (e) {
      if (signal.aborted) throw Object.assign(new Error('superseded by a newer request'), { code: 'ABORTED' });
      throw e;
    }
  });

  handle('toolpath:preview', async (v) => {
    const p = input('toolpath:preview', v);
    const signal = abortable('preview');
    try {
      return await native().kinematicPreview(p.project as unknown as Project, p.sampleDt, signal);
    } catch (e) {
      if (signal.aborted) throw Object.assign(new Error('superseded by a newer request'), { code: 'ABORTED' });
      throw e;
    }
  });

  handle('gcode:analyze', (v) => {
    const p = input('gcode:analyze', v);
    return native().analyzeGcode(p.text, p.dialect) as Outputs['gcode:analyze'];
  });

  handle('gcode:export', async (v) => {
    const p = input('gcode:export', v);
    const r = await dialog.showSaveDialog(win(), {
      title: 'Export G-code (for inspection only)',
      defaultPath: p.suggestedName,
      filters: [{ name: 'G-code', extensions: ['nc', 'gcode', 'txt'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const header = '; Exported by Open Laser Studio for inspection. NOT validated on hardware.\n';
    writeFileSync(r.filePath, header + p.lines.join('\n') + '\n');
    return { path: r.filePath };
  });

  handle('machine:create', (v) => machine().create(input('machine:create', v).project as unknown as Project));
  handle('machine:setProject', (v) => machine().setProject(input('machine:setProject', v).project as unknown as Project));
  handle('machine:command', (v) => machine().command(input('machine:command', v)));
  handle('machine:inject', (v) => machine().inject(input('machine:inject', v)));
  handle('machine:timeline', (v) => {
    const p = input('machine:timeline', v);
    return machine().timeline(p.fromSample, p.fromEvent);
  });
  handle('machine:log', (v) => machine().logSince(input('machine:log', v).sinceSeq));
  handle('machine:jobLog', () => machine().jobLog());
  handle('machine:safetyHistory', () => machine().safetyHistory());
  handle('machine:programListing', () => machine().programListing());
  handle('machine:setSpeed', (v) => {
    const { speed } = input('machine:setSpeed', v);
    machine().speed = speed;
    return { speed };
  });

  const cadProgress = (requestId: string) => (stage: CadImportStage, fraction: number) => {
    const w = d.window();
    if (w && !w.isDestroyed()) w.webContents.send('cad:progress', { requestId, stage, fraction });
  };

  handle('cad:importDialog', async (v) => {
    const p = input('cad:importDialog', v);
    const r = await dialog.showOpenDialog(win(), {
      title: 'Import CAD model',
      filters: [
        { name: 'CAD models (STEP, STL, 3MF)', extensions: CAD_EXTENSIONS },
        { name: 'STEP', extensions: ['step', 'stp'] },
        { name: 'STL', extensions: ['stl'] },
        { name: '3MF', extensions: ['3mf'] },
      ],
      properties: ['openFile'],
    });
    const path = r.filePaths[0];
    if (r.canceled || !path) return null;
    if (!CAD_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) throw Object.assign(new Error('unsupported CAD file type'), { code: 'UNSUPPORTED' });
    const size = statSync(path).size;
    if (size > 200 * 1024 * 1024) throw Object.assign(new Error('file exceeds the 200 MB import limit'), { code: 'INVALID_ARGUMENT' });
    const bytes = new Uint8Array(readFileSync(path));
    log('info', 'cad import', { file: basename(path), bytes: size });
    // Only the base name leaves the main process; absolute paths are never stored in the model.
    return d.cad.import(bytes, basename(path), p.options, p.requestId, cadProgress(p.requestId));
  });

  handle('cad:importBytes', (v) => {
    const p = input('cad:importBytes', v);
    return d.cad.import(p.bytes, basename(p.fileName), p.options, p.requestId, cadProgress(p.requestId));
  });

  handle('cad:cancel', (v) => ({ cancelled: d.cad.cancel(input('cad:cancel', v).requestId) }));

  handle('cad:confirmUnits', (v) => {
    const p = input('cad:confirmUnits', v);
    return d.cad.confirmUnits(p.modelId, p.unit, p.requestId, cadProgress(p.requestId));
  });

  handle('cad:measure', (v) => {
    const p = input('cad:measure', v);
    return d.cad.measure(p.modelId, p.request as CadMeasureRequest);
  });

  handle('cad:release', async (v) => ({ released: await d.cad.release(input('cad:release', v).modelId) }));

  handle('cad:restore', (v) => {
    const p = input('cad:restore', v);
    return d.cad.restore(p.model as CadModelRef, p.requestId, cadProgress(p.requestId));
  });

  handle('cad:alignToRotary', (v) => native().cadAlignToRotary(input('cad:alignToRotary', v) as CadAlignParams));

  handle('cad:section', (v) => {
    const p = input('cad:section', v);
    return d.cad.section(p.modelId, p.origin as Vec3, p.normal as Vec3);
  });

  handle('cad:exportReport', async (v) => {
    const p = input('cad:exportReport', v);
    const r = await dialog.showSaveDialog(win(), {
      title: 'Export CAD measurement report',
      defaultPath: p.suggestedName,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, p.text);
    return { path: r.filePath };
  });

  handle('device:probeF1', () => {
    const s = d.settings.get();
    const profile = d.machine?.machineProfile;
    return native().f1ProbeMachineInfo({
      host: profile?.host ?? '201.234.3.1',
      tcpPort: profile?.tcpPort ?? 8780,
      httpPort: profile?.httpPort ?? 8080,
      simulationOnly: s.simulationOnly,
      developerMode: s.developerMode,
    });
  });
}
