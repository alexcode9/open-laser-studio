import type { DesignObject } from '@ols/shared-types';
import { describe, expect, it } from 'vitest';

import { applyTransform, IDENTITY, localBounds, unionBounds, worldBounds } from './shapes';

const obj = (shape: DesignObject['shape'], transform = IDENTITY): DesignObject => ({
  id: 'o',
  name: 'o',
  layerId: 'l',
  visible: true,
  locked: false,
  transform,
  shape,
});

describe('shape bounds', () => {
  it('local bounds per shape kind', () => {
    expect(localBounds({ kind: 'rect', width: 10, height: 5 })).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
    expect(localBounds({ kind: 'ellipse', rx: 3, ry: 2 })).toEqual({ minX: -3, minY: -2, maxX: 3, maxY: 2 });
    expect(localBounds({ kind: 'line', points: [1, 2, -4, 8], closed: false })).toEqual({ minX: -4, minY: 2, maxX: 1, maxY: 8 });
    expect(localBounds({ kind: 'line', points: [1], closed: false })).toBeNull();
  });

  it('transform order is translate * rotate * scale (Konva)', () => {
    const t = { x: 10, y: 20, rotationDeg: 90, scaleX: 2, scaleY: 1 };
    const [x, y] = applyTransform(t, 1, 0);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(22);
  });

  it('world bounds of a rotated rectangle', () => {
    const b = worldBounds(obj({ kind: 'rect', width: 10, height: 4 }, { x: 0, y: 0, rotationDeg: 90, scaleX: 1, scaleY: 1 }))!;
    expect(b.minX).toBeCloseTo(-4);
    expect(b.maxX).toBeCloseTo(0);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(10);
  });

  it('union skips nulls', () => {
    expect(unionBounds([null, { minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: -1, minY: 2, maxX: 0, maxY: 3 }])).toEqual({
      minX: -1,
      minY: 0,
      maxX: 1,
      maxY: 3,
    });
    expect(unionBounds([])).toBeNull();
  });
});
