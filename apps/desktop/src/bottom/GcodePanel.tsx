import type { GcodeAnalysis } from '@ols/ipc-contracts';
import { formatDuration } from '@ols/geometry-adapters';
import { Badge, Button, cn } from '@ols/ui';
import { FileDown, ScanSearch } from 'lucide-react';
import { useMemo, useState } from 'react';

import { exportGcode } from '@/lib/actions';
import { call, errorMessage } from '@/lib/ipc';
import { useMachine } from '@/stores/machine';
import { usePlan } from '@/stores/plan';

import { VirtualList } from './VirtualList';

function tokenClass(line: string): string {
  const t = line.trimStart();
  if (t.startsWith(';')) return 'text-muted-foreground';
  if (t.startsWith('$')) return 'text-fuchsia-300';
  if (/^M[345]\b/.test(t) || /^M114\b/.test(t)) return 'text-red-300';
  if (/^G1\b/.test(t)) return 'text-orange-200';
  if (/^G0\b/.test(t)) return 'text-sky-300';
  return 'text-foreground';
}

export function GcodePanel() {
  const result = usePlan((s) => s.result);
  const machineListing = useMachine((s) => s.programListing);
  const [source, setSource] = useState<'plan' | 'machine'>('plan');
  const [analysis, setAnalysis] = useState<GcodeAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [jump, setJump] = useState<number | null>(null);
  const lines = source === 'plan' ? (result?.gcodeListing ?? []) : machineListing;
  const diag = useMemo(() => new Map((analysis?.diagnostics ?? []).map((d) => [d.lineNo, d])), [analysis]);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      setAnalysis(await call('gcode:analyze', { text: lines.join('\n'), dialect: 'xtool-f1' }));
    } catch (e) {
      setAnalysis(null);
      window.alert(errorMessage(e));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
          <div className="flex rounded-md border border-border p-0.5">
            <Button size="sm" className={cn(source === 'plan' && 'bg-accent text-foreground')} onClick={() => (setSource('plan'), setAnalysis(null))}>
              Planned
            </Button>
            <Button size="sm" className={cn(source === 'machine' && 'bg-accent text-foreground')} onClick={() => (setSource('machine'), setAnalysis(null))}>
              Sent to sim F1
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => void analyze()} disabled={analyzing || lines.length === 0}>
            <ScanSearch /> Analyze
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportGcode()} disabled={!result?.gcodeListing.length}>
            <FileDown /> Export
          </Button>
          {result && !result.gcodeSupported && source === 'plan' && <Badge tone="warn">contains constructs the F1 dialect may not support</Badge>}
          <Badge tone="muted">F1 dialect: inferred, unvalidated</Badge>
          <div className="flex-1" />
          <span className="font-mono text-[10.5px] text-muted-foreground">{lines.length.toLocaleString()} lines</span>
        </div>
        <VirtualList
          items={lines}
          scrollToIndex={jump}
          className="relative min-h-0 flex-1 overflow-auto font-mono text-[11px]"
          render={(line, i) => {
            const d = diag.get(i + 1);
            return (
              <div className={cn('flex h-4 items-center whitespace-pre', d?.severity === 'error' && 'bg-red-500/15', d?.severity === 'warning' && 'bg-amber-500/10')} title={d?.message}>
                <span className="w-14 shrink-0 pr-2 text-right text-muted-foreground/60 select-none">{i + 1}</span>
                <span className={tokenClass(line)}>{line}</span>
              </div>
            );
          }}
        />
      </div>
      <div className="w-72 shrink-0 overflow-auto border-l border-border p-2 text-[11px]">
        {!analysis ? (
          <p className="text-muted-foreground">Run the analyzer to check the program against the F1 dialect and compute bounds and time.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-x-2 font-mono text-[10.5px]">
              <span>motion blocks</span>
              <span>{analysis.analysis.motionBlocks}</span>
              <span>mark length</span>
              <span>{analysis.analysis.markDistanceMm.toFixed(1)} mm</span>
              <span>travel length</span>
              <span>{analysis.analysis.travelDistanceMm.toFixed(1)} mm</span>
              <span>est. time</span>
              <span>{formatDuration(analysis.analysis.estimatedTimeS)}</span>
              <span>bounds X</span>
              <span>
                {analysis.analysis.minX.toFixed(1)}…{analysis.analysis.maxX.toFixed(1)}
              </span>
              <span>bounds Y</span>
              <span>
                {analysis.analysis.minY.toFixed(1)}…{analysis.analysis.maxY.toFixed(1)}
              </span>
              <span>errors / warnings</span>
              <span>
                {analysis.analysis.errors} / {analysis.analysis.warnings}
              </span>
            </div>
            {analysis.diagnostics.slice(0, 300).map((d, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setJump(d.lineNo - 1)}
                className={cn('block w-full truncate text-left hover:underline', d.severity === 'error' ? 'text-red-300' : d.severity === 'warning' ? 'text-amber-300' : 'text-muted-foreground')}
                title={d.message}
              >
                L{d.lineNo}: {d.message}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
