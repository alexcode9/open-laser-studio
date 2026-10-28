// Runtime CAD state: analysed models (from the kernel), selection, active tool and display
// options. What is persisted (model references, measurements, workpiece binding) lives in
// `project.cad` and goes through the project store's undo history.

import type { CadImportStage, CadModelData, CadSection } from '@ols/shared-types';
import { create } from 'zustand';

import type { CadPick, PickMode } from '@/cad/picking';

export type CadTool = 'select' | 'distance' | 'length' | 'radius' | 'angle' | 'face-distance' | 'area' | 'section';
export type CadStyle = 'shaded' | 'shaded-edges' | 'wireframe' | 'xray';
export type CadProjection = 'perspective' | 'orthographic';
export type CadViewKind = 'fit' | 'iso' | 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'axis';

export type ModelStatus = { state: 'loading' } | { state: 'ready' } | { state: 'missing' | 'error'; message: string };

export interface CadImportJob {
  requestId: string;
  fileName: string;
  stage: CadImportStage;
  fraction: number;
}

interface CadState {
  models: Record<string, CadModelData>;
  status: Record<string, ModelStatus>;
  activeModelId: string | null;
  job: CadImportJob | null;
  /** STL model waiting for the user to confirm its unit. */
  unitPrompt: string | null;
  selection: CadPick[];
  hover: CadPick | null;
  pickMode: PickMode;
  tool: CadTool;
  toolPicks: CadPick[];
  style: CadStyle;
  projection: CadProjection;
  view: { kind: CadViewKind; seq: number };
  workpieceDialog: boolean;
  /** Cylinder highlighted while choosing the workpiece. */
  preview: { modelId: string; cylinderId: string } | null;
  /** View-only isolate of one assembly part (not persisted). */
  isolated: { modelId: string; partIndex: number } | null;
  /** Last cutting-plane section overlay. */
  section: { modelId: string; result: CadSection } | null;

  setModel: (m: CadModelData) => void;
  setStatus: (id: string, s: ModelStatus) => void;
  dropModel: (id: string) => void;
  reset: () => void;
  setActive: (id: string | null) => void;
  setJob: (j: CadImportJob | null) => void;
  setUnitPrompt: (id: string | null) => void;
  select: (p: CadPick | null, additive?: boolean) => void;
  setHover: (p: CadPick | null) => void;
  setPickMode: (m: PickMode) => void;
  setTool: (t: CadTool) => void;
  addToolPick: (p: CadPick) => CadPick[];
  clearToolPicks: () => void;
  setStyle: (s: CadStyle) => void;
  setProjection: (p: CadProjection) => void;
  requestView: (kind: CadViewKind) => void;
  setWorkpieceDialog: (open: boolean) => void;
  setPreview: (p: { modelId: string; cylinderId: string } | null) => void;
  setIsolated: (p: { modelId: string; partIndex: number } | null) => void;
  setSection: (s: { modelId: string; result: CadSection } | null) => void;
}

const sameTopo = (a: CadPick, b: CadPick) => a.modelId === b.modelId && a.kind === b.kind && a.index === b.index;

export const useCad = create<CadState>((set, get) => ({
  models: {},
  status: {},
  activeModelId: null,
  job: null,
  unitPrompt: null,
  selection: [],
  hover: null,
  pickMode: 'auto',
  tool: 'select',
  toolPicks: [],
  style: 'shaded-edges',
  projection: 'perspective',
  view: { kind: 'fit', seq: 0 },
  workpieceDialog: false,
  preview: null,
  isolated: null,
  section: null,

  setModel: (m) =>
    set((s) => ({
      models: { ...s.models, [m.modelId]: m },
      status: { ...s.status, [m.modelId]: { state: 'ready' } },
      activeModelId: s.activeModelId ?? m.modelId,
      // Topology indices of a re-analysed model are not comparable with the old ones.
      selection: s.selection.filter((p) => p.modelId !== m.modelId),
      toolPicks: s.toolPicks.filter((p) => p.modelId !== m.modelId),
      hover: null,
    })),
  setStatus: (id, st) => set((s) => ({ status: { ...s.status, [id]: st } })),
  dropModel: (id) =>
    set((s) => {
      const models = { ...s.models };
      const status = { ...s.status };
      delete models[id];
      delete status[id];
      return {
        models,
        status,
        activeModelId: s.activeModelId === id ? (Object.keys(models)[0] ?? null) : s.activeModelId,
        selection: s.selection.filter((p) => p.modelId !== id),
        toolPicks: s.toolPicks.filter((p) => p.modelId !== id),
        hover: null,
        isolated: s.isolated?.modelId === id ? null : s.isolated,
        section: s.section?.modelId === id ? null : s.section,
      };
    }),
  reset: () => set({ models: {}, status: {}, activeModelId: null, selection: [], hover: null, toolPicks: [], unitPrompt: null, isolated: null, section: null }),
  setActive: (activeModelId) => set({ activeModelId }),
  setJob: (job) => set({ job }),
  setUnitPrompt: (unitPrompt) => set({ unitPrompt }),
  select: (p, additive) =>
    set((s) => {
      if (!p) return { selection: [] };
      if (!additive) return { selection: [p], activeModelId: p.modelId };
      const exists = s.selection.some((q) => sameTopo(q, p));
      return { selection: exists ? s.selection.filter((q) => !sameTopo(q, p)) : [...s.selection, p], activeModelId: p.modelId };
    }),
  setHover: (hover) => {
    const cur = get().hover;
    if (cur === hover || (cur && hover && sameTopo(cur, hover))) return;
    set({ hover });
  },
  setPickMode: (pickMode) => set({ pickMode }),
  setTool: (tool) => set({ tool, toolPicks: [] }),
  addToolPick: (p) => {
    const picks = [...get().toolPicks, p];
    set({ toolPicks: picks });
    return picks;
  },
  clearToolPicks: () => set({ toolPicks: [] }),
  setStyle: (style) => set({ style }),
  setProjection: (projection) => set({ projection }),
  requestView: (kind) => set((s) => ({ view: { kind, seq: s.view.seq + 1 } })),
  setWorkpieceDialog: (workpieceDialog) => set(workpieceDialog ? { workpieceDialog } : { workpieceDialog, preview: null }),
  setPreview: (preview) => set({ preview }),
  setIsolated: (isolated) => set({ isolated }),
  setSection: (section) => set({ section }),
}));
