import { formatDuration } from '@ols/geometry-adapters';
import { SAFETY_STATE_CODES, type TimelineBuffers } from '@ols/shared-types';
import { Button, Select, Tooltip, cn } from '@ols/ui';
import { Pause, Play, Radio, SkipBack } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { useSize } from '@/lib/useSize';
import { sampleAt, useActiveTimeline, usePlayback } from '@/stores/playback';

const LANES = [
  { key: 'gx', label: 'Gx mm', color: '#60a5fa' },
  { key: 'gy', label: 'Gy mm', color: '#a78bfa' },
  { key: 'a', label: 'A °', color: '#34d399' },
  { key: 'u', label: 'U mm', color: '#fbbf24' },
  { key: 'power', label: 'Laser %', color: '#ef4444' },
  { key: 'state', label: 'State', color: '#94a3b8' },
] as const;
const LABEL_W = 64;
const EVENT_COLORS: Record<string, string> = { fault: '#ef4444', estop: '#ef4444', safety: '#fbbf24', job: '#22d3ee', section: '#a78bfa' };

const STATE_COLORS: Record<string, string> = {
  RUNNING: '#f97316',
  PAUSED: '#fbbf24',
  ARMED: '#facc15',
  FAULT: '#ef4444',
  ESTOP: '#dc2626',
  STOPPING: '#fb923c',
  READY: '#34d399',
};

/** Per-pixel min/max envelopes so million-sample timelines draw in O(width). */
function envelopes(tl: TimelineBuffers, width: number, t0: number, t1: number) {
  const n = tl.t.length;
  const cols = Math.max(1, width);
  const out = LANES.map(() => ({ min: new Float32Array(cols).fill(NaN), max: new Float32Array(cols).fill(NaN), lo: Infinity, hi: -Infinity }));
  const span = Math.max(1e-9, t1 - t0);
  for (let i = 0; i < n; i++) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((tl.t[i]! - t0) / span) * cols)));
    LANES.forEach((lane, li) => {
      const v = tl[lane.key][i]!;
      const e = out[li]!;
      if (Number.isNaN(e.min[c]!) || v < e.min[c]!) e.min[c] = v;
      if (Number.isNaN(e.max[c]!) || v > e.max[c]!) e.max[c] = v;
      if (v < e.lo) e.lo = v;
      if (v > e.hi) e.hi = v;
    });
  }
  return out;
}

export function TimelinePanel() {
  const tl = useActiveTimeline();
  const source = usePlayback((s) => s.source);
  const playing = usePlayback((s) => s.playing);
  const rate = usePlayback((s) => s.rate);
  const follow = usePlayback((s) => s.follow);
  const pb = usePlayback.getState();
  const host = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const { width, height } = useSize(host);
  const plotW = Math.max(1, width - LABEL_W);
  const t0 = tl && tl.t.length ? tl.t[0]! : 0;
  const t1 = tl && tl.t.length ? Math.max(tl.t[tl.t.length - 1]!, t0 + 1e-3) : 1;
  const env = useMemo(() => (tl && tl.t.length ? envelopes(tl, plotW, t0, t1) : null), [tl, plotW, t0, t1]);

  useEffect(() => {
    const c = base.current;
    if (!c || width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const laneH = height / LANES.length;
    ctx.font = '10px ui-monospace, monospace';
    LANES.forEach((lane, li) => {
      const y0 = li * laneH;
      ctx.fillStyle = li % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.035)';
      ctx.fillRect(0, y0, width, laneH);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(lane.label, 6, y0 + 12);
      const e = env?.[li];
      if (!e || !tl) return;
      if (lane.key === 'state') {
        for (let x = 0; x < plotW; x++) {
          const v = e.max[x]!;
          if (Number.isNaN(v)) continue;
          ctx.fillStyle = STATE_COLORS[SAFETY_STATE_CODES[Math.round(v)] ?? ''] ?? '#334155';
          ctx.fillRect(LABEL_W + x, y0 + 4, 1, laneH - 8);
        }
        return;
      }
      const lo = lane.key === 'power' ? 0 : e.lo;
      const hi = lane.key === 'power' ? 100 : e.hi;
      const range = hi - lo || 1;
      ctx.fillStyle = '#64748b';
      ctx.fillText(`${hi.toFixed(1)}`, 6, y0 + 24);
      ctx.fillText(`${lo.toFixed(1)}`, 6, y0 + laneH - 4);
      const y = (v: number) => y0 + laneH - 3 - ((v - lo) / range) * (laneH - 6);
      ctx.strokeStyle = lane.color;
      ctx.fillStyle = lane.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < plotW; x++) {
        const mn = e.min[x]!;
        const mx = e.max[x]!;
        if (Number.isNaN(mn)) continue;
        if (lane.key === 'power') {
          if (mx > 0) ctx.fillRect(LABEL_W + x, y(mx), 1, y(0) - y(mx));
          continue;
        }
        ctx.moveTo(LABEL_W + x + 0.5, y(mx) - 0.5);
        ctx.lineTo(LABEL_W + x + 0.5, y(mn) + 0.5);
      }
      ctx.stroke();
    });
    if (tl) {
      for (const ev of tl.events) {
        const x = LABEL_W + ((ev.tS - t0) / (t1 - t0)) * plotW;
        ctx.strokeStyle = EVENT_COLORS[ev.kind] ?? '#475569';
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }, [env, width, height, plotW, tl, t0, t1]);

  // Cursor overlay redrawn on playback changes only.
  useEffect(() => {
    const draw = (tS: number) => {
      const c = over.current;
      if (!c || width === 0) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== width * dpr) {
        c.width = width * dpr;
        c.height = height * dpr;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const x = LABEL_W + ((tS - t0) / (t1 - t0)) * plotW;
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
      const s = tl ? sampleAt(tl, tS) : null;
      if (readout.current) {
        readout.current.textContent = s
          ? `t ${tS.toFixed(3)} s · Gx ${s.gx.toFixed(2)} Gy ${s.gy.toFixed(2)} · A ${s.a.toFixed(3)}° U ${s.u.toFixed(3)} · ${s.laser ? `laser ${s.power.toFixed(0)}%` : 'laser off'} · ${SAFETY_STATE_CODES[s.state] ?? '?'}`
          : '—';
      }
    };
    draw(usePlayback.getState().tS);
    return usePlayback.subscribe((s) => draw(s.tS));
  }, [width, height, plotW, t0, t1, tl]);

  const seekFromEvent = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left - LABEL_W;
    pb.seek(t0 + Math.min(1, Math.max(0, x / plotW)) * (t1 - t0));
  };

  const recent = tl ? tl.events.slice(-200) : [];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
          <div className="flex rounded-md border border-border p-0.5">
            {(['preview', 'machine'] as const).map((s) => (
              <Button key={s} size="sm" className={cn(source === s && 'bg-accent text-foreground')} onClick={() => pb.setSource(s)} data-testid={`timeline-${s}`}>
                {s === 'preview' ? 'Planned preview' : 'Sim machine'}
              </Button>
            ))}
          </div>
          <Button size="iconSm" aria-label="Rewind" onClick={() => pb.seek(t0)}>
            <SkipBack />
          </Button>
          <Button
            size="iconSm"
            aria-label={playing ? 'Pause playback' : 'Play'}
            data-testid="timeline-play"
            onClick={() => {
              if (!playing && usePlayback.getState().tS >= t1) pb.seek(t0);
              pb.setFollow(false);
              pb.setPlaying(!playing);
            }}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <Select className="h-6 w-20" value={String(rate)} onChange={(e) => pb.setRate(Number(e.currentTarget.value))} aria-label="Playback rate">
            {[0.1, 0.25, 0.5, 1, 2, 5, 10, 50].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </Select>
          {source === 'machine' && (
            <Tooltip content="Follow the live simulated machine">
              <Button size="sm" active={follow} onClick={() => pb.setFollow(!follow)}>
                <Radio /> Live
              </Button>
            </Tooltip>
          )}
          <span className="ml-2 truncate font-mono text-[10.5px] text-muted-foreground" ref={readout} data-testid="timeline-readout" />
          <div className="flex-1" />
          <span className="font-mono text-[10.5px] text-muted-foreground">{tl ? `${tl.t.length.toLocaleString()} samples · ${formatDuration(t1 - t0)}` : 'no timeline'}</span>
        </div>
        <div
          ref={host}
          className="relative min-h-0 flex-1 cursor-col-resize"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            seekFromEvent(e);
          }}
          onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e)}
          data-testid="timeline-chart"
        >
          <canvas ref={base} className="absolute inset-0 h-full w-full" />
          <canvas ref={over} className="pointer-events-none absolute inset-0 h-full w-full" />
          {!tl && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">{source === 'preview' ? 'Planning…' : 'Run a simulated job to record a timeline.'}</div>}
        </div>
      </div>
      <div className="w-64 shrink-0 overflow-auto border-l border-border font-mono text-[10.5px]">
        {recent.length === 0 && <div className="p-2 text-muted-foreground">No events</div>}
        {recent.map((ev, i) => (
          <button
            type="button"
            key={`${ev.tS}-${i}`}
            className="block w-full truncate px-2 py-0.5 text-left hover:bg-accent"
            style={{ color: EVENT_COLORS[ev.kind] }}
            title={ev.message}
            onClick={() => pb.seek(ev.tS)}
          >
            {ev.tS.toFixed(2)} {ev.kind}: <span className="text-foreground/80">{ev.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
