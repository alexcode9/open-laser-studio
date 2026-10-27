import { aDegToS, circumference, seamLines, sToADeg } from '@ols/geometry-adapters';
import type { Bounds, Project, Section } from '@ols/shared-types';
import type Konva from 'konva';
import { Group, Line, Rect, Shape, Text } from 'react-konva';

function gridStep(zoom: number): number {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200]) if (s * zoom >= 8) return s;
  return 500;
}

/** Adaptive millimetre grid (major line every 10 minor steps), clipped to the visible area. */
export function Grid({ view, zoom }: { view: Bounds; zoom: number }) {
  const styles = getComputedStyle(document.documentElement);
  const minor = styles.getPropertyValue('--canvas-grid').trim() || 'rgba(255,255,255,0.05)';
  const major = styles.getPropertyValue('--canvas-grid-major').trim() || 'rgba(255,255,255,0.1)';
  const step = gridStep(zoom);
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx: Konva.Context) => {
        const draw = (st: number, color: string) => {
          ctx.beginPath();
          for (let x = Math.floor(view.minX / st) * st; x <= view.maxX; x += st) {
            ctx.moveTo(x, view.minY);
            ctx.lineTo(x, view.maxY);
          }
          for (let y = Math.floor(view.minY / st) * st; y <= view.maxY; y += st) {
            ctx.moveTo(view.minX, y);
            ctx.lineTo(view.maxX, y);
          }
          ctx.setAttr('strokeStyle', color);
          ctx.setAttr('lineWidth', 1 / zoom);
          ctx.stroke();
        };
        draw(step, minor);
        draw(step * 10, major);
      }}
    />
  );
}

/** Workspace frame: galvo field (flat) or unwrapped cylinder surface with seams and A ticks. */
export function Workspace({ project, view, zoom }: { project: Project; view: Bounds; zoom: number }) {
  const work = getComputedStyle(document.documentElement).getPropertyValue('--canvas-work').trim() || '#151a20';
  const px = 1 / zoom;
  const font = 11 * px;
  if (project.mode === 'flat') {
    const g = project.machine.galvo;
    return (
      <Group listening={false}>
        <Rect width={g.fieldWidthMm} height={g.fieldHeightMm} fill={work} stroke="#64748b" strokeWidth={px} />
        <Line points={[g.centerXMm - 4, g.centerYMm, g.centerXMm + 4, g.centerYMm]} stroke="#64748b" strokeWidth={px} />
        <Line points={[g.centerXMm, g.centerYMm - 4, g.centerXMm, g.centerYMm + 4]} stroke="#64748b" strokeWidth={px} />
        <Text x={0} y={-16 * px} text={`Galvo field ${g.fieldWidthMm} × ${g.fieldHeightMm} mm`} fontSize={font} fill="#94a3b8" />
      </Group>
    );
  }
  const w = project.workpiece;
  const C = circumference(w);
  const L = w.lengthMm;
  const seams = seamLines(w, view.minY, view.maxY);
  const ticks: { s: number; a: number }[] = [];
  for (let a = -720; a <= 720; a += 30) {
    const s = aDegToS(w, w.angularZeroDeg + a);
    if (s >= view.minY && s <= view.maxY) ticks.push({ s, a: w.angularZeroDeg + a });
  }
  return (
    <Group listening={false}>
      {/* Wrapped copies above/below: the same surface seen across the seam. */}
      <Rect y={-C} width={L} height={C} fill={work} opacity={0.35} />
      <Rect y={C} width={L} height={C} fill={work} opacity={0.35} />
      <Rect width={L} height={C} fill={work} stroke="#64748b" strokeWidth={px} />
      {seams.map((s) => (
        <Group key={s}>
          <Line points={[-10, s, L + 10, s]} stroke="#38bdf8" strokeWidth={1.5 * px} dash={[6 * px, 4 * px]} />
          <Text x={L + 12 * px} y={s - 6 * px} text={`seam (A = ${sToADeg(w, s).toFixed(1)}°)`} fontSize={font} fill="#38bdf8" />
        </Group>
      ))}
      {ticks.map(({ s, a }) => (
        <Group key={`a${a}`}>
          <Line points={[-6 * px, s, 0, s]} stroke="#94a3b8" strokeWidth={px} />
          <Text x={-48 * px} y={s - 5 * px} width={40 * px} align="right" text={`${a.toFixed(0)}°`} fontSize={10 * px} fill="#94a3b8" />
        </Group>
      ))}
      <Text x={0} y={-16 * px} text={`Unwrapped surface: u (axial) 0…${L} mm × s (circumference) 0…${C.toFixed(2)} mm   Ø ${w.diameterMm} mm`} fontSize={font} fill="#94a3b8" />
    </Group>
  );
}

export function Sections({ sections, zoom }: { sections: Section[]; zoom: number }) {
  const px = 1 / zoom;
  return (
    <Group listening={false}>
      {sections.map((s) => {
        const b = s.surfaceBounds;
        return (
          <Group key={s.index}>
            <Rect x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} stroke="#a78bfa" strokeWidth={px} dash={[3 * px, 3 * px]} opacity={0.7} />
            <Text x={b.minX + 2 * px} y={b.minY + 2 * px} text={`#${s.index + 1}  A ${s.aDeg.toFixed(1)}°  U ${s.machineUMm.toFixed(1)}`} fontSize={9 * px} fill="#a78bfa" opacity={0.85} />
          </Group>
        );
      })}
    </Group>
  );
}

/** Planned toolpath (`[x0, y0, x1, y1, kind]` per segment) drawn in one canvas pass. */
export function ToolpathOverlay({ segments, zoom, showTravel }: { segments: Float32Array; zoom: number; showTravel: boolean }) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx: Konva.Context) => {
        const n = Math.floor(segments.length / 5);
        const pass = (kind: number, color: string, width: number, dash: number[]) => {
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const o = i * 5;
            if (segments[o + 4] !== kind) continue;
            ctx.moveTo(segments[o]!, segments[o + 1]!);
            ctx.lineTo(segments[o + 2]!, segments[o + 3]!);
          }
          ctx.setAttr('strokeStyle', color);
          ctx.setAttr('lineWidth', width / zoom);
          ctx.setLineDash(dash.map((d) => d / zoom));
          ctx.stroke();
        };
        if (showTravel) pass(0, 'rgba(148,163,184,0.45)', 0.75, [3, 3]);
        pass(1, 'rgba(250,250,250,0.85)', 0.9, []);
        ctx.setLineDash([]);
      }}
    />
  );
}
