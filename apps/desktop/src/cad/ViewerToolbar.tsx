import { Button, Select, Tooltip, cn } from '@ols/ui';
import { Box, Circle, Crosshair, Maximize, MousePointer2, Ruler, Spline, Square, SquareDashed, SquareSplitHorizontal, Triangle } from 'lucide-react';

import { TOOL_INFO } from '@/lib/cad';
import { type CadStyle, type CadTool, type CadViewKind, useCad } from '@/stores/cad';

import type { PickMode } from './picking';

const VIEWS: [CadViewKind, string, string][] = [
  ['iso', 'Iso', 'Isometric view'],
  ['front', 'Front', 'Front view (looking along +Y)'],
  ['top', 'Top', 'Top view (looking down −Z)'],
  ['right', 'Right', 'Right view (looking along −X)'],
  ['axis', 'Axis', 'Look along the detected rotation axis'],
];

const TOOLS: [CadTool, string, typeof Ruler][] = [
  ['select', 'Select', MousePointer2],
  ['distance', 'Distance', Ruler],
  ['length', 'Edge length', Spline],
  ['radius', 'Radius / diameter', Circle],
  ['angle', 'Angle', Triangle],
  ['face-distance', 'Face to face', SquareDashed],
  ['area', 'Area', Square],
  ['section', 'Section plane', SquareSplitHorizontal],
];

export function ViewerToolbar() {
  const style = useCad((s) => s.style);
  const projection = useCad((s) => s.projection);
  const pickMode = useCad((s) => s.pickMode);
  const tool = useCad((s) => s.tool);
  const picks = useCad((s) => s.toolPicks.length);
  const { requestView, setStyle, setProjection, setPickMode, setTool } = useCad.getState();
  return (
    <>
      <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1 rounded-md border border-border bg-card/90 p-1 backdrop-blur">
        <Tooltip content="Fit model (F)">
          <Button size="sm" aria-label="Fit" data-testid="cad-view-fit" onClick={() => requestView('fit')}>
            <Maximize />
          </Button>
        </Tooltip>
        {VIEWS.map(([k, label, help]) => (
          <Tooltip key={k} content={help}>
            <Button size="sm" data-testid={`cad-view-${k}`} onClick={() => requestView(k)}>
              {label}
            </Button>
          </Tooltip>
        ))}
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Tooltip content="Perspective / orthographic projection">
          <Button
            size="sm"
            data-testid="cad-projection"
            onClick={() => {
              setProjection(projection === 'perspective' ? 'orthographic' : 'perspective');
              requestView('fit');
            }}
          >
            <Box /> {projection === 'perspective' ? 'Persp' : 'Ortho'}
          </Button>
        </Tooltip>
        <Select className="h-6 w-28" aria-label="Display style" value={style} onChange={(e) => setStyle(e.currentTarget.value as CadStyle)}>
          <option value="shaded">Shaded</option>
          <option value="shaded-edges">Shaded + edges</option>
          <option value="wireframe">Wireframe</option>
          <option value="xray">X-ray</option>
        </Select>
        <Select className="h-6 w-24" aria-label="Pick" value={pickMode} onChange={(e) => setPickMode(e.currentTarget.value as PickMode)}>
          <option value="auto">Pick: auto</option>
          <option value="face">Faces</option>
          <option value="edge">Edges</option>
          <option value="vertex">Vertices</option>
        </Select>
      </div>
      <div className="absolute top-12 left-2 flex flex-col gap-0.5 rounded-md border border-border bg-card/90 p-1 backdrop-blur" role="toolbar" aria-label="Measurement tools">
        {TOOLS.map(([t, label, Icon]) => (
          <Tooltip key={t} content={t === 'select' ? 'Select faces, edges, vertices (Shift to add)' : `${label}: ${TOOL_INFO[t].hint}`} side="right">
            <Button size="icon" aria-label={label} aria-pressed={tool === t} data-testid={`cad-tool-${t}`} active={tool === t} onClick={() => setTool(t)}>
              <Icon />
            </Button>
          </Tooltip>
        ))}
      </div>
      {tool !== 'select' && (
        <div className={cn('pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md border border-lime-400/40 bg-black/80 px-3 py-1 text-[11px] text-lime-200')} data-testid="cad-tool-hint">
          <Crosshair className="mr-1 inline size-3" />
          {TOOL_INFO[tool].hint} · {picks}/{TOOL_INFO[tool].picks} · Esc to cancel
        </div>
      )}
    </>
  );
}
