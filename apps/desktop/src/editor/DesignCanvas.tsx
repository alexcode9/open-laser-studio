import type { DesignObject, Transform2 } from '@ols/shared-types';
import { Button, Tooltip, cn } from '@ols/ui';
import type Konva from 'konva';
import { Eye, Footprints, Grid2x2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Ellipse, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';

import { addText, registerThumbnailProvider } from '@/lib/actions';
import { headDesignPos, workspaceBounds } from '@/lib/head';
import { IDENTITY, newId, worldBounds } from '@/lib/shapes';
import { useSize } from '@/lib/useSize';
import { usePlan } from '@/stores/plan';
import { activeTimeline, sampleAt, usePlayback } from '@/stores/playback';
import { useProject } from '@/stores/project';
import { useView } from '@/stores/view';

import { ObjectNode } from './ObjectNode';
import { Grid, Sections, ToolpathOverlay, Workspace } from './Overlays';

type Draft =
  | { kind: 'rect' | 'ellipse'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'line'; points: number[]; hover: [number, number] | null }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean };

const round = (v: number, step = 0.01) => Math.round(v / step) * step;

function nodeTransform(n: Konva.Node): Transform2 {
  return { x: round(n.x(), 0.001), y: round(n.y(), 0.001), rotationDeg: round(n.rotation(), 0.001), scaleX: round(n.scaleX(), 0.0001), scaleY: round(n.scaleY(), 0.0001) };
}

export function DesignCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const headRef = useRef<Konva.Circle>(null);
  const { width, height } = useSize(hostRef);

  const project = useProject((s) => s.project)!;
  const selection = useProject((s) => s.selection);
  const select = useProject((s) => s.select);
  const setTransforms = useProject((s) => s.setTransforms);
  const addObjects = useProject((s) => s.addObjects);
  const activeLayerId = useProject((s) => s.activeLayerId);
  const { tool, zoom, panX, panY, setView, setCursor, showToolpath, showTravel, showSections, fitRequest, toggle, setTool } = useView(
    useShallow((s) => ({
      tool: s.tool,
      zoom: s.zoom,
      panX: s.panX,
      panY: s.panY,
      setView: s.setView,
      setCursor: s.setCursor,
      showToolpath: s.showToolpath,
      showTravel: s.showTravel,
      showSections: s.showSections,
      fitRequest: s.fitRequest,
      toggle: s.toggle,
      setTool: s.setTool,
    })),
  );
  const plan = usePlan((s) => s.result);
  const planned = usePlan((s) => s.planned);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const layers = useMemo(() => new Map(project.document.layers.map((l) => [l.id, l])), [project.document.layers]);
  const selSet = useMemo(() => new Set(selection), [selection]);

  // Fit the workspace into view on request and when the mode changes.
  const fit = useCallback(() => {
    if (width === 0 || height === 0) return;
    const b = workspaceBounds(project);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const z = Math.min((width - 120) / w, (height - 80) / h);
    const zz = Math.max(0.2, Math.min(200, z));
    setView(zz, (width - w * zz) / 2 - b.minX * zz + 20, (height - h * zz) / 2 - b.minY * zz);
  }, [width, height, project, setView]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [fitRequest, project.mode, width > 0 && height > 0]);

  // Attach the transformer to selected, unlocked nodes.
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = selection
      .map((id) => stage.findOne(`#${id}`))
      .filter((n): n is Konva.Node => !!n)
      .filter((n) => !project.document.objects.find((o) => o.id === n.id())?.locked);
    tr.nodes(tool === 'select' ? nodes : []);
    tr.getLayer()?.batchDraw();
  }, [selection, project.document.objects, tool]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === 'Space' && !(e.target instanceof HTMLInputElement) && setSpaceDown(true);
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Playback head: imperative updates so the editor does not re-render every frame.
  useEffect(() => {
    return usePlayback.subscribe((st) => {
      const head = headRef.current;
      const tl = activeTimeline();
      const p = useProject.getState().project;
      if (!head || !tl || !p) return;
      const s = sampleAt(tl, st.tS);
      if (!s) {
        head.visible(false);
        return;
      }
      const [x, y] = headDesignPos(p, s.gx, s.gy, s.a, s.u);
      head.position({ x, y });
      head.fill(s.laser ? '#ef4444' : '#38bdf8');
      head.visible(true);
      head.getLayer()?.batchDraw();
    });
  }, []);

  useEffect(() => {
    registerThumbnailProvider(async () => {
      const stage = stageRef.current;
      if (!stage) return null;
      const url = stage.toDataURL({ mimeType: 'image/png', pixelRatio: Math.min(1, 256 / Math.max(stage.width(), stage.height())) });
      const bin = atob(url.split(',')[1] ?? '');
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    });
    return () => registerThumbnailProvider(null);
  }, []);

  const view = useMemo(
    () => ({ minX: -panX / zoom, minY: -panY / zoom, maxX: (width - panX) / zoom, maxY: (height - panY) / zoom }),
    [panX, panY, zoom, width, height],
  );

  const pointer = (): [number, number] | null => {
    const p = stageRef.current?.getRelativePointerPosition();
    return p ? [p.x, p.y] : null;
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const factor = Math.exp(-e.evt.deltaY * 0.0015);
    const z = Math.max(0.2, Math.min(400, zoom * factor));
    const mx = (pos.x - panX) / zoom;
    const my = (pos.y - panY) / zoom;
    setView(z, pos.x - mx * z, pos.y - my * z);
  };

  const onSelectObject = useCallback(
    (id: string, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (useView.getState().tool !== 'select' || e.evt.button !== 0) return;
      e.cancelBubble = true;
      const sel = useProject.getState().selection;
      if (e.evt.shiftKey || e.evt.ctrlKey) select([id], true);
      else if (!sel.includes(id)) {
        // Selecting a grouped object selects the whole group.
        const obj = useProject.getState().project?.document.objects.find((o) => o.id === id);
        const group = obj?.groupId ? useProject.getState().project!.document.objects.filter((o) => o.groupId === obj.groupId).map((o) => o.id) : [id];
        select(group);
      }
    },
    [select],
  );

  const commitNodes = useCallback(() => {
    const tr = trRef.current;
    if (!tr) return;
    const t: Record<string, Transform2> = {};
    for (const n of tr.nodes()) t[n.id()] = nodeTransform(n);
    setTransforms(t);
  }, [setTransforms]);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const tr = trRef.current;
      if (tr && tr.nodes().length > 0) commitNodes();
      else setTransforms({ [e.target.id()]: nodeTransform(e.target) });
    },
    [commitNodes, setTransforms],
  );

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = pointer();
    if (!p) return;
    if (e.evt.button === 1 || tool === 'pan' || spaceDown) {
      setPanning({ x: e.evt.clientX, y: e.evt.clientY, px: panX, py: panY });
      return;
    }
    if (e.evt.button !== 0) return;
    const onEmpty = e.target === e.target.getStage() || !e.target.findAncestor('.design-object', true);
    if (tool === 'select') {
      if (onEmpty && !e.target.findAncestor('Transformer')) setDraft({ kind: 'marquee', x0: p[0], y0: p[1], x1: p[0], y1: p[1], additive: e.evt.shiftKey });
      return;
    }
    if (tool === 'rect' || tool === 'ellipse') setDraft({ kind: tool, x0: p[0], y0: p[1], x1: p[0], y1: p[1] });
    if (tool === 'line') {
      setDraft((d) => (d?.kind === 'line' ? { ...d, points: [...d.points, round(p[0]), round(p[1])] } : { kind: 'line', points: [round(p[0]), round(p[1])], hover: null }));
    }
    if (tool === 'text') {
      void addText(round(p[0]), round(p[1]));
      setTool('select');
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = pointer();
    if (p) setCursor({ x: p[0], y: p[1] });
    if (panning) {
      setView(zoom, panning.px + e.evt.clientX - panning.x, panning.py + e.evt.clientY - panning.y);
      return;
    }
    if (!p || !draft) return;
    if (draft.kind === 'line') setDraft({ ...draft, hover: p });
    else setDraft({ ...draft, x1: p[0], y1: p[1] });
  };

  const finishShape = (obj: Omit<DesignObject, 'id' | 'layerId' | 'visible' | 'locked' | 'groupId'>) => {
    if (!activeLayerId) return;
    addObjects([{ ...obj, id: newId('obj'), layerId: activeLayerId, visible: true, locked: false, groupId: null }]);
  };

  const onMouseUp = () => {
    if (panning) {
      setPanning(null);
      return;
    }
    if (!draft) return;
    if (draft.kind === 'marquee') {
      const minX = Math.min(draft.x0, draft.x1);
      const maxX = Math.max(draft.x0, draft.x1);
      const minY = Math.min(draft.y0, draft.y1);
      const maxY = Math.max(draft.y0, draft.y1);
      if (maxX - minX < 0.5 / zoom && maxY - minY < 0.5 / zoom) {
        if (!draft.additive) select([]);
      } else {
        const hits = project.document.objects
          .filter((o) => o.visible && !o.locked && layers.get(o.layerId)?.visible !== false && !layers.get(o.layerId)?.locked)
          .filter((o) => {
            const b = worldBounds(o);
            return b && b.minX <= maxX && b.maxX >= minX && b.minY <= maxY && b.maxY >= minY;
          })
          .map((o) => o.id);
        select(hits, draft.additive);
      }
      setDraft(null);
      return;
    }
    if (draft.kind === 'rect' || draft.kind === 'ellipse') {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);
      setDraft(null);
      if (w < 0.2 || h < 0.2) return;
      if (draft.kind === 'rect') finishShape({ name: 'Rectangle', transform: { ...IDENTITY, x: round(x), y: round(y) }, shape: { kind: 'rect', width: round(w), height: round(h) } });
      else finishShape({ name: 'Ellipse', transform: { ...IDENTITY, x: round(x + w / 2), y: round(y + h / 2) }, shape: { kind: 'ellipse', rx: round(w / 2), ry: round(h / 2) } });
    }
  };

  const onDblClick = () => {
    if (draft?.kind !== 'line') return;
    const pts = draft.points;
    setDraft(null);
    // The double-click's second mousedown added a duplicate point.
    const clean = pts.length >= 4 && pts[pts.length - 2] === pts[pts.length - 4] && pts[pts.length - 1] === pts[pts.length - 3] ? pts.slice(0, -2) : pts;
    if (clean.length < 4) return;
    const xs = clean.filter((_, i) => i % 2 === 0);
    const ys = clean.filter((_, i) => i % 2 === 1);
    const ox = Math.min(...xs);
    const oy = Math.min(...ys);
    const closed = clean.length >= 6 && Math.hypot(clean[0]! - clean[clean.length - 2]!, clean[1]! - clean[clean.length - 1]!) < 6 / zoom;
    const points = (closed ? clean.slice(0, -2) : clean).map((v, i) => round(v - (i % 2 === 0 ? ox : oy)));
    finishShape({ name: closed ? 'Polygon' : 'Polyline', transform: { ...IDENTITY, x: ox, y: oy }, shape: { kind: 'line', points, closed } });
  };

  const cursor = panning ? 'grabbing' : tool === 'pan' || spaceDown ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  const segments = showToolpath && plan && planned?.mode === project.mode ? plan.segments2d : null;

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden bg-[var(--canvas-bg)]" style={{ cursor }} data-testid="design-canvas">
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        scaleX={zoom}
        scaleY={zoom}
        x={panX}
        y={panY}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => setCursor(null)}
        onDblClick={onDblClick}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          if (draft?.kind === 'line') onDblClick();
        }}
      >
        <Layer listening={false}>
          <Workspace project={project} view={view} zoom={zoom} />
          <Grid view={view} zoom={zoom} />
          {showSections && project.mode === 'cylinder' && plan && planned?.mode === 'cylinder' && <Sections sections={plan.summary.sections} zoom={zoom} />}
        </Layer>
        <Layer>
          {project.document.objects.map((o) => {
            const layer = layers.get(o.layerId);
            if (!layer || !layer.visible || !o.visible) return null;
            const locked = o.locked || layer.locked;
            return (
              <ObjectNode
                key={o.id}
                obj={o}
                layer={layer}
                asset={o.shape.kind === 'image' ? project.assets[o.shape.assetId] : undefined}
                draggable={tool === 'select' && !locked && !spaceDown}
                selected={selSet.has(o.id)}
                onSelect={onSelectObject}
                onDragEnd={onDragEnd}
                onTransformEnd={commitNodes}
              />
            );
          })}
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio={false}
            ignoreStroke
            flipEnabled={false}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={4}
            anchorSize={7}
            borderStroke="#f97316"
            anchorStroke="#f97316"
            anchorFill="#0b0d10"
            boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 2 || Math.abs(newBox.height) < 2 ? oldBox : newBox)}
          />
        </Layer>
        <Layer listening={false}>
          {segments && <ToolpathOverlay segments={segments} zoom={zoom} showTravel={showTravel} />}
          <Circle ref={headRef} radius={4 / zoom} fill="#38bdf8" stroke="#0b0d10" strokeWidth={1 / zoom} visible={false} />
          {draft?.kind === 'marquee' && (
            <Rect
              x={Math.min(draft.x0, draft.x1)}
              y={Math.min(draft.y0, draft.y1)}
              width={Math.abs(draft.x1 - draft.x0)}
              height={Math.abs(draft.y1 - draft.y0)}
              stroke="#f97316"
              strokeWidth={1 / zoom}
              dash={[4 / zoom, 3 / zoom]}
              fill="rgba(249,115,22,0.06)"
            />
          )}
          {draft?.kind === 'rect' && (
            <Rect x={Math.min(draft.x0, draft.x1)} y={Math.min(draft.y0, draft.y1)} width={Math.abs(draft.x1 - draft.x0)} height={Math.abs(draft.y1 - draft.y0)} stroke="#f97316" strokeWidth={1 / zoom} />
          )}
          {draft?.kind === 'ellipse' && (
            <Ellipse x={(draft.x0 + draft.x1) / 2} y={(draft.y0 + draft.y1) / 2} radiusX={Math.abs(draft.x1 - draft.x0) / 2} radiusY={Math.abs(draft.y1 - draft.y0) / 2} stroke="#f97316" strokeWidth={1 / zoom} />
          )}
          {draft?.kind === 'line' && <Line points={[...draft.points, ...(draft.hover ?? [])]} stroke="#f97316" strokeWidth={1 / zoom} />}
        </Layer>
      </Stage>

      <div className="absolute top-2 right-2 flex gap-1 rounded-md border border-border bg-card/90 p-0.5 backdrop-blur">
        <Tooltip content="Show planned toolpath">
          <Button size="iconSm" active={showToolpath} aria-label="Toggle toolpath" onClick={() => toggle('showToolpath')}>
            <Eye />
          </Button>
        </Tooltip>
        <Tooltip content="Show travel moves">
          <Button size="iconSm" active={showTravel} aria-label="Toggle travel" onClick={() => toggle('showTravel')}>
            <Footprints />
          </Button>
        </Tooltip>
        <Tooltip content="Show indexed sections (cylinder)">
          <Button size="iconSm" active={showSections} aria-label="Toggle sections" onClick={() => toggle('showSections')}>
            <Grid2x2 />
          </Button>
        </Tooltip>
      </div>
      {draft?.kind === 'line' && (
        <div className={cn('absolute bottom-2 left-2 rounded bg-card/90 px-2 py-1 text-[11px] text-muted-foreground')}>
          Click to add points · double-click or right-click to finish · close near the start for a polygon
        </div>
      )}
    </div>
  );
}
