import type { PlanResult, Project, TimelineBuffers } from '@ols/shared-types';
import { create } from 'zustand';

import { IpcCallError, call, errorMessage } from '@/lib/ipc';

import { useProject } from './project';

interface PlanState {
  result: PlanResult | null;
  preview: TimelineBuffers | null;
  planning: boolean;
  previewing: boolean;
  error: string | null;
  /** Project revision the current result was computed from. */
  planned: Project | null;
  replan: () => void;
}

const DEBOUNCE_MS = 250;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

async function run(project: Project): Promise<void> {
  const gen = ++generation;
  usePlan.setState({ planning: true });
  try {
    const result = await call('toolpath:plan', { project });
    if (gen !== generation) return;
    usePlan.setState({ result, planned: project, error: null, planning: false });
    if (result.summary.errors.length > 0 || result.summary.stats.segmentCount === 0) {
      usePlan.setState({ preview: null });
      return;
    }
    usePlan.setState({ previewing: true });
    const est = result.summary.stats.estimatedTimeS;
    const sampleDt = Math.min(0.5, Math.max(0.005, est / 20000));
    const preview = await call('toolpath:preview', { project, sampleDt });
    if (gen !== generation) return;
    usePlan.setState({ preview, previewing: false });
  } catch (e) {
    if (e instanceof IpcCallError && e.code === 'ABORTED') return;
    if (gen !== generation) return;
    usePlan.setState({ error: errorMessage(e), planning: false, previewing: false });
  }
}

export const usePlan = create<PlanState>(() => ({
  result: null,
  preview: null,
  planning: false,
  previewing: false,
  error: null,
  planned: null,
  replan: () => {
    const p = useProject.getState().project;
    if (p) void run(p);
  },
}));

/** Re-plan whenever the project changes (debounced; superseded requests are aborted in main). */
useProject.subscribe((s, prev) => {
  if (!s.project || s.project === prev.project) return;
  if (timer) clearTimeout(timer);
  const p = s.project;
  timer = setTimeout(() => void run(p), DEBOUNCE_MS);
});
