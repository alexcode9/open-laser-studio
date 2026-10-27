import { formatDeg, formatDuration } from '@ols/geometry-adapters';
import type { InjectionKind } from '@ols/shared-types';
import { Badge, Button, ConfirmDialog, Field, Section, Select } from '@ols/ui';
import { Home, Pause, Play, Plug, PlugZap, RotateCcw, ShieldAlert, ShieldCheck, Square, Wrench, Zap } from 'lucide-react';
import { useState } from 'react';

import { SafetyPill } from '@/components/SafetyPill';
import { useMachine } from '@/stores/machine';
import { usePlan } from '@/stores/plan';
import { usePlayback } from '@/stores/playback';
import { useProject } from '@/stores/project';

const INJECTIONS: { label: string; kind: InjectionKind }[] = [
  { label: 'Axis fault (DRIVER)', kind: { type: 'axisFault', code: 'DRIVER' } },
  { label: 'Axis limit hit (mid-move)', kind: { type: 'axisLimitHit' } },
  { label: 'Drop next axis completion', kind: { type: 'axisDropNextCompletion' } },
  { label: 'Axis delay +2 s', kind: { type: 'axisDelay', seconds: 2 } },
  { label: 'Axis position error', kind: { type: 'axisPositionError', aDeg: 0.5, uMm: 0.2 } },
  { label: 'Axis link disconnect', kind: { type: 'axisDisconnect' } },
  { label: 'Axis link reconnect', kind: { type: 'axisReconnect' } },
  { label: 'F1 link disconnect', kind: { type: 'f1Disconnect' } },
  { label: 'F1 link reconnect', kind: { type: 'f1Reconnect' } },
  { label: 'Hardware E-stop button', kind: { type: 'estopButton' } },
];

function Check({ checked, onChange, children }: { checked: boolean; onChange: (c: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" className="mt-0.5 accent-orange-500" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function MachinePanel() {
  const snap = useMachine((s) => s.snapshot);
  const report = useMachine((s) => s.report);
  const busy = useMachine((s) => s.busy);
  const command = useMachine((s) => s.command);
  const inject = useMachine((s) => s.inject);
  const speed = useMachine((s) => s.speed);
  const setSpeed = useMachine((s) => s.setSpeed);
  const mode = useProject((s) => s.project?.mode);
  const summary = usePlan((s) => s.result?.summary);
  const setSource = usePlayback((s) => s.setSource);
  const setFollow = usePlayback((s) => s.setFollow);

  const [armOpen, setArmOpen] = useState(false);
  const [armChecks, setArmChecks] = useState([false, false, false]);
  const [resetOpen, setResetOpen] = useState<null | 'fault' | 'estop'>(null);
  const [released, setReleased] = useState(false);
  const [injection, setInjection] = useState(0);

  if (!snap) return <Section title="Machine">Creating simulated machine…</Section>;
  const st = snap.safetyState;
  const connected = snap.f1Connected;
  const is = (...s: string[]) => s.includes(st);
  const job = snap.job;

  const start = async () => {
    setSource('machine');
    setFollow(true);
    await command({ cmd: 'start' });
  };

  return (
    <>
      <Section title="Simulated machine" actions={<SafetyPill state={st} />}>
        <div className="flex flex-wrap gap-1">
          <Badge tone={snap.f1Connected ? 'ok' : 'muted'}>F1 (sim) {snap.f1Connected ? 'connected' : 'offline'}</Badge>
          {mode === 'cylinder' && <Badge tone={snap.axesConnected ? 'ok' : 'muted'}>A/U controller (sim) {snap.axesConnected ? 'connected' : 'offline'}</Badge>}
          {snap.axisStatus && <Badge tone={snap.axisStatus.homed ? 'ok' : 'warn'}>{snap.axisStatus.homed ? 'homed' : 'not homed'}</Badge>}
          {snap.homing && <Badge tone="warn">homing…</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-x-3 font-mono text-[11px]" data-testid="machine-position">
          <span>A {formatDeg(snap.position.aDeg, 3)}</span>
          <span>U {snap.position.uMm.toFixed(3)} mm</span>
          <span>Gx {snap.position.gxMm.toFixed(2)}</span>
          <span>Gy {snap.position.gyMm.toFixed(2)}</span>
          <span className={snap.laserOn ? 'text-red-400' : 'text-muted-foreground'}>laser {snap.laserOn ? `ON ${snap.powerPct.toFixed(0)}%` : 'off'}</span>
          <span className={snap.laserPermitted ? 'text-amber-300' : 'text-muted-foreground'}>{snap.laserPermitted ? 'emission permitted' : 'emission blocked'}</span>
        </div>
        {snap.lastFault && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200" data-testid="last-fault">
            <ShieldAlert className="mr-1 inline size-3.5" />
            {snap.lastFault}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1">
          {connected ? (
            <Button variant="outline" size="sm" disabled={busy || is('RUNNING', 'PAUSED', 'STOPPING')} onClick={() => void command({ cmd: 'disconnect' })}>
              <Plug /> Disconnect
            </Button>
          ) : (
            <Button variant="secondary" size="sm" data-testid="connect" disabled={busy} onClick={() => void command({ cmd: 'connect' })}>
              <PlugZap /> Connect (sim)
            </Button>
          )}
          <Button variant="outline" size="sm" data-testid="home" disabled={busy || !connected || mode !== 'cylinder' || !is('IDLE', 'READY')} onClick={() => void command({ cmd: 'home' })}>
            <Home /> Home U
          </Button>
          <Button variant="outline" size="sm" data-testid="prepare" disabled={busy || !is('IDLE', 'READY')} onClick={() => void command({ cmd: 'prepare' })}>
            <Wrench /> Prepare job
          </Button>
          {is('ARMED') ? (
            <Button variant="outline" size="sm" onClick={() => void command({ cmd: 'disarm' })}>
              <ShieldCheck /> Disarm
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              data-testid="arm"
              disabled={busy || !is('READY')}
              onClick={() => {
                setArmChecks([false, false, false]);
                setArmOpen(true);
              }}
            >
              <ShieldAlert /> Arm…
            </Button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Button variant="default" size="sm" data-testid="start" disabled={busy || !is('ARMED')} onClick={() => void start()}>
            <Play /> Start
          </Button>
          {is('PAUSED') ? (
            <Button variant="secondary" size="sm" onClick={() => void command({ cmd: 'resume' })}>
              <Play /> Resume
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={!is('RUNNING') || job?.pauseRequested} onClick={() => void command({ cmd: 'pause' })}>
              <Pause /> {job?.pauseRequested ? 'Pausing…' : 'Pause'}
            </Button>
          )}
          <Button variant="destructive" size="sm" data-testid="stop" disabled={!is('RUNNING', 'PAUSED', 'ARMED')} onClick={() => void command({ cmd: 'stop' })}>
            <Square /> Stop
          </Button>
        </div>
        {(is('FAULT') || is('ESTOP')) && (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-red-500/50"
            data-testid="reset"
            onClick={() => {
              setReleased(false);
              setResetOpen(is('ESTOP') ? 'estop' : 'fault');
            }}
          >
            <RotateCcw /> {is('ESTOP') ? 'Reset E-stop…' : 'Acknowledge fault…'}
          </Button>
        )}
        <Field label="Sim speed">
          <Select value={String(speed)} onChange={(e) => void setSpeed(Number(e.currentTarget.value))}>
            {[0.25, 0.5, 1, 2, 5, 10, 25].map((v) => (
              <option key={v} value={v}>
                {v}× real time
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section title="Job">
        {job ? (
          <div className="space-y-1" data-testid="job-progress">
            <div className="h-2 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${(job.progress * 100).toFixed(1)}%` }} />
            </div>
            <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
              <span>
                unit {Math.min(job.unit + 1, job.unitCount)}/{job.unitCount} · {job.step}
                {job.paused && ' · paused'}
              </span>
              <span>
                {formatDuration(job.elapsedS)} / {formatDuration(job.estimatedS)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {summary ? `Planned: ${summary.stats.segmentCount} segments, ${summary.sections.length} sections, est. ${formatDuration(summary.stats.estimatedTimeS)}.` : 'No job.'}
            {summary && !summary.executable && ' Not executable (see warnings).'}
          </p>
        )}
        {snap.outcome && (
          <div className="text-[11px]" data-testid="job-outcome">
            Last outcome:{' '}
            {snap.outcome.type === 'completed' ? (
              <span className="text-emerald-400">completed in {formatDuration(snap.outcome.durationS)}</span>
            ) : snap.outcome.type === 'failed' ? (
              <span className="text-red-400">failed: {snap.outcome.reason}</span>
            ) : (
              <span className="text-amber-400">{snap.outcome.type}</span>
            )}
          </div>
        )}
        {report && (
          <div className="space-y-0.5 text-[11px]" data-testid="prepare-report">
            <div className={report.ok ? 'text-emerald-400' : 'text-red-400'}>
              Prepare {report.ok ? `OK: ${report.units} unit(s), est. ${formatDuration(report.estimatedS)}` : 'failed'}
            </div>
            {report.errors.map((e) => (
              <div key={e} className="text-red-300">
                ✕ {e}
              </div>
            ))}
            {report.warnings.map((w) => (
              <div key={w} className="text-amber-300">
                ⚠ {w}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Fault injection (simulator)">
        <div className="flex gap-1">
          <Select value={injection} onChange={(e) => setInjection(Number(e.currentTarget.value))} aria-label="Injection">
            {INJECTIONS.map((i, idx) => (
              <option key={i.label} value={idx}>
                {i.label}
              </option>
            ))}
          </Select>
          <Button variant="outline" size="sm" data-testid="inject" onClick={() => void inject({ atS: null, kind: INJECTIONS[injection]!.kind })}>
            <Zap /> Inject
          </Button>
        </div>
        <p className="text-[10.5px] text-muted-foreground">Faults never auto-resume: the job stops and needs an explicit acknowledgement.</p>
      </Section>

      <ConfirmDialog
        open={armOpen}
        onOpenChange={setArmOpen}
        title="Arm the (simulated) machine"
        description={
          <>
            Arming permits laser emission once the job is started. This build only drives the simulator, but the same checklist will gate real hardware.
          </>
        }
        confirmLabel="Arm"
        confirmDisabled={!armChecks.every(Boolean)}
        onConfirm={() => void command({ cmd: 'arm', confirmed: true })}
      >
        <div className="space-y-2">
          {['The enclosure is closed and interlocks are in place.', 'Eye protection is worn by everyone nearby.', 'The workpiece is secured and the E-stop is within reach.'].map((label, i) => (
            <Check key={label} checked={armChecks[i]!} onChange={(c) => setArmChecks((a) => a.map((v, j) => (j === i ? c : v)))}>
              {label}
            </Check>
          ))}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={resetOpen !== null}
        onOpenChange={(o) => !o && setResetOpen(null)}
        title={resetOpen === 'estop' ? 'Reset emergency stop' : 'Acknowledge fault'}
        description={
          resetOpen === 'estop'
            ? 'The job will not resume. Axes return to a disabled, unhomed state and must be homed again.'
            : 'The job will not resume. The prepared job is discarded and must be prepared again.'
        }
        destructive
        confirmLabel="Reset"
        confirmDisabled={resetOpen === 'estop' && !released}
        onConfirm={() => void command(resetOpen === 'estop' ? { cmd: 'resetEstop', confirmed: true, hardwareReleased: released } : { cmd: 'resetFault', confirmed: true })}
      >
        {resetOpen === 'estop' && (
          <Check checked={released} onChange={setReleased}>
            The hardware E-stop button has been released and the cause has been checked.
          </Check>
        )}
      </ConfirmDialog>
    </>
  );
}
