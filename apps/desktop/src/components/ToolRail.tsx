import { Button, Tooltip } from '@ols/ui';
import { Circle, Hand, Maximize, MousePointer2, RectangleHorizontal, Spline, Type } from 'lucide-react';

import { type Tool, useView } from '@/stores/view';

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof Hand }[] = [
  { id: 'select', label: 'Select / transform', key: 'V', Icon: MousePointer2 },
  { id: 'pan', label: 'Pan', key: 'H', Icon: Hand },
  { id: 'rect', label: 'Rectangle', key: 'R', Icon: RectangleHorizontal },
  { id: 'ellipse', label: 'Ellipse', key: 'E', Icon: Circle },
  { id: 'line', label: 'Polyline (double-click to finish)', key: 'L', Icon: Spline },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
];

export function ToolRail() {
  const tool = useView((s) => s.tool);
  const setTool = useView((s) => s.setTool);
  const fit = useView((s) => s.requestFit);
  return (
    <nav className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-2" aria-label="Tools">
      {TOOLS.map(({ id, label, key, Icon }) => (
        <Tooltip key={id} content={`${label} (${key})`} side="right">
          <Button size="icon" active={tool === id} aria-label={label} aria-pressed={tool === id} data-testid={`tool-${id}`} onClick={() => setTool(id)}>
            <Icon />
          </Button>
        </Tooltip>
      ))}
      <div className="flex-1" />
      <Tooltip content="Zoom to fit (F)" side="right">
        <Button size="icon" aria-label="Zoom to fit" onClick={fit}>
          <Maximize />
        </Button>
      </Tooltip>
    </nav>
  );
}
