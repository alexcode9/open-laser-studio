import { toSvgPathData } from '@ols/geometry-adapters';
import type { DesignObject, Layer, Project } from '@ols/shared-types';

import { workspaceBounds } from '@/lib/head';

const MAX_TEX = 4096;
const images = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = images.get(src);
  if (cached?.complete) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      images.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

function shapePath(o: DesignObject): Path2D | null {
  const s = o.shape;
  switch (s.kind) {
    case 'rect': {
      const p = new Path2D();
      p.rect(0, 0, s.width, s.height);
      return p;
    }
    case 'ellipse': {
      const p = new Path2D();
      p.ellipse(0, 0, s.rx, s.ry, 0, 0, Math.PI * 2);
      return p;
    }
    case 'line': {
      const p = new Path2D();
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        if (i === 0) p.moveTo(s.points[0]!, s.points[1]!);
        else p.lineTo(s.points[i]!, s.points[i + 1]!);
      }
      if (s.closed) p.closePath();
      return p;
    }
    case 'path':
      return new Path2D(toSvgPathData(s.commands));
    case 'text':
      return s.outline ? new Path2D(toSvgPathData(s.outline)) : null;
    case 'image':
      return null;
  }
}

/**
 * Render the document into a canvas covering the workspace (`ppm` pixels per mm). In cylinder
 * mode artwork outside `0..C` is wrapped, matching the mesh UVs `(u / L, s / C)`.
 */
export async function renderArtwork(project: Project, base: string): Promise<HTMLCanvasElement> {
  const b = workspaceBounds(project);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const ppm = Math.max(1, Math.min(8, MAX_TEX / Math.max(w, h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(w * ppm));
  canvas.height = Math.max(2, Math.round(h * ppm));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const layers = new Map<string, Layer>(project.document.layers.map((l) => [l.id, l]));
  const wraps = project.mode === 'cylinder' ? [-h, 0, h] : [0];
  for (const o of project.document.objects) {
    const layer = layers.get(o.layerId);
    if (!layer?.visible || !layer.output || !o.visible) continue;
    const img = o.shape.kind === 'image' ? project.assets[o.shape.assetId] : undefined;
    const loaded = img ? await loadImage(img).catch(() => null) : null;
    const path = shapePath(o);
    for (const dy of wraps) {
      ctx.save();
      ctx.scale(ppm, ppm);
      ctx.translate(-b.minX, -b.minY + dy);
      const t = o.transform;
      ctx.translate(t.x, t.y);
      ctx.rotate((t.rotationDeg * Math.PI) / 180);
      ctx.scale(t.scaleX, t.scaleY);
      if (loaded && o.shape.kind === 'image') {
        ctx.globalAlpha = 0.85;
        ctx.filter = 'grayscale(1) contrast(1.2)';
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(loaded, 0, 0, o.shape.widthMm, o.shape.heightMm);
      } else if (path) {
        const engraved = 'rgba(28,20,14,0.9)';
        if (layer.settings.mode === 'fill') {
          ctx.fillStyle = engraved;
          ctx.fill(path, 'evenodd');
        }
        ctx.strokeStyle = engraved;
        ctx.lineWidth = 0.35 / Math.max(1e-3, Math.min(Math.abs(t.scaleX), Math.abs(t.scaleY)));
        ctx.stroke(path);
      }
      ctx.restore();
    }
  }
  return canvas;
}
