import type { TimelineBuffers } from '@ols/shared-types';
import { create } from 'zustand';

import { useMachine } from './machine';
import { usePlan } from './plan';

export type TimelineSource = 'preview' | 'machine';

interface PlaybackState {
  source: TimelineSource;
  tS: number;
  playing: boolean;
  rate: number;
  /** Follow the live machine timeline (cursor pinned to the newest sample). */
  follow: boolean;
  setSource: (s: TimelineSource) => void;
  seek: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setRate: (r: number) => void;
  setFollow: (f: boolean) => void;
}

export const usePlayback = create<PlaybackState>((set) => ({
  source: 'preview',
  tS: 0,
  playing: false,
  rate: 1,
  follow: true,
  setSource: (source) => set({ source, tS: 0, playing: false }),
  seek: (tS) => set({ tS, follow: false }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  setFollow: (follow) => set({ follow }),
}));

export function activeTimeline(): TimelineBuffers | null {
  return usePlayback.getState().source === 'preview' ? usePlan.getState().preview : useMachine.getState().timeline;
}

export function useActiveTimeline(): TimelineBuffers | null {
  const source = usePlayback((s) => s.source);
  const preview = usePlan((s) => s.preview);
  const machine = useMachine((s) => s.timeline);
  return source === 'preview' ? preview : machine;
}

/** Index of the last sample with `t <= tS` (binary search). */
export function sampleIndex(tl: TimelineBuffers, tS: number): number {
  const t = tl.t;
  if (t.length === 0) return -1;
  let lo = 0;
  let hi = t.length - 1;
  if (tS <= t[0]!) return 0;
  if (tS >= t[hi]!) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= tS) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface SampleAt {
  i: number;
  gx: number;
  gy: number;
  a: number;
  u: number;
  laser: boolean;
  power: number;
  state: number;
  section: number;
  segment: number;
  rotX: number;
  tx: number;
  spot: [number, number, number];
}

/** Linearly interpolated sample (discrete channels take the earlier sample). */
export function sampleAt(tl: TimelineBuffers, tS: number): SampleAt | null {
  const i = sampleIndex(tl, tS);
  if (i < 0) return null;
  const j = Math.min(i + 1, tl.t.length - 1);
  const t0 = tl.t[i]!;
  const t1 = tl.t[j]!;
  const f = t1 > t0 ? Math.min(1, Math.max(0, (tS - t0) / (t1 - t0))) : 0;
  const lerp = (c: Float64Array) => c[i]! + (c[j]! - c[i]!) * f;
  return {
    i,
    gx: lerp(tl.gx),
    gy: lerp(tl.gy),
    a: lerp(tl.a),
    u: lerp(tl.u),
    laser: tl.laser[i]! > 0.5,
    power: tl.power[i]!,
    state: tl.state[i]!,
    section: tl.section[i]!,
    segment: tl.segment[i]!,
    rotX: lerp(tl.rotX),
    tx: lerp(tl.tx),
    spot: [lerp(tl.spotX), lerp(tl.spotY), lerp(tl.spotZ)],
  };
}

let raf = 0;
let last = 0;
function loop(now: number): void {
  const st = usePlayback.getState();
  const dt = last ? (now - last) / 1000 : 0;
  last = now;
  const tl = activeTimeline();
  if (tl && tl.t.length > 0) {
    const end = tl.t[tl.t.length - 1]!;
    if (st.source === 'machine' && st.follow) {
      if (st.tS !== end) usePlayback.setState({ tS: end });
    } else if (st.playing) {
      const t = st.tS + dt * st.rate;
      usePlayback.setState(t >= end ? { tS: end, playing: false } : { tS: t });
    }
  }
  raf = requestAnimationFrame(loop);
}

export function startPlaybackLoop(): () => void {
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
