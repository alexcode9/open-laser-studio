import type { DitherMode, LaserSource, LayerMode } from '@ols/shared-types';
import { Button, Field, Input, NumberField, Section, Select, Switch, cn } from '@ols/ui';
import { Eye, EyeOff, Lock, LockOpen, Plus, Printer, Trash2 } from 'lucide-react';

import { useProject } from '@/stores/project';

export function LayersPanel() {
  const project = useProject((s) => s.project)!;
  const activeId = useProject((s) => s.activeLayerId);
  const st = useProject.getState();
  const layers = project.document.layers;
  const active = layers.find((l) => l.id === activeId) ?? layers[0]!;
  const counts = new Map<string, number>();
  for (const o of project.document.objects) counts.set(o.layerId, (counts.get(o.layerId) ?? 0) + 1);
  const set = st.updateLayerSettings;
  const s = active.settings;
  const k = (name: string) => `${name}-${active.id}`;

  return (
    <>
      <Section
        title="Layers"
        actions={
          <Button size="iconSm" aria-label="Add layer" onClick={st.addLayer}>
            <Plus />
          </Button>
        }
      >
        <ul className="space-y-0.5" data-testid="layer-list">
          {layers.map((l) => (
            <li
              key={l.id}
              className={cn('flex h-7 cursor-pointer items-center gap-1.5 rounded px-1.5 hover:bg-accent/60', l.id === active.id && 'bg-accent ring-1 ring-primary/40')}
              onClick={() => st.setActiveLayer(l.id)}
            >
              <input
                type="color"
                value={l.color}
                aria-label={`${l.name} color`}
                className="size-4 cursor-pointer rounded border-0 bg-transparent p-0"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => st.updateLayer(l.id, { color: e.currentTarget.value }, `color-${l.id}`)}
              />
              <span className="flex-1 truncate text-xs">{l.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {l.settings.mode} · {counts.get(l.id) ?? 0}
              </span>
              <button type="button" className={cn('opacity-60 hover:opacity-100', !l.output && 'text-muted-foreground opacity-30')} aria-label="Toggle output" title="Output to laser" onClick={(e) => (e.stopPropagation(), st.updateLayer(l.id, { output: !l.output }))}>
                <Printer className="size-3.5" />
              </button>
              <button type="button" className="opacity-60 hover:opacity-100" aria-label="Toggle visibility" onClick={(e) => (e.stopPropagation(), st.updateLayer(l.id, { visible: !l.visible }))}>
                {l.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </button>
              <button type="button" className="opacity-60 hover:opacity-100" aria-label="Toggle lock" onClick={(e) => (e.stopPropagation(), st.updateLayer(l.id, { locked: !l.locked }))}>
                {l.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={`Laser settings · ${active.name}`}
        actions={
          <Button size="iconSm" aria-label="Remove layer" disabled={layers.length <= 1 || (counts.get(active.id) ?? 0) > 0} onClick={() => st.removeLayer(active.id)}>
            <Trash2 />
          </Button>
        }
      >
        <Field label="Name">
          <Input value={active.name} onChange={(e) => st.updateLayer(active.id, { name: e.currentTarget.value }, k('name'))} />
        </Field>
        <Field label="Mode">
          <Select value={s.mode} onChange={(e) => set(active.id, { mode: e.currentTarget.value as LayerMode })}>
            <option value="line">Line (vector)</option>
            <option value="fill">Fill (hatch)</option>
            <option value="image">Image (raster)</option>
          </Select>
        </Field>
        <Field label="Source">
          <Select value={s.source} onChange={(e) => set(active.id, { source: e.currentTarget.value as LaserSource })}>
            <option value="blue">Blue diode 455 nm</option>
            <option value="ir">IR 1064 nm</option>
          </Select>
        </Field>
        <Field label="Speed">
          <NumberField value={s.speedMmS} min={1} max={10000} unit="mm/s" step={10} onCommit={(v) => set(active.id, { speedMmS: v }, k('speed'))} />
        </Field>
        <Field label="Power">
          <NumberField value={s.powerPct} min={0} max={100} unit="%" onCommit={(v) => set(active.id, { powerPct: v }, k('power'))} />
        </Field>
        <Field label="Passes">
          <NumberField value={s.passes} min={1} max={100} precision={0} onCommit={(v) => set(active.id, { passes: Math.round(v) }, k('passes'))} />
        </Field>
        {s.mode === 'fill' && (
          <>
            <Field label="Hatch spacing">
              <NumberField value={s.hatchSpacingMm} min={0.01} max={10} step={0.01} unit="mm" onCommit={(v) => set(active.id, { hatchSpacingMm: v }, k('hatch'))} />
            </Field>
            <Field label="Hatch angle">
              <NumberField value={s.hatchAngleDeg} unit="°" onCommit={(v) => set(active.id, { hatchAngleDeg: v }, k('angle'))} />
            </Field>
            <Field label="Crosshatch">
              <Switch checked={s.crosshatch} onCheckedChange={(c) => set(active.id, { crosshatch: c })} />
            </Field>
            <Field label="Outline too">
              <Switch checked={s.fillOutline} onCheckedChange={(c) => set(active.id, { fillOutline: c })} />
            </Field>
          </>
        )}
        {s.mode === 'image' && (
          <>
            <Field label="Lines/mm">
              <NumberField value={s.linesPerMm} min={1} max={50} unit="l/mm" onCommit={(v) => set(active.id, { linesPerMm: v }, k('lpm'))} />
            </Field>
            <Field label="Dither">
              <Select value={s.dither} onChange={(e) => set(active.id, { dither: e.currentTarget.value as DitherMode })}>
                <option value="threshold">Threshold</option>
                <option value="floydSteinberg">Floyd–Steinberg</option>
                <option value="grayscale">Grayscale (power)</option>
              </Select>
            </Field>
            <Field label="Threshold">
              <NumberField value={s.threshold} min={0} max={255} precision={0} onCommit={(v) => set(active.id, { threshold: Math.round(v) }, k('thr'))} />
            </Field>
            <Field label="Invert">
              <Switch checked={s.invert} onCheckedChange={(c) => set(active.id, { invert: c })} />
            </Field>
          </>
        )}
        {s.mode !== 'line' && (
          <>
            <Field label="Bidirectional">
              <Switch checked={s.bidirectional} onCheckedChange={(c) => set(active.id, { bidirectional: c })} />
            </Field>
            <Field label="Overscan">
              <NumberField value={s.overscanMm} min={0} max={50} unit="mm" onCommit={(v) => set(active.id, { overscanMm: v }, k('ovs'))} />
            </Field>
          </>
        )}
      </Section>
    </>
  );
}
