import type { Bounds, PathCmd } from '@ols/shared-types';

const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();

/** SVG path data for a command list (used for Konva `Path` and SVG thumbnails). */
export function toSvgPathData(cmds: readonly PathCmd[]): string {
  const parts: string[] = [];
  for (const c of cmds) {
    switch (c.t) {
      case 'M':
        parts.push(`M${fmt(c.x)} ${fmt(c.y)}`);
        break;
      case 'L':
        parts.push(`L${fmt(c.x)} ${fmt(c.y)}`);
        break;
      case 'Q':
        parts.push(`Q${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x)} ${fmt(c.y)}`);
        break;
      case 'C':
        parts.push(`C${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`);
        break;
      case 'Z':
        parts.push('Z');
        break;
    }
  }
  return parts.join(' ');
}

/** Control-point bounds (a conservative superset of the exact curve bounds). */
export function pathBounds(cmds: readonly PathCmd[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const c of cmds) {
    if (c.t === 'Z') continue;
    if (c.t === 'Q') add(c.x1, c.y1);
    if (c.t === 'C') {
      add(c.x1, c.y1);
      add(c.x2, c.y2);
    }
    add(c.x, c.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Translate commands so their bounds start at the origin; returns the removed offset. */
export function normalizePath(cmds: readonly PathCmd[]): { commands: PathCmd[]; dx: number; dy: number } {
  const b = pathBounds(cmds);
  if (!b) return { commands: [...cmds], dx: 0, dy: 0 };
  const dx = b.minX;
  const dy = b.minY;
  const commands = cmds.map((c): PathCmd => {
    switch (c.t) {
      case 'M':
      case 'L':
        return { ...c, x: c.x - dx, y: c.y - dy };
      case 'Q':
        return { ...c, x1: c.x1 - dx, y1: c.y1 - dy, x: c.x - dx, y: c.y - dy };
      case 'C':
        return { ...c, x1: c.x1 - dx, y1: c.y1 - dy, x2: c.x2 - dx, y2: c.y2 - dy, x: c.x - dx, y: c.y - dy };
      case 'Z':
        return c;
    }
  });
  return { commands, dx, dy };
}
