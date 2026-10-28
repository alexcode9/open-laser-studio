import { create } from 'zustand';

export type Tool = 'select' | 'pan' | 'rect' | 'ellipse' | 'line' | 'text';

export interface Toast {
  id: number;
  tone: 'info' | 'warn' | 'error';
  message: string;
}

/** Main work area: the 2D/3D design views or the CAD inspection workspace. */
export type Workspace = 'design' | 'cad';

interface ViewState {
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
  tool: Tool;
  /** Pixels per millimetre. */
  zoom: number;
  panX: number;
  panY: number;
  cursorMm: { x: number; y: number } | null;
  showToolpath: boolean;
  showTravel: boolean;
  showSections: boolean;
  fitRequest: number;
  toasts: Toast[];
  setTool: (t: Tool) => void;
  setView: (zoom: number, panX: number, panY: number) => void;
  setCursor: (c: { x: number; y: number } | null) => void;
  toggle: (k: 'showToolpath' | 'showTravel' | 'showSections') => void;
  requestFit: () => void;
  toast: (tone: Toast['tone'], message: string) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

export const useView = create<ViewState>((set) => ({
  workspace: 'design',
  setWorkspace: (workspace) => set({ workspace }),
  tool: 'select',
  zoom: 3,
  panX: 40,
  panY: 40,
  cursorMm: null,
  showToolpath: true,
  showTravel: false,
  showSections: true,
  fitRequest: 0,
  toasts: [],
  setTool: (tool) => set({ tool }),
  setView: (zoom, panX, panY) => set({ zoom, panX, panY }),
  setCursor: (cursorMm) => set({ cursorMm }),
  toggle: (k) => set((s) => ({ [k]: !s[k] }) as Pick<ViewState, typeof k>),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  toast: (tone, message) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, tone, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 8000 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (tone: Toast['tone'], message: string): void => useView.getState().toast(tone, message);
