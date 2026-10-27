import { normalizePath, pathBounds } from '@ols/geometry-adapters';
import type { DesignObject } from '@ols/shared-types';

import { usePlan } from '@/stores/plan';
import { useProject } from '@/stores/project';
import { toast } from '@/stores/view';

import { call, errorMessage } from './ipc';
import { IDENTITY, newId } from './shapes';

/** Registered by the 2D editor: renders a small PNG thumbnail of the document. */
let thumbnailProvider: (() => Promise<Uint8Array | null>) | null = null;
export function registerThumbnailProvider(fn: (() => Promise<Uint8Array | null>) | null): void {
  thumbnailProvider = fn;
}

function guardDirty(): boolean {
  return !useProject.getState().dirty || window.confirm('Discard unsaved changes?');
}

export async function newSampleProject(): Promise<void> {
  if (!guardDirty()) return;
  try {
    useProject.getState().load(await call('project:sample'), null);
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

export async function openProject(): Promise<void> {
  if (!guardDirty()) return;
  try {
    const r = await call('project:open');
    if (!r) return;
    useProject.getState().load(r.project, r.path);
    toast('info', `Opened ${r.path}`);
  } catch (e) {
    toast('error', `Open failed: ${errorMessage(e)}`);
  }
}

export async function saveProject(saveAs = false): Promise<void> {
  const { project, path } = useProject.getState();
  if (!project) return;
  try {
    const thumbnailPng = thumbnailProvider ? await thumbnailProvider().catch(() => null) : null;
    const r = await call('project:save', { project, path, saveAs, thumbnailPng });
    if (!r) return;
    useProject.getState().markSaved(r.path);
    toast('info', `Saved ${r.path}`);
  } catch (e) {
    toast('error', `Save failed: ${errorMessage(e)}`);
  }
}

export async function importSvg(): Promise<void> {
  const { project, activeLayerId } = useProject.getState();
  if (!project || !activeLayerId) return;
  try {
    const r = await call('import:svg');
    if (!r) return;
    if (r.paths.length === 0) {
      toast('warn', `${r.name}: no drawable paths found`);
      return;
    }
    const all = r.paths.flatMap((p) => p.commands);
    const b = pathBounds(all);
    const ox = b ? b.minX : 0;
    const oy = b ? b.minY : 0;
    const groupId = newId('group');
    const objs: DesignObject[] = r.paths.map((p, i) => {
      const n = normalizePath(p.commands);
      return {
        id: newId('obj'),
        name: `${r.name} #${i + 1}`,
        layerId: activeLayerId,
        visible: true,
        locked: false,
        groupId: r.paths.length > 1 ? groupId : null,
        transform: { ...IDENTITY, x: 10 + n.dx - ox, y: 10 + n.dy - oy },
        shape: { kind: 'path', commands: n.commands },
      };
    });
    useProject.getState().addObjects(objs);
    toast('info', `Imported ${objs.length} path(s) from ${r.name}`);
  } catch (e) {
    toast('error', `SVG import failed: ${errorMessage(e)}`);
  }
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('could not decode image'));
    img.src = dataUrl;
  });
}

export async function importImage(): Promise<void> {
  const st = useProject.getState();
  if (!st.project) return;
  try {
    const r = await call('import:image');
    if (!r) return;
    const { w, h } = await imageSize(r.dataUrl);
    const widthMm = Math.min(60, w / 10);
    const heightMm = (widthMm * h) / w;
    // Images go on an image-mode layer; create one if needed.
    let layer = st.project.document.layers.find((l) => l.settings.mode === 'image');
    if (!layer) {
      st.addLayer();
      const id = useProject.getState().activeLayerId!;
      useProject.getState().updateLayer(id, { name: 'Image' });
      useProject.getState().updateLayerSettings(id, { mode: 'image', linesPerMm: 10, speedMmS: 1000, powerPct: 30 });
      layer = useProject.getState().project!.document.layers.find((l) => l.id === id);
    }
    const assetId = useProject.getState().addAsset(r.dataUrl);
    useProject.getState().addObjects([
      {
        id: newId('obj'),
        name: r.name,
        layerId: layer!.id,
        visible: true,
        locked: false,
        groupId: null,
        transform: { ...IDENTITY, x: 10, y: 10 },
        shape: { kind: 'image', widthMm, heightMm, assetId },
      },
    ]);
  } catch (e) {
    toast('error', `Image import failed: ${errorMessage(e)}`);
  }
}

export async function exportGcode(): Promise<void> {
  const r = usePlan.getState().result;
  const name = useProject.getState().project?.name ?? 'job';
  if (!r || r.gcodeListing.length === 0) {
    toast('warn', 'No G-code to export (plan the job first).');
    return;
  }
  try {
    const out = await call('gcode:export', { lines: r.gcodeListing, suggestedName: `${name}.nc` });
    if (out) toast('info', `Exported ${out.path}`);
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

export async function textOutline(text: string, fontSizeMm: number, fontFamily: string) {
  try {
    return await call('text:toPath', { text, fontSizeMm, fontFamily });
  } catch (e) {
    toast('warn', `Text outlines unavailable: ${errorMessage(e)}`);
    return null;
  }
}

export async function addText(x: number, y: number, text = 'Text'): Promise<void> {
  const st = useProject.getState();
  if (!st.activeLayerId) return;
  const fontSizeMm = 8;
  const fontFamily = 'sans-serif';
  const outline = await textOutline(text, fontSizeMm, fontFamily);
  st.addObjects([
    {
      id: newId('obj'),
      name: `Text "${text.slice(0, 16)}"`,
      layerId: st.activeLayerId,
      visible: true,
      locked: false,
      groupId: null,
      transform: { ...IDENTITY, x, y },
      shape: { kind: 'text', text, fontSizeMm, fontFamily, outline },
    },
  ]);
}
