import type { MachineCommand, MachineCommandResult } from '@ols/ipc-contracts';
import type { Injection, Project, SafetyState, SessionSnapshot } from '@ols/shared-types';

import { log } from './logger';
import type { NativeModule, NativeSimSession } from './native';

const LOOP_MS = 33;
/** States in which simulated time does not need to advance. */
const QUIESCENT: SafetyState[] = ['DISCONNECTED', 'IDLE', 'READY', 'ARMED', 'FAULT', 'ESTOP'];

/**
 * Owns the simulated machine session and drives simulated time. Only simulated machines
 * exist in Milestone 1; real-device execution is not implemented.
 */
export class MachineHost {
  private session: NativeSimSession | null = null;
  private timer: NodeJS.Timeout | null = null;
  private last: SessionSnapshot | null = null;
  private project: Project | null = null;
  speed = 1;

  constructor(
    private readonly native: NativeModule,
    private readonly emit: (s: SessionSnapshot) => void,
  ) {}

  create(project: Project): SessionSnapshot {
    if (this.last && this.isBusy(this.last)) {
      throw Object.assign(new Error('Cannot replace the machine while a job is active'), { code: 'SAFETY' });
    }
    this.session = new this.native.SimSession(project);
    this.project = project;
    log('info', 'simulated machine created');
    this.ensureLoop();
    return this.publish(this.session.snapshot());
  }

  private require(): NativeSimSession {
    if (!this.session) throw Object.assign(new Error('No machine session'), { code: 'INVALID_ARGUMENT' });
    return this.session;
  }

  private isBusy(s: SessionSnapshot): boolean {
    return s.armed || s.safetyState === 'STOPPING';
  }

  setProject(project: Project): SessionSnapshot {
    const s = this.require();
    s.setProject(project);
    this.project = project;
    return this.publish(s.snapshot());
  }

  command(c: MachineCommand): MachineCommandResult {
    const s = this.require();
    let report: MachineCommandResult['report'] = null;
    log('info', 'machine command', { cmd: c.cmd });
    switch (c.cmd) {
      case 'connect':
        s.connect();
        break;
      case 'disconnect':
        s.disconnect();
        break;
      case 'home':
        s.home();
        break;
      case 'prepare':
        report = s.prepare();
        break;
      case 'arm':
        s.arm(c.confirmed);
        break;
      case 'disarm':
        s.disarm();
        break;
      case 'start':
        s.start();
        break;
      case 'pause':
        s.pause();
        break;
      case 'resume':
        s.resume();
        break;
      case 'stop':
        s.stop();
        break;
      case 'estop':
        s.emergencyStop('user (software e-stop)');
        break;
      case 'resetFault':
        s.resetFault(c.confirmed);
        break;
      case 'resetEstop':
        s.resetEstop(c.confirmed, c.hardwareReleased);
        break;
    }
    return { snapshot: this.publish(s.tick(0)), report };
  }

  /** Emergency stop that never throws (used on window close / app quit). */
  emergencyStopQuiet(): void {
    try {
      this.session?.emergencyStop('application shutdown');
    } catch {
      // Already latched or no session.
    }
  }

  inject(i: Injection): SessionSnapshot {
    const s = this.require();
    s.inject(i);
    log('warn', 'fault injected', { kind: i.kind.type });
    return this.publish(s.snapshot());
  }

  timeline(fromSample: number, fromEvent: number) {
    return this.require().timeline(fromSample, fromEvent);
  }

  logSince(seq: number) {
    return this.session?.logSince(seq) ?? [];
  }

  jobLog() {
    return this.session?.jobLog() ?? [];
  }

  safetyHistory() {
    return this.session?.safetyHistory() ?? [];
  }

  programListing() {
    return this.session?.programListing() ?? [];
  }

  get machineProfile(): Project['machine'] | null {
    return this.project?.machine ?? null;
  }

  private publish(s: SessionSnapshot): SessionSnapshot {
    this.last = s;
    this.emit(s);
    return s;
  }

  private ensureLoop(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), LOOP_MS);
  }

  private step(): void {
    const s = this.session;
    if (!s || this.speed <= 0) return;
    const prev = this.last;
    const active = !prev || !QUIESCENT.includes(prev.safetyState) || prev.homing;
    if (!active) return;
    try {
      const dt = Math.min(9.9, (LOOP_MS / 1000) * this.speed);
      this.publish(s.tick(dt));
    } catch (e) {
      log('error', 'simulation tick failed', { error: String(e) });
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.session = null;
  }
}
