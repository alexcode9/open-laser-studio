import { circumference, correctedStepsPerUnit, focusErrorMm, linearStepsPerMm, rotaryStepsPerDeg } from '@ols/geometry-adapters';
import type { CylinderStrategy } from '@ols/shared-types';
import { Badge, Button, Field, NumberField, Section, Select, Switch } from '@ols/ui';
import { Radar } from 'lucide-react';
import { useState } from 'react';

import { connectionLabel, useDevices } from '@/stores/devices';
import { useProject } from '@/stores/project';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/view';

function Calibration() {
  const machine = useProject((s) => s.project!.machine);
  const setMachine = useProject((s) => s.setMachine);
  const [axis, setAxis] = useState<'A' | 'U'>('U');
  const [commanded, setCommanded] = useState(100);
  const [measured, setMeasured] = useState(100);
  const r = machine.rotary;
  const l = machine.linear;
  const current = axis === 'A' ? rotaryStepsPerDeg(r.motorStepsPerRev, r.microsteps, r.gearRatio) : linearStepsPerMm(l.motorStepsPerRev, l.microsteps, l.gearRatio, l.leadscrewPitchMm);
  const corrected = correctedStepsPerUnit(current, commanded, measured);
  const unit = axis === 'A' ? 'steps/°' : 'steps/mm';
  const apply = () => {
    if (!Number.isFinite(corrected) || corrected <= 0) return;
    const factor = corrected / current;
    // Fold the correction into the gear ratio so step counts stay integers.
    if (axis === 'A') setMachine((m) => ({ ...m, rotary: { ...m.rotary, gearRatio: m.rotary.gearRatio * factor } }));
    else setMachine((m) => ({ ...m, linear: { ...m.linear, gearRatio: m.linear.gearRatio * factor } }));
    toast('info', `${axis} calibration applied: ${corrected.toFixed(4)} ${unit}`);
  };
  return (
    <Section title="Calibration helper">
      <Field label="Axis">
        <Select value={axis} onChange={(e) => setAxis(e.currentTarget.value as 'A' | 'U')}>
          <option value="U">U (linear)</option>
          <option value="A">A (rotary)</option>
        </Select>
      </Field>
      <Field label="Commanded">
        <NumberField value={commanded} min={0.001} unit={axis === 'A' ? '°' : 'mm'} onCommit={setCommanded} />
      </Field>
      <Field label="Measured">
        <NumberField value={measured} min={0.001} unit={axis === 'A' ? '°' : 'mm'} onCommit={setMeasured} />
      </Field>
      <div className="font-mono text-[11px] text-muted-foreground">
        current {current.toFixed(4)} → corrected {Number.isFinite(corrected) ? corrected.toFixed(4) : '—'} {unit}
      </div>
      <Button variant="outline" size="sm" onClick={apply} disabled={!Number.isFinite(corrected) || commanded === measured}>
        Apply to profile
      </Button>
    </Section>
  );
}

export function SetupPanel() {
  const project = useProject((s) => s.project)!;
  const setWorkpiece = useProject((s) => s.setWorkpiece);
  const setJob = useProject((s) => s.setCylinderJob);
  const setMachine = useProject((s) => s.setMachine);
  const settings = useSettings((s) => s.settings);
  const setDeviceOpen = useDevices((s) => s.setOpen);
  const { requestDeveloperMode, setSimulationOnly, setTheme } = useSettings.getState();
  const w = project.workpiece;
  const j = project.cylinder;
  const m = project.machine;

  return (
    <>
      <Section title="Workpiece (cylinder)">
        <Field label="Diameter">
          <NumberField value={w.diameterMm} min={1} max={1000} unit="mm" onCommit={(v) => setWorkpiece({ diameterMm: v }, 'wd')} aria-label="Diameter" />
        </Field>
        <Field label="Length">
          <NumberField value={w.lengthMm} min={1} max={5000} unit="mm" onCommit={(v) => setWorkpiece({ lengthMm: v }, 'wl')} />
        </Field>
        <Field label="A zero">
          <NumberField value={w.angularZeroDeg} unit="°" onCommit={(v) => setWorkpiece({ angularZeroDeg: v }, 'wa')} />
        </Field>
        <Field label="U zero">
          <NumberField value={w.axialZeroMm} unit="mm" onCommit={(v) => setWorkpiece({ axialZeroMm: v }, 'wu')} />
        </Field>
        <Field label="Rotation">
          <Select value={String(w.rotationSign)} onChange={(e) => setWorkpiece({ rotationSign: Number(e.currentTarget.value) })}>
            <option value="1">+A advances +s</option>
            <option value="-1">+A advances −s</option>
          </Select>
        </Field>
        <div className="font-mono text-[10.5px] text-muted-foreground">
          circumference {circumference(w).toFixed(3)} mm · 1° = {(circumference(w) / 360).toFixed(4)} mm
        </div>
      </Section>

      <Section title="Cylinder strategy">
        <Field label="Strategy">
          <Select value={j.strategy} onChange={(e) => setJob({ strategy: e.currentTarget.value as CylinderStrategy })}>
            <option value="indexed">Indexed sections (executable)</option>
            <option value="coupled">Coupled helical (simulation only)</option>
          </Select>
        </Field>
        <Field label="Section width">
          <NumberField value={j.sectionWidthMm} min={1} unit="mm" onCommit={(v) => setJob({ sectionWidthMm: v }, 'jw')} />
        </Field>
        <Field label="Max focus err.">
          <NumberField value={j.maxFocusErrorMm} min={0.01} step={0.05} unit="mm" onCommit={(v) => setJob({ maxFocusErrorMm: v }, 'jf')} />
        </Field>
        <Field label="Angular window">
          <NumberField value={j.angularWindowMm} min={0} unit="mm" onCommit={(v) => setJob({ angularWindowMm: v }, 'jaw')} />
        </Field>
        <Field label="Overlap">
          <NumberField value={j.sectionOverlapMm} min={0} step={0.1} unit="mm" onCommit={(v) => setJob({ sectionOverlapMm: v }, 'jo')} />
        </Field>
        {j.strategy === 'coupled' && (
          <Field label="Helical pitch">
            <NumberField value={j.helicalPitchMm} min={0.01} unit="mm/rev" onCommit={(v) => setJob({ helicalPitchMm: v }, 'jp')} />
          </Field>
        )}
        <div className="font-mono text-[10.5px] text-muted-foreground">
          {j.angularWindowMm > 0 ? `focus error at window edge ${focusErrorMm(w, j.angularWindowMm / 2).toFixed(3)} mm` : 'window derived from max focus error'}
        </div>
      </Section>

      <Section title="Machine profile" actions={m.limitsValidated ? <Badge tone="ok">validated</Badge> : <Badge tone="warn">unvalidated</Badge>}>
        <p className="text-[10.5px] text-muted-foreground">{m.name} · values are placeholders until measured on hardware.</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Field label="Field W">
            <NumberField value={m.galvo.fieldWidthMm} min={1} unit="mm" onCommit={(v) => setMachine((x) => ({ ...x, galvo: { ...x.galvo, fieldWidthMm: v } }), 'gw')} />
          </Field>
          <Field label="Field H">
            <NumberField value={m.galvo.fieldHeightMm} min={1} unit="mm" onCommit={(v) => setMachine((x) => ({ ...x, galvo: { ...x.galvo, fieldHeightMm: v } }), 'gh')} />
          </Field>
          <Field label="Center X">
            <NumberField value={m.galvo.centerXMm} unit="mm" onCommit={(v) => setMachine((x) => ({ ...x, galvo: { ...x.galvo, centerXMm: v } }), 'gcx')} />
          </Field>
          <Field label="Center Y">
            <NumberField value={m.galvo.centerYMm} unit="mm" onCommit={(v) => setMachine((x) => ({ ...x, galvo: { ...x.galvo, centerYMm: v } }), 'gcy')} />
          </Field>
        </div>
        <div className="flex gap-4 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <Switch checked={m.galvo.invertX} onCheckedChange={(c) => setMachine((x) => ({ ...x, galvo: { ...x.galvo, invertX: c } }))} /> invert X
          </label>
          <label className="flex items-center gap-1.5">
            <Switch checked={m.galvo.invertY} onCheckedChange={(c) => setMachine((x) => ({ ...x, galvo: { ...x.galvo, invertY: c } }))} /> invert Y
          </label>
        </div>
        <h4 className="pt-1 text-[10.5px] font-semibold text-muted-foreground uppercase">Rotary A</h4>
        <div className="grid grid-cols-2 gap-1.5">
          <Field label="Steps/rev">
            <NumberField value={m.rotary.motorStepsPerRev} min={1} precision={0} onCommit={(v) => setMachine((x) => ({ ...x, rotary: { ...x.rotary, motorStepsPerRev: Math.round(v) } }))} />
          </Field>
          <Field label="Microsteps">
            <NumberField value={m.rotary.microsteps} min={1} precision={0} onCommit={(v) => setMachine((x) => ({ ...x, rotary: { ...x.rotary, microsteps: Math.round(v) } }))} />
          </Field>
          <Field label="Gear ratio">
            <NumberField value={m.rotary.gearRatio} min={0.001} precision={5} onCommit={(v) => setMachine((x) => ({ ...x, rotary: { ...x.rotary, gearRatio: v } }), 'rg')} />
          </Field>
          <Field label="Max vel">
            <NumberField value={m.rotary.maxVelocityDegS} min={1} unit="°/s" onCommit={(v) => setMachine((x) => ({ ...x, rotary: { ...x.rotary, maxVelocityDegS: v } }), 'rv')} />
          </Field>
          <Field label="Max acc">
            <NumberField value={m.rotary.maxAccelDegS2} min={1} unit="°/s²" onCommit={(v) => setMachine((x) => ({ ...x, rotary: { ...x.rotary, maxAccelDegS2: v } }), 'ra')} />
          </Field>
        </div>
        <h4 className="pt-1 text-[10.5px] font-semibold text-muted-foreground uppercase">Linear U</h4>
        <div className="grid grid-cols-2 gap-1.5">
          <Field label="Pitch">
            <NumberField value={m.linear.leadscrewPitchMm} min={0.01} unit="mm" onCommit={(v) => setMachine((x) => ({ ...x, linear: { ...x.linear, leadscrewPitchMm: v } }), 'lp')} />
          </Field>
          <Field label="Microsteps">
            <NumberField value={m.linear.microsteps} min={1} precision={0} onCommit={(v) => setMachine((x) => ({ ...x, linear: { ...x.linear, microsteps: Math.round(v) } }))} />
          </Field>
          <Field label="Travel min">
            <NumberField value={m.linear.travelMinMm} unit="mm" onCommit={(v) => setMachine((x) => ({ ...x, linear: { ...x.linear, travelMinMm: v } }), 'lmin')} />
          </Field>
          <Field label="Travel max">
            <NumberField value={m.linear.travelMaxMm} unit="mm" onCommit={(v) => setMachine((x) => ({ ...x, linear: { ...x.linear, travelMaxMm: v } }), 'lmax')} />
          </Field>
          <Field label="Max vel">
            <NumberField value={m.linear.maxVelocityMmS} min={0.1} unit="mm/s" onCommit={(v) => setMachine((x) => ({ ...x, linear: { ...x.linear, maxVelocityMmS: v } }), 'lv')} />
          </Field>
          <Field label="Max acc">
            <NumberField value={m.linear.maxAccelMmS2} min={0.1} unit="mm/s²" onCommit={(v) => setMachine((x) => ({ ...x, linear: { ...x.linear, maxAccelMmS2: v } }), 'la')} />
          </Field>
        </div>
        <Field label="Settle time">
          <NumberField value={m.externalSettleS} min={0} max={60} step={0.05} unit="s" onCommit={(v) => setMachine((x) => ({ ...x, externalSettleS: v }), 'settle')} />
        </Field>
      </Section>

      <Calibration />

      <Section title="Application">
        <Field label="Theme">
          <Select value={settings.theme} onChange={(e) => void setTheme(e.currentTarget.value as 'dark' | 'light')}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </Select>
        </Field>
        <Field label="Developer mode">
          <Switch checked={settings.developerMode} onCheckedChange={(c) => void requestDeveloperMode(c)} data-testid="dev-mode" />
        </Field>
        <Field label="Simulation only">
          <Switch checked={settings.simulationOnly} disabled={!settings.developerMode} onCheckedChange={(c) => void setSimulationOnly(c)} />
        </Field>
        <p className="text-[10.5px] text-muted-foreground">
          Both reset on every launch. Even with simulation-only off, this build performs read-only discovery and identify
          only; jobs always run on the simulator.
        </p>
        <div className="rounded border border-border/80 bg-muted/30 px-2 py-1.5 text-[11px]">
          Target: <span className="font-medium">{connectionLabel(m.host)}</span>
          {m.host ? <span className="ml-1 font-mono text-muted-foreground">{m.host}</span> : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => setDeviceOpen(true)} data-testid="find-device-setup">
          <Radar /> Find device…
        </Button>
      </Section>
    </>
  );
}
