import type {
  CylinderJobSettings,
  CylinderSpec,
  DesignObject,
  LaserSettings,
  Layer,
  MachineProfile,
  Project,
  Transform2,
  WorkspaceMode,
} from '@ols/shared-types';
import { create } from 'zustand';

import { newId } from '@/lib/shapes';

const HISTORY_LIMIT = 200;

export interface ProjectState {
  project: Project | null;
  path: string | null;
  dirty: boolean;
  selection: string[];
  activeLayerId: string | null;
  past: Project[];
  future: Project[];
  /** Coalescing key of the last history entry (continuous edits merge into one undo step). */
  lastKey: string | null;

  load: (p: Project, path: string | null) => void;
  /** Apply an immutable update and record an undo step (merged with the previous one if `key` matches). */
  apply: (fn: (p: Project) => Project, key?: string) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (path: string) => void;

  select: (ids: string[], additive?: boolean) => void;
  setActiveLayer: (id: string) => void;

  addObjects: (objs: DesignObject[]) => void;
  updateObject: (id: string, patch: Partial<DesignObject>, key?: string) => void;
  setTransforms: (t: Record<string, Transform2>, key?: string) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  nudgeSelection: (dx: number, dy: number) => void;
  reorderSelection: (dir: 'up' | 'down') => void;

  addLayer: () => void;
  updateLayer: (id: string, patch: Partial<Omit<Layer, 'settings'>>, key?: string) => void;
  updateLayerSettings: (id: string, patch: Partial<LaserSettings>, key?: string) => void;
  removeLayer: (id: string) => void;
  moveSelectionToLayer: (layerId: string) => void;

  setMode: (m: WorkspaceMode) => void;
  setWorkpiece: (patch: Partial<CylinderSpec>, key?: string) => void;
  setCylinderJob: (patch: Partial<CylinderJobSettings>, key?: string) => void;
  setMachine: (fn: (m: MachineProfile) => MachineProfile, key?: string) => void;
  addAsset: (dataUrl: string) => string;
}

const LAYER_COLORS = ['#f97316', '#22d3ee', '#a3e635', '#e879f9', '#facc15', '#60a5fa', '#f87171'];

const editDoc = (p: Project, objects: DesignObject[]): Project => ({ ...p, document: { ...p.document, objects } });

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  path: null,
  dirty: false,
  selection: [],
  activeLayerId: null,
  past: [],
  future: [],
  lastKey: null,

  load: (p, path) =>
    set({
      project: p,
      path,
      dirty: false,
      selection: [],
      activeLayerId: p.document.layers[0]?.id ?? null,
      past: [],
      future: [],
      lastKey: null,
    }),

  apply: (fn, key) => {
    const { project, past, lastKey } = get();
    if (!project) return;
    const next = fn(project);
    if (next === project) return;
    const merge = key !== undefined && key === lastKey;
    set({
      project: next,
      dirty: true,
      past: merge ? past : [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      lastKey: key ?? null,
    });
  },

  undo: () => {
    const { project, past, future } = get();
    const prev = past[past.length - 1];
    if (!project || !prev) return;
    const ids = new Set(prev.document.objects.map((o) => o.id));
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [project, ...future],
      dirty: true,
      lastKey: null,
      selection: get().selection.filter((id) => ids.has(id)),
    });
  },

  redo: () => {
    const { project, past, future } = get();
    const next = future[0];
    if (!project || !next) return;
    const ids = new Set(next.document.objects.map((o) => o.id));
    set({
      project: next,
      past: [...past, project],
      future: future.slice(1),
      dirty: true,
      lastKey: null,
      selection: get().selection.filter((id) => ids.has(id)),
    });
  },

  markSaved: (path) => set({ path, dirty: false }),

  select: (ids, additive) =>
    set((s) => {
      if (!additive) return { selection: ids };
      const cur = new Set(s.selection);
      for (const id of ids) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      return { selection: [...cur] };
    }),

  setActiveLayer: (id) => set({ activeLayerId: id }),

  addObjects: (objs) => {
    get().apply((p) => editDoc(p, [...p.document.objects, ...objs]));
    set({ selection: objs.map((o) => o.id) });
  },

  updateObject: (id, patch, key) =>
    get().apply((p) => editDoc(p, p.document.objects.map((o) => (o.id === id ? { ...o, ...patch } : o))), key),

  setTransforms: (t, key) =>
    get().apply((p) => editDoc(p, p.document.objects.map((o) => (t[o.id] ? { ...o, transform: t[o.id]! } : o))), key),

  deleteSelection: () => {
    const sel = new Set(get().selection);
    if (sel.size === 0) return;
    get().apply((p) => editDoc(p, p.document.objects.filter((o) => !sel.has(o.id) || o.locked)));
    set({ selection: [] });
  },

  duplicateSelection: () => {
    const { project, selection } = get();
    if (!project || selection.length === 0) return;
    const sel = new Set(selection);
    const copies = project.document.objects
      .filter((o) => sel.has(o.id))
      .map((o) => ({ ...o, id: newId('obj'), name: `${o.name} copy`, locked: false, transform: { ...o.transform, x: o.transform.x + 5, y: o.transform.y + 5 } }));
    get().addObjects(copies);
  },

  nudgeSelection: (dx, dy) => {
    const sel = new Set(get().selection);
    if (sel.size === 0) return;
    get().apply(
      (p) =>
        editDoc(
          p,
          p.document.objects.map((o) => (sel.has(o.id) && !o.locked ? { ...o, transform: { ...o.transform, x: o.transform.x + dx, y: o.transform.y + dy } } : o)),
        ),
      'nudge',
    );
  },

  reorderSelection: (dir) => {
    const sel = new Set(get().selection);
    get().apply((p) => {
      const objs = [...p.document.objects];
      const idx = objs.map((o, i) => (sel.has(o.id) ? i : -1)).filter((i) => i >= 0);
      if (dir === 'up') {
        for (const i of idx.reverse()) if (i < objs.length - 1 && !sel.has(objs[i + 1]!.id)) [objs[i], objs[i + 1]] = [objs[i + 1]!, objs[i]!];
      } else {
        for (const i of idx) if (i > 0 && !sel.has(objs[i - 1]!.id)) [objs[i], objs[i - 1]] = [objs[i - 1]!, objs[i]!];
      }
      return editDoc(p, objs);
    });
  },

  addLayer: () => {
    const { project } = get();
    if (!project) return;
    const base = project.document.layers[project.document.layers.length - 1];
    if (!base) return;
    const n = project.document.layers.length;
    const layer: Layer = {
      ...base,
      id: newId('layer'),
      name: `Layer ${n + 1}`,
      color: LAYER_COLORS[n % LAYER_COLORS.length]!,
      visible: true,
      locked: false,
      output: true,
      settings: { ...base.settings },
    };
    get().apply((p) => ({ ...p, document: { ...p.document, layers: [...p.document.layers, layer] } }));
    set({ activeLayerId: layer.id });
  },

  updateLayer: (id, patch, key) =>
    get().apply((p) => ({ ...p, document: { ...p.document, layers: p.document.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) } }), key),

  updateLayerSettings: (id, patch, key) =>
    get().apply(
      (p) => ({
        ...p,
        document: { ...p.document, layers: p.document.layers.map((l) => (l.id === id ? { ...l, settings: { ...l.settings, ...patch } } : l)) },
      }),
      key,
    ),

  removeLayer: (id) => {
    const { project } = get();
    if (!project || project.document.layers.length <= 1) return;
    if (project.document.objects.some((o) => o.layerId === id)) return;
    get().apply((p) => ({ ...p, document: { ...p.document, layers: p.document.layers.filter((l) => l.id !== id) } }));
    if (get().activeLayerId === id) set({ activeLayerId: get().project?.document.layers[0]?.id ?? null });
  },

  moveSelectionToLayer: (layerId) => {
    const sel = new Set(get().selection);
    get().apply((p) => editDoc(p, p.document.objects.map((o) => (sel.has(o.id) ? { ...o, layerId } : o))));
  },

  setMode: (m) => get().apply((p) => (p.mode === m ? p : { ...p, mode: m })),
  setWorkpiece: (patch, key) => get().apply((p) => ({ ...p, workpiece: { ...p.workpiece, ...patch } }), key),
  setCylinderJob: (patch, key) => get().apply((p) => ({ ...p, cylinder: { ...p.cylinder, ...patch } }), key),
  setMachine: (fn, key) => get().apply((p) => ({ ...p, machine: fn(p.machine) }), key),

  addAsset: (dataUrl) => {
    const id = newId('asset');
    get().apply((p) => ({ ...p, assets: { ...p.assets, [id]: dataUrl } }));
    return id;
  },
}));

export function selectedObjects(s: ProjectState): DesignObject[] {
  if (!s.project) return [];
  const sel = new Set(s.selection);
  return s.project.document.objects.filter((o) => sel.has(o.id));
}
