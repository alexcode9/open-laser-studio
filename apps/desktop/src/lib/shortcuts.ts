import { useEffect } from 'react';

import { useMachine } from '@/stores/machine';
import { useProject } from '@/stores/project';
import { useView } from '@/stores/view';

import { importSvg, openProject, saveProject } from './actions';

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

/** Global keyboard shortcuts. Escape is always a software stop for an active job. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const p = useProject.getState();
      const snap = useMachine.getState().snapshot;

      if (e.key === 'Escape' && snap && ['RUNNING', 'PAUSED'].includes(snap.safetyState)) {
        e.preventDefault();
        void useMachine.getState().command({ cmd: 'stop' });
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProject(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openProject();
        return;
      }
      if (isEditable(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) p.redo();
        else p.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        p.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        p.duplicateSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        void importSvg();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        p.select(p.project?.document.objects.filter((o) => !o.locked && o.visible).map((o) => o.id) ?? []);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        p.deleteSelection();
        return;
      }
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (nudge[e.key] && p.selection.length > 0) {
        e.preventDefault();
        p.nudgeSelection(...nudge[e.key]!);
        return;
      }
      if (mod) return;
      const tools: Record<string, Parameters<ReturnType<typeof useView.getState>['setTool']>[0]> = {
        v: 'select',
        h: 'pan',
        r: 'rect',
        e: 'ellipse',
        l: 'line',
        t: 'text',
      };
      const tool = tools[e.key.toLowerCase()];
      if (tool) useView.getState().setTool(tool);
      if (e.key.toLowerCase() === 'f') useView.getState().requestFit();
      if (e.key === 'Escape') p.select([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
