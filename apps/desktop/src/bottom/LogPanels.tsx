import { Badge, cn } from '@ols/ui';
import { useEffect } from 'react';

import { useMachine } from '@/stores/machine';
import { usePlan } from '@/stores/plan';

import { VirtualList } from './VirtualList';

const DIR_COLORS: Record<string, string> = {
  tx: 'text-sky-300',
  rx: 'text-emerald-300',
  info: 'text-muted-foreground',
  error: 'text-red-300',
  blocked: 'text-amber-300',
};

function usePollLogs() {
  useEffect(() => {
    const id = setInterval(() => void useMachine.getState().refreshLogs(), 500);
    return () => clearInterval(id);
  }, []);
}

export function ProtocolLogPanel() {
  usePollLogs();
  const log = useMachine((s) => s.log);
  return (
    <VirtualList
      items={log}
      stickToBottom
      className="relative h-full overflow-auto font-mono text-[11px]"
      render={(e) => (
        <div className="flex h-4 items-center gap-2 px-2 whitespace-pre">
          <span className="w-16 shrink-0 text-right text-muted-foreground/70">{e.tS.toFixed(3)}</span>
          <span className="w-14 shrink-0 text-muted-foreground">{e.channel}</span>
          <span className={cn('w-12 shrink-0 uppercase', DIR_COLORS[e.direction])}>{e.direction}</span>
          <span className={DIR_COLORS[e.direction] === 'text-red-300' ? 'text-red-300' : ''}>{e.text}</span>
        </div>
      )}
    />
  );
}

export function JobLogPanel() {
  usePollLogs();
  const entries = useMachine((s) => s.jobLog);
  const safety = useMachine((s) => s.safety);
  return (
    <div className="grid h-full min-h-0 grid-cols-2">
      <div className="min-h-0 overflow-auto border-r border-border font-mono text-[11px]">
        <div className="sticky top-0 bg-card px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Job steps</div>
        {entries.length === 0 && <div className="px-2 text-muted-foreground">No job has run.</div>}
        {entries.map((e, i) => (
          <div key={i} className="flex gap-2 px-2">
            <span className="w-16 shrink-0 text-right text-muted-foreground/70">{e.tS.toFixed(3)}</span>
            <span className="w-10 shrink-0 text-muted-foreground">#{e.unit + 1}</span>
            <span className="w-24 shrink-0 text-sky-300">{e.step}</span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
      <div className="min-h-0 overflow-auto font-mono text-[11px]" data-testid="safety-history">
        <div className="sticky top-0 bg-card px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Safety transitions</div>
        {safety.map((s, i) => (
          <div key={i} className="flex gap-2 px-2">
            <span className="w-16 shrink-0 text-right text-muted-foreground/70">{s.tS.toFixed(3)}</span>
            <span className="shrink-0">
              {s.from} → <span className={['FAULT', 'ESTOP'].includes(s.to) ? 'text-red-300' : 'text-emerald-300'}>{s.to}</span>
            </span>
            <span className="text-muted-foreground">
              {s.event}
              {s.detail ? `: ${s.detail}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlanReportPanel() {
  const result = usePlan((s) => s.result);
  const error = usePlan((s) => s.error);
  if (error) return <div className="p-3 text-xs text-red-300">{error}</div>;
  if (!result) return <div className="p-3 text-xs text-muted-foreground">Planning…</div>;
  const s = result.summary;
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-2 overflow-auto p-3 text-[11px]" data-testid="plan-report">
        <div className="flex flex-wrap gap-1">
          <Badge>{s.mode}</Badge>
          {s.strategy && <Badge>{s.strategy}</Badge>}
          {s.simulationOnly && <Badge tone="warn">simulation only</Badge>}
          <Badge tone={s.executable ? 'ok' : 'danger'}>{s.executable ? 'executable' : 'not executable'}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-x-3 font-mono text-[10.5px]">
          <span>segments</span>
          <span>{s.stats.segmentCount}</span>
          <span>mark length</span>
          <span>{s.stats.markLengthMm.toFixed(1)} mm</span>
          <span>travel length</span>
          <span>{s.stats.travelLengthMm.toFixed(1)} mm</span>
          <span>estimated time</span>
          <span>{s.stats.estimatedTimeS.toFixed(1)} s</span>
          {s.stats.aRangeDeg && (
            <>
              <span>A range</span>
              <span>
                {s.stats.aRangeDeg[0].toFixed(2)}…{s.stats.aRangeDeg[1].toFixed(2)}°
              </span>
            </>
          )}
          {s.stats.uRangeMm && (
            <>
              <span>U range</span>
              <span>
                {s.stats.uRangeMm[0].toFixed(2)}…{s.stats.uRangeMm[1].toFixed(2)} mm
              </span>
            </>
          )}
          {s.stats.galvoBounds && (
            <>
              <span>galvo bounds</span>
              <span>
                {s.stats.galvoBounds.minX.toFixed(1)},{s.stats.galvoBounds.minY.toFixed(1)} … {s.stats.galvoBounds.maxX.toFixed(1)},{s.stats.galvoBounds.maxY.toFixed(1)}
              </span>
            </>
          )}
        </div>
        {s.errors.map((e) => (
          <div key={e} className="text-red-300">
            ✕ {e}
          </div>
        ))}
        {s.warnings.map((w) => (
          <div key={w} className="text-amber-300">
            ⚠ {w}
          </div>
        ))}
      </div>
      <div className="min-h-0 overflow-auto border-l border-border">
        <table className="w-full font-mono text-[10.5px]">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr className="text-left">
              <th className="px-2 py-1">#</th>
              <th>A °</th>
              <th>U mm</th>
              <th>u center</th>
              <th>s center</th>
              <th>segments</th>
              <th>focus err</th>
            </tr>
          </thead>
          <tbody>
            {s.sections.map((sec) => (
              <tr key={sec.index} className="border-t border-border/50">
                <td className="px-2">{sec.index + 1}</td>
                <td>{sec.aDeg.toFixed(3)}</td>
                <td>{sec.machineUMm.toFixed(3)}</td>
                <td>{sec.uCenterMm.toFixed(2)}</td>
                <td>{sec.sCenterMm.toFixed(2)}</td>
                <td>{sec.segmentCount}</td>
                <td>{sec.maxFocusErrorMm.toFixed(3)}</td>
              </tr>
            ))}
            {s.sections.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-2 text-muted-foreground">
                  {s.mode === 'cylinder' ? 'No sections.' : 'Flat mode has no sections.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
