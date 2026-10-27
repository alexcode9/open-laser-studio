import type { SafetyState } from '@ols/shared-types';
import { cn } from '@ols/ui';

const TONES: Record<SafetyState, string> = {
  DISCONNECTED: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/40',
  CONNECTED: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
  IDLE: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
  PREPARING: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
  READY: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  ARMED: 'bg-amber-500/20 text-amber-200 ring-amber-400/70',
  RUNNING: 'bg-orange-500/25 text-orange-200 ring-orange-400/80 animate-pulse',
  PAUSED: 'bg-amber-500/15 text-amber-300 ring-amber-500/50',
  STOPPING: 'bg-amber-500/15 text-amber-300 ring-amber-500/50',
  FAULT: 'bg-red-500/20 text-red-300 ring-red-500/60',
  ESTOP: 'bg-red-600/30 text-red-200 ring-red-500/80',
};

export function SafetyPill({ state, className }: { state: SafetyState; className?: string }) {
  return (
    <span
      data-testid="safety-state"
      className={cn('inline-flex h-6 items-center rounded px-2 font-mono text-[11px] font-semibold tracking-wide ring-1', TONES[state], className)}
    >
      {state}
    </span>
  );
}
