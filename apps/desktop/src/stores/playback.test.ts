import type { TimelineBuffers } from '@ols/shared-types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./machine', () => ({ useMachine: { getState: () => ({ timeline: null }) } }));
vi.mock('./plan', () => ({ usePlan: { getState: () => ({ preview: null }) } }));

const { sampleAt, sampleIndex } = await import('./playback');

function timeline(t: number[]): TimelineBuffers {
  const f = (fn: (i: number) => number) => Float64Array.from(t.map((_, i) => fn(i)));
  return {
    t: Float64Array.from(t),
    gx: f((i) => i * 10),
    gy: f(() => 0),
    a: f((i) => i * 90),
    u: f(() => 5),
    laser: f((i) => (i === 1 ? 1 : 0)),
    power: f((i) => (i === 1 ? 40 : 0)),
    state: f(() => 0),
    section: f(() => 0),
    segment: f((i) => i),
    rotX: f(() => 0),
    tx: f(() => 0),
    spotX: f(() => 0),
    spotY: f(() => 0),
    spotZ: f(() => 0),
  } as unknown as TimelineBuffers;
}

describe('timeline sampling', () => {
  const tl = timeline([0, 1, 2, 4]);

  it('binary search clamps at the ends', () => {
    expect(sampleIndex(tl, -1)).toBe(0);
    expect(sampleIndex(tl, 0.5)).toBe(0);
    expect(sampleIndex(tl, 1)).toBe(1);
    expect(sampleIndex(tl, 3.9)).toBe(2);
    expect(sampleIndex(tl, 99)).toBe(3);
    expect(sampleIndex(timeline([]), 1)).toBe(-1);
  });

  it('interpolates continuous channels, holds discrete ones', () => {
    const s = sampleAt(tl, 1.5)!;
    expect(s.gx).toBeCloseTo(15);
    expect(s.a).toBeCloseTo(135);
    expect(s.laser).toBe(true);
    expect(s.power).toBe(40);
    expect(s.segment).toBe(1);
    expect(sampleAt(tl, 3)!.a).toBeCloseTo(225);
  });
});
