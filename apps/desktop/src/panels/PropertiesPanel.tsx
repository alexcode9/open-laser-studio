import { formatDeg, sToADeg, uToMachineU } from '@ols/geometry-adapters';
import type { DesignObject, Shape } from '@ols/shared-types';
import { Button, Field, Input, NumberField, Section, Select, Switch } from '@ols/ui';
import { ArrowDown, ArrowUp, Copy, Group, Trash2, Ungroup } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { textOutline } from '@/lib/actions';
import { localBounds, newId, unionBounds, worldBounds } from '@/lib/shapes';
import { selectedObjects, useProject } from '@/stores/project';

function ShapeFields({ obj }: { obj: DesignObject }) {
  const update = useProject((s) => s.updateObject);
  const s = obj.shape;
  const setShape = (patch: Partial<Shape>, key?: string) => update(obj.id, { shape: { ...s, ...patch } as Shape }, key);
  const [text, setText] = useState(s.kind === 'text' ? s.text : '');
  useEffect(() => {
    if (s.kind === 'text') setText(s.text);
  }, [s]);

  switch (s.kind) {
    case 'rect':
      return (
        <>
          <Field label="Width">
            <NumberField value={s.width} min={0.01} unit="mm" onCommit={(v) => setShape({ width: v }, `w-${obj.id}`)} />
          </Field>
          <Field label="Height">
            <NumberField value={s.height} min={0.01} unit="mm" onCommit={(v) => setShape({ height: v }, `h-${obj.id}`)} />
          </Field>
        </>
      );
    case 'ellipse':
      return (
        <>
          <Field label="Radius X">
            <NumberField value={s.rx} min={0.01} unit="mm" onCommit={(v) => setShape({ rx: v }, `rx-${obj.id}`)} />
          </Field>
          <Field label="Radius Y">
            <NumberField value={s.ry} min={0.01} unit="mm" onCommit={(v) => setShape({ ry: v }, `ry-${obj.id}`)} />
          </Field>
        </>
      );
    case 'line':
      return (
        <Field label="Closed">
          <Switch checked={s.closed} onCheckedChange={(c) => setShape({ closed: c })} />
        </Field>
      );
    case 'text': {
      const commit = async (value: string, size: number) => {
        if (!value.trim()) return;
        const outline = await textOutline(value, size, s.fontFamily);
        update(obj.id, { shape: { ...s, text: value, fontSizeMm: size, outline }, name: `Text "${value.slice(0, 16)}"` });
      };
      return (
        <>
          <Field label="Text">
            <Input value={text} onChange={(e) => setText(e.currentTarget.value)} onBlur={() => text !== s.text && void commit(text, s.fontSizeMm)} onKeyDown={(e) => e.key === 'Enter' && void commit(text, s.fontSizeMm)} />
          </Field>
          <Field label="Size">
            <NumberField value={s.fontSizeMm} min={0.5} max={500} unit="mm" onCommit={(v) => void commit(s.text, v)} />
          </Field>
          {!s.outline && <p className="text-[11px] text-amber-400">No outline: this text will be skipped by the planner.</p>}
        </>
      );
    }
    case 'image':
      return (
        <>
          <Field label="Width">
            <NumberField value={s.widthMm} min={0.1} unit="mm" onCommit={(v) => setShape({ widthMm: v, heightMm: (s.heightMm * v) / s.widthMm })} />
          </Field>
          <Field label="Height">
            <NumberField value={s.heightMm} min={0.1} unit="mm" onCommit={(v) => setShape({ heightMm: v, widthMm: (s.widthMm * v) / s.heightMm })} />
          </Field>
        </>
      );
    case 'path':
      return <p className="text-[11px] text-muted-foreground">{s.commands.length} path commands</p>;
  }
}

export function PropertiesPanel() {
  const sel = useProject(useShallow(selectedObjects));
  const project = useProject((s) => s.project)!;
  const st = useProject.getState();
  const update = useProject((s) => s.updateObject);

  if (sel.length === 0) {
    return (
      <Section title="Selection">
        <p className="text-[11px] text-muted-foreground">Nothing selected. Click an object, drag a marquee, or draw with the tools on the left.</p>
      </Section>
    );
  }

  const bounds = unionBounds(sel.map(worldBounds));
  const cyl = project.mode === 'cylinder';
  const actions = (
    <div className="flex gap-0.5">
      <Button size="iconSm" aria-label="Bring forward" onClick={() => st.reorderSelection('up')}>
        <ArrowUp />
      </Button>
      <Button size="iconSm" aria-label="Send backward" onClick={() => st.reorderSelection('down')}>
        <ArrowDown />
      </Button>
      <Button size="iconSm" aria-label="Duplicate" onClick={st.duplicateSelection}>
        <Copy />
      </Button>
      <Button size="iconSm" aria-label="Delete" onClick={st.deleteSelection}>
        <Trash2 />
      </Button>
    </div>
  );

  const placement = bounds && (
    <div className="rounded border border-border bg-muted/40 p-2 font-mono text-[10.5px] text-muted-foreground">
      <div>
        bounds x {bounds.minX.toFixed(2)}…{bounds.maxX.toFixed(2)} · y {bounds.minY.toFixed(2)}…{bounds.maxY.toFixed(2)} mm
      </div>
      {cyl && (
        <div className="text-sky-300/80">
          A {formatDeg(sToADeg(project.workpiece, bounds.minY), 1)}…{formatDeg(sToADeg(project.workpiece, bounds.maxY), 1)} · U {uToMachineU(project.workpiece, bounds.minX).toFixed(1)}…
          {uToMachineU(project.workpiece, bounds.maxX).toFixed(1)} mm
        </div>
      )}
    </div>
  );

  if (sel.length > 1) {
    const grouped = sel.every((o) => o.groupId && o.groupId === sel[0]!.groupId);
    return (
      <Section title={`${sel.length} objects`} actions={actions}>
        {placement}
        <Field label="Layer">
          <Select value={sel[0]!.layerId} onChange={(e) => st.moveSelectionToLayer(e.currentTarget.value)}>
            {project.document.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const gid = grouped ? null : newId('group');
            for (const o of sel) update(o.id, { groupId: gid }, `group-${gid}`);
          }}
        >
          {grouped ? <Ungroup /> : <Group />} {grouped ? 'Ungroup' : 'Group'}
        </Button>
      </Section>
    );
  }

  const o = sel[0]!;
  const t = o.transform;
  const lb = localBounds(o.shape);
  const setT = (patch: Partial<typeof t>, key: string) => update(o.id, { transform: { ...t, ...patch } }, `${key}-${o.id}`);
  return (
    <Section title="Object" actions={actions}>
      <Field label="Name">
        <Input value={o.name} onChange={(e) => update(o.id, { name: e.currentTarget.value }, `name-${o.id}`)} />
      </Field>
      <Field label="Layer">
        <Select value={o.layerId} onChange={(e) => update(o.id, { layerId: e.currentTarget.value })}>
          {project.document.layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-1.5">
        <Field label={cyl ? 'u (X)' : 'X'}>
          <NumberField value={t.x} unit="mm" step={0.5} onCommit={(v) => setT({ x: v }, 'x')} aria-label="X position" />
        </Field>
        <Field label={cyl ? 's (Y)' : 'Y'}>
          <NumberField value={t.y} unit="mm" step={0.5} onCommit={(v) => setT({ y: v }, 'y')} aria-label="Y position" />
        </Field>
        <Field label="Rotate">
          <NumberField value={t.rotationDeg} unit="°" step={1} onCommit={(v) => setT({ rotationDeg: v }, 'rot')} />
        </Field>
        <Field label="Scale">
          <NumberField value={t.scaleX} step={0.05} min={0.001} precision={4} onCommit={(v) => setT({ scaleX: v, scaleY: (t.scaleY / t.scaleX) * v }, 'scale')} />
        </Field>
      </div>
      {lb && (
        <div className="grid grid-cols-2 gap-1.5">
          <Field label="W">
            <NumberField value={(lb.maxX - lb.minX) * t.scaleX} unit="mm" min={0.01} onCommit={(v) => setT({ scaleX: v / Math.max(1e-9, lb.maxX - lb.minX) }, 'sx')} />
          </Field>
          <Field label="H">
            <NumberField value={(lb.maxY - lb.minY) * t.scaleY} unit="mm" min={0.01} onCommit={(v) => setT({ scaleY: v / Math.max(1e-9, lb.maxY - lb.minY) }, 'sy')} />
          </Field>
        </div>
      )}
      <ShapeFields obj={o} />
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={o.visible} onCheckedChange={(c) => update(o.id, { visible: c })} /> Visible
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={o.locked} onCheckedChange={(c) => update(o.id, { locked: c })} /> Locked
        </label>
      </div>
      {placement}
    </Section>
  );
}
