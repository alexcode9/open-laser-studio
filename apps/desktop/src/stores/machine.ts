import type { MachineCommand } from '@ols/ipc-contracts';
import type { Injection, JobLogEntry, PrepareReport, ProtocolLogEntry, SafetyTransition, SessionSnapshot, TimelineBuffers } from '@ols/shared-types';
import { create } from 'zustand';

import { call, errorMessage, subscribe } from '@/lib/ipc';

import { useProject } from './project';
import { toast } from './view';

const LOG_LIMIT = 3000;
const NUMERIC_KEYS = ['t', 'gx', 'gy', 'a', 'u', 'laser', 'power', 'state', 'section', 'segment', 'rotX', 'tx', 'spotX', 'spotY', 'spotZ'] as const;

interface MachineState {
  snapshot: SessionSnapshot | null;
  report: PrepareReport | null;
  timeline: TimelineBuffers | null;
  log: ProtocolLogEntry[];
  jobLog: JobLogEntry[];
  safety: SafetyTransition[];
  programListing: string[];
  busy: boolean;
  init: () => Promise<void>;
  command: (c: MachineCommand) => Promise<boolean>;
  inject: (i: Injection) => Promise<void>;
  refreshLogs: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  speed: number;
}

function concat(a: TimelineBuffers, b: TimelineBuffers): TimelineBuffers {
  const out = { events: [...a.events, ...b.events], durationS: Math.max(a.durationS, b.durationS) } as TimelineBuffers;
  for (const k of NUMERIC_KEYS) {
    const x = new Float64Array(a[k].length + b[k].length);
    x.set(a[k]);
    x.set(b[k], a[k].length);
    out[k] = x;
  }
  return out;
}

let fetching = false;
async function syncTimeline(snap: SessionSnapshot): Promise<void> {
  if (fetching) return;
  const cur = useMachine.getState().timeline;
  const have = cur?.t.length ?? 0;
  const haveEvents = cur?.events.length ?? 0;
  if (snap.timelineSamples === have && snap.timelineEvents === haveEvents) return;
  fetching = true;
  try {
    if (snap.timelineSamples < have) {
      useMachine.setState({ timeline: await call('machine:timeline', { fromSample: 0, fromEvent: 0 }) });
    } else {
      const chunk = await call('machine:timeline', { fromSample: have, fromEvent: haveEvents });
      const base = useMachine.getState().timeline;
      useMachine.setState({ timeline: base ? concat(base, chunk) : chunk });
    }
  } catch {
    // Next snapshot retries.
  } finally {
    fetching = false;
  }
}

let projectTimer: ReturnType<typeof setTimeout> | null = null;

export const useMachine = create<MachineState>((set, get) => ({
  snapshot: null,
  report: null,
  timeline: null,
  log: [],
  jobLog: [],
  safety: [],
  programListing: [],
  busy: false,
  speed: 1,

  init: async () => {
    const project = useProject.getState().project;
    if (!project) return;
    subscribe('machine:snapshot', (snap) => {
      set({ snapshot: snap });
      void syncTimeline(snap);
    });
    const snap = await call('machine:create', { project });
    set({ snapshot: snap, timeline: null, log: [], report: null });
    useProject.subscribe((s, prev) => {
      if (!s.project || s.project === prev.project) return;
      if (projectTimer) clearTimeout(projectTimer);
      const p = s.project;
      projectTimer = setTimeout(() => {
        const st = get().snapshot?.safetyState;
        // Never swap the job under an armed or running machine.
        if (st && ['ARMED', 'RUNNING', 'PAUSED', 'STOPPING'].includes(st)) return;
        call('machine:setProject', { project: p })
          .then((snapshot) => set({ snapshot, report: null }))
          .catch(() => {});
      }, 300);
    });
  },

  command: async (c) => {
    set({ busy: true });
    try {
      const r = await call('machine:command', c);
      set({ snapshot: r.snapshot, ...(r.report ? { report: r.report } : {}) });
      if (c.cmd === 'prepare' || c.cmd === 'start') {
        const programListing = await call('machine:programListing');
        set({ programListing });
      }
      if (r.report && !r.report.ok) toast('warn', `Preparation failed: ${r.report.errors[0] ?? 'see report'}`);
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      set({ busy: false });
      void get().refreshLogs();
    }
  },

  inject: async (i) => {
    try {
      set({ snapshot: await call('machine:inject', i) });
      toast('warn', `Injected: ${i.kind.type}`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  },

  refreshLogs: async () => {
    const last = get().log[get().log.length - 1]?.seq ?? 0;
    try {
      const [entries, jobLog, safety] = await Promise.all([
        call('machine:log', { sinceSeq: last }),
        call('machine:jobLog'),
        call('machine:safetyHistory'),
      ]);
      const fresh = entries.filter((e) => e.seq > last);
      set((s) => ({ log: fresh.length ? [...s.log, ...fresh].slice(-LOG_LIMIT) : s.log, jobLog, safety }));
    } catch {
      // Machine not created yet.
    }
  },

  setSpeed: async (speed) => {
    const r = await call('machine:setSpeed', { speed });
    set({ speed: r.speed });
  },
}));
