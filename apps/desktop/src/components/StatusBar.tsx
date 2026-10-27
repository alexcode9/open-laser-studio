import { formatDeg, formatDuration, sToADeg, uToMachineU } from '@ols/geometry-adapters';
import { Loader2 } from 'lucide-react';

import { useMachine } from '@/stores/machine';
import { usePlan } from '@/stores/plan';
import { useProject } from '@/stores/project';
import { useSettings } from '@/stores/settings';
import { useView } from '@/stores/view';

export function StatusBar() {
  const cursor = useView((s) => s.cursorMm);
  const zoom = useView((s) => s.zoom);
  const mode = useProject((s) => s.project?.mode);
  const workpiece = useProject((s) => s.project?.workpiece);
  const selection = useProject((s) => s.selection.length);
  const planning = usePlan((s) => s.planning || s.previewing);
  const stats = usePlan((s) => s.result?.summary.stats);
  const errors = usePlan((s) => s.result?.summary.errors.length ?? 0);
  const warnings = usePlan((s) => s.result?.summary.warnings.length ?? 0);
  const planError = usePlan((s) => s.error);
  const snap = useMachine((s) => s.snapshot);
  const info = useSettings((s) => s.info);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-card px-3 font-mono text-[10.5px] text-muted-foreground">
      <span data-testid="cursor-readout">
        {cursor ? `x ${cursor.x.toFixed(2)}  y ${cursor.y.toFixed(2)} mm` : '—'}
        {cursor && mode === 'cylinder' && workpiece && (
          <span className="ml-3 text-sky-300/80">
            A {formatDeg(sToADeg(workpiece, cursor.y))} U {uToMachineU(workpiece, cursor.x).toFixed(2)} mm
          </span>
        )}
      </span>
      <span>{(zoom * 100 / 3.78).toFixed(0)}%</span>
      <span>{selection} selected</span>
      <span className="flex items-center gap-1">
        {planning && <Loader2 className="size-3 animate-spin" />}
        {planError ? (
          <span className="text-red-400">plan error: {planError}</span>
        ) : stats ? (
          <>
            {stats.segmentCount} seg · est {formatDuration(stats.estimatedTimeS)}
            {stats.sectionCount > 0 && ` · ${stats.sectionCount} sections`}
            {errors > 0 && <span className="text-red-400"> · {errors} error(s)</span>}
            {warnings > 0 && <span className="text-amber-400"> · {warnings} warning(s)</span>}
          </>
        ) : (
          'not planned'
        )}
      </span>
      <div className="flex-1" />
      {snap && <span>sim t {snap.tS.toFixed(2)} s</span>}
      <span>
        core {info?.native?.version ?? '?'} (api {info?.native?.apiVersion ?? '?'}) · app {info?.version}
      </span>
    </footer>
  );
}
