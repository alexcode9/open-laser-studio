import { pathBounds } from '@ols/geometry-adapters';
import type { Bounds, DesignObject, Shape, Transform2 } from '@ols/shared-types';

/** Shape bounds in the object's local (untransformed) frame. */
export function localBounds(shape: Shape): Bounds | null {
  switch (shape.kind) {
    case 'rect':
      return { minX: 0, minY: 0, maxX: shape.width, maxY: shape.height };
    case 'ellipse':
      return { minX: -shape.rx, minY: -shape.ry, maxX: shape.rx, maxY: shape.ry };
    case 'line': {
      if (shape.points.length < 2) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < shape.points.length; i += 2) {
        const x = shape.points[i]!;
        const y = shape.points[i + 1]!;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return { minX, minY, maxX, maxY };
    }
    case 'path':
      return pathBounds(shape.commands);
    case 'text':
      return shape.outline ? pathBounds(shape.outline) : { minX: 0, minY: 0, maxX: shape.text.length * shape.fontSizeMm * 0.6, maxY: shape.fontSizeMm };
    case 'image':
      return { minX: 0, minY: 0, maxX: shape.widthMm, maxY: shape.heightMm };
  }
}

export function applyTransform(t: Transform2, x: number, y: number): [number, number] {
  const r = (t.rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const sx = x * t.scaleX;
  const sy = y * t.scaleY;
  return [t.x + sx * c - sy * s, t.y + sx * s + sy * c];
}

/** Axis-aligned bounds of an object in design coordinates. */
export function worldBounds(o: DesignObject): Bounds | null {
  const b = localBounds(o.shape);
  if (!b) return null;
  const pts = [
    applyTransform(o.transform, b.minX, b.minY),
    applyTransform(o.transform, b.maxX, b.minY),
    applyTransform(o.transform, b.maxX, b.maxY),
    applyTransform(o.transform, b.minX, b.maxY),
  ];
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])),
    maxX: Math.max(...pts.map((p) => p[0])),
    maxY: Math.max(...pts.map((p) => p[1])),
  };
}

export function unionBounds(list: (Bounds | null)[]): Bounds | null {
  let out: Bounds | null = null;
  for (const b of list) {
    if (!b) continue;
    out = out
      ? { minX: Math.min(out.minX, b.minX), minY: Math.min(out.minY, b.minY), maxX: Math.max(out.maxX, b.maxX), maxY: Math.max(out.maxY, b.maxY) }
      : { ...b };
  }
  return out;
}

export const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export const IDENTITY: Transform2 = { x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 };
