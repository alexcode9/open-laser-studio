//! Simulated machine session: safety controller + virtual hardware + real drivers speaking to
//! it over in-memory links + job runner. This is what the desktop app drives in Milestone 1.

use laser_core::{CoreError, MachinePosition, Result, SafetyController, SafetyEvent, SafetyState, SafetyTransition};
use laser_devices::{
    CmdId, CommandStage, CompositeMachineDevice, DeviceEventKind, ExternalMotionControllerDevice, SharedLog,
    SimF1Device, shared_log,
};
use laser_gcode::{Dialect, Severity, parse, validate};
use laser_motion::{F1Program, Toolpath, emit_f1, plan};
use laser_project::{Project, WorkspaceMode};
use laser_protocol::ProtocolLogEntry;
use laser_protocol::axis::ControllerStatus;
use laser_simulator::{Injection, SimConfig, SimWorld, TimelineExport};
use serde::Serialize;

use crate::job::Job;
use crate::runner::{JobLogEntry, JobOutcome, JobRunner, JobStep, RunnerSignal};

const HANDSHAKE_TIMEOUT_S: f64 = 2.0;
const HOMING_TIMEOUT_S: f64 = 120.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Homing {
    Idle,
    Enabling(CmdId),
    Moving(CmdId),
    Status(CmdId),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareReport {
    pub ok: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub units: usize,
    pub estimated_s: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub unit: usize,
    pub unit_count: usize,
    pub step: JobStep,
    pub progress: f64,
    pub elapsed_s: f64,
    pub estimated_s: f64,
    pub paused: bool,
    pub pause_requested: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub t_s: f64,
    pub safety_state: SafetyState,
    pub last_fault: Option<String>,
    pub armed: bool,
    pub laser_permitted: bool,
    pub laser_on: bool,
    pub power_pct: f64,
    pub position: MachinePosition,
    pub f1_connected: bool,
    pub axes_connected: bool,
    pub axis_status: Option<ControllerStatus>,
    pub homing: bool,
    pub prepared: bool,
    pub job: Option<JobProgress>,
    pub outcome: Option<JobOutcome>,
    pub timeline_samples: usize,
    pub timeline_events: usize,
    pub simulated: bool,
}

pub struct SimSession {
    pub project: Project,
    pub safety: SafetyController,
    pub world: SimWorld,
    pub machine: CompositeMachineDevice,
    log: SharedLog,
    toolpath: Option<Toolpath>,
    program: Option<F1Program>,
    job: Option<Job>,
    runner: Option<JobRunner>,
    outcome: Option<JobOutcome>,
    homing: Homing,
    homing_t: f64,
    connect_t: f64,
    stop_pending: bool,
}

impl SimSession {
    pub fn new(project: Project, config: SimConfig) -> Self {
        let world = SimWorld::new(&project.machine, config);
        let h = world.handles();
        let log = shared_log();
        let laser = SimF1Device::new(&h, log.clone());
        let axes = ExternalMotionControllerDevice::new(h.axis_link.clone(), h.clock.clone(), log.clone());
        let machine = CompositeMachineDevice::new(Box::new(laser), Some(Box::new(axes)));
        Self {
            project,
            safety: SafetyController::new(),
            world,
            machine,
            log,
            toolpath: None,
            program: None,
            job: None,
            runner: None,
            outcome: None,
            homing: Homing::Idle,
            homing_t: 0.0,
            connect_t: 0.0,
            stop_pending: false,
        }
    }

    fn t(&self) -> f64 {
        self.world.now()
    }

    fn apply(&mut self, e: SafetyEvent) -> Result<SafetyTransition> {
        let t = self.t();
        let r = self.safety.apply(e, t);
        if let Ok(tr) = &r {
            self.world.timeline.event(t, "safety", format!("{:?} -> {:?} ({})", tr.from, tr.to, tr.event));
        }
        self.sync_permissions();
        r
    }

    fn sync_permissions(&mut self) {
        let p = self.safety.laser_permitted();
        self.machine.laser.set_emission_permitted(p);
        self.world.emission_permitted = p;
        self.world.safety_state = self.safety.state();
    }

    /// Replace the project. Refused while a job is armed or running.
    pub fn set_project(&mut self, project: Project) -> Result<()> {
        if self.safety.is_armed() || self.safety.state() == SafetyState::Stopping {
            return Err(CoreError::Safety("cannot change the project while armed or running".into()));
        }
        self.project = project;
        self.invalidate_prepared();
        Ok(())
    }

    fn invalidate_prepared(&mut self) {
        self.toolpath = None;
        self.program = None;
        self.job = None;
        if self.safety.state() == SafetyState::Ready {
            let _ = self.apply(SafetyEvent::Disarm);
        }
    }

    pub fn connect(&mut self) -> Result<()> {
        self.apply(SafetyEvent::Connect)?;
        self.connect_t = self.t();
        let r = self.machine.laser.connect().and_then(|_| match self.machine.axes.as_mut() {
            Some(a) => a.connect(),
            None => Ok(()),
        });
        if let Err(e) = r {
            let _ = self.apply(SafetyEvent::ConnectionLost { reason: e.to_string() });
            return Err(e);
        }
        Ok(())
    }

    pub fn disconnect(&mut self) -> Result<()> {
        self.apply(SafetyEvent::Disconnect)?;
        self.machine.laser.disconnect();
        if let Some(a) = self.machine.axes.as_mut() {
            a.disconnect();
        }
        self.homing = Homing::Idle;
        Ok(())
    }

    pub fn home(&mut self) -> Result<()> {
        if !matches!(self.safety.state(), SafetyState::Idle | SafetyState::Ready) {
            return Err(CoreError::Safety(format!("homing not allowed in {:?}", self.safety.state())));
        }
        let axes = self.machine.axes.as_mut().ok_or_else(|| CoreError::Unsupported("no external axes".into()))?;
        let id = axes.enable()?;
        self.homing = Homing::Enabling(id);
        self.homing_t = self.t();
        self.invalidate_prepared();
        Ok(())
    }

    pub fn toolpath(&self) -> Option<&Toolpath> {
        self.toolpath.as_ref()
    }

    pub fn program(&self) -> Option<&F1Program> {
        self.program.as_ref()
    }

    pub fn prepare(&mut self) -> Result<PrepareReport> {
        self.apply(SafetyEvent::PrepareJob)?;
        let tp = plan(&self.project);
        let prog = emit_f1(&tp, self.project.machine.galvo.max_travel_speed_mm_s);
        let mut errors = tp.errors.clone();
        let warnings = tp.warnings.clone();
        for (i, sec) in prog.sections.iter().enumerate() {
            for d in validate(&parse(&sec.join("\n")), &Dialect::XTOOL_F1) {
                if d.severity == Severity::Error {
                    errors.push(format!("unit {i} line {}: {}", d.line_no, d.message));
                }
            }
        }
        if self.project.mode == WorkspaceMode::Cylinder {
            let homed = self.machine.axes.as_ref().and_then(|a| a.last_status()).is_some_and(|s| s.homed && s.enabled);
            if !homed {
                errors.push("external axes must be enabled and homed before preparing a cylinder job".into());
            }
        }
        let job = match Job::from_toolpath(&tp, &prog) {
            Ok(j) => Some(j),
            Err(e) => {
                errors.push(e.to_string());
                None
            }
        };
        let report = PrepareReport {
            ok: errors.is_empty(),
            units: job.as_ref().map_or(0, |j| j.units.len()),
            estimated_s: job.as_ref().map_or(0.0, |j| j.estimated_s),
            errors: errors.clone(),
            warnings,
        };
        self.toolpath = Some(tp);
        self.program = Some(prog);
        if report.ok {
            self.job = job;
            self.apply(SafetyEvent::JobValidated)?;
        } else {
            self.job = None;
            self.apply(SafetyEvent::JobRejected { reason: errors.join("; ") })?;
        }
        Ok(report)
    }

    pub fn arm(&mut self, user_confirmed: bool) -> Result<()> {
        if self.job.is_none() {
            return Err(CoreError::Safety("no validated job".into()));
        }
        self.apply(SafetyEvent::Arm { user_confirmed })?;
        Ok(())
    }

    pub fn disarm(&mut self) -> Result<()> {
        self.apply(SafetyEvent::Disarm)?;
        Ok(())
    }

    pub fn start(&mut self) -> Result<()> {
        let job = self.job.clone().ok_or_else(|| CoreError::Safety("no validated job".into()))?;
        self.apply(SafetyEvent::Start)?;
        self.outcome = None;
        self.runner = Some(JobRunner::new(job, self.project.machine.external_settle_s, self.t()));
        Ok(())
    }

    pub fn pause(&mut self) -> Result<()> {
        if self.safety.state() != SafetyState::Running {
            return Err(CoreError::Safety("pause only while running".into()));
        }
        let t = self.t();
        let can_pause_now = self.machine.laser.capabilities().pause;
        let runner = self.runner.as_mut().ok_or_else(|| CoreError::Safety("no job".into()))?;
        if runner.step == JobStep::WaitF1 && can_pause_now {
            self.machine.laser.pause()?;
            runner.mark_paused(t);
            self.apply(SafetyEvent::Pause)?;
        } else {
            // Pause at the next section boundary (never interrupt an external move).
            runner.pause_requested = true;
            runner.note(t, "pause requested; will pause at next section boundary");
        }
        Ok(())
    }

    pub fn resume(&mut self) -> Result<()> {
        let t = self.t();
        if let Some(r) = self.runner.as_mut()
            && r.pause_requested
            && !r.paused
        {
            r.pause_requested = false;
            r.note(t, "pause request cancelled");
            return Ok(());
        }
        self.apply(SafetyEvent::Resume)?;
        let was_wait_f1 = self.runner.as_ref().is_some_and(|r| r.step == JobStep::WaitF1);
        if was_wait_f1 {
            self.machine.laser.resume()?;
        }
        if let Some(r) = self.runner.as_mut() {
            r.mark_resumed(t);
        }
        Ok(())
    }

    pub fn stop(&mut self) -> Result<()> {
        self.apply(SafetyEvent::Stop)?;
        let r = self.machine.stop_all();
        self.stop_pending = true;
        if self.runner.take().is_some() {
            self.outcome = Some(JobOutcome::Stopped);
        }
        r
    }

    pub fn emergency_stop(&mut self, source: &str) -> Result<()> {
        // E-stop never fails: device errors are logged, the state always latches.
        let _ = self.machine.emergency_stop();
        self.apply(SafetyEvent::EmergencyStop { source: source.into() })?;
        if self.runner.take().is_some() {
            self.outcome = Some(JobOutcome::EmergencyStopped);
        }
        self.homing = Homing::Idle;
        Ok(())
    }

    pub fn reset_fault(&mut self, user_confirmed: bool) -> Result<()> {
        self.apply(SafetyEvent::ResetFault { user_confirmed })?;
        if let Some(a) = self.machine.axes.as_mut() {
            let _ = a.reset();
        }
        self.after_reset();
        Ok(())
    }

    pub fn reset_estop(&mut self, user_confirmed: bool, hardware_released: bool) -> Result<()> {
        self.apply(SafetyEvent::ResetEstop { user_confirmed, hardware_released })?;
        let _ = self.machine.laser.reset_estop();
        if let Some(a) = self.machine.axes.as_mut() {
            let _ = a.reset();
        }
        self.after_reset();
        Ok(())
    }

    fn after_reset(&mut self) {
        self.invalidate_prepared();
        // Never resume: a reset always returns to Idle with no job; re-homing is required.
        self.runner = None;
        if !self.machine.is_connected() {
            let _ = self.apply(SafetyEvent::ConnectionLost { reason: "device not connected after reset".into() });
        }
    }

    pub fn inject(&mut self, inj: Injection) {
        self.world.inject(inj);
    }

    fn fault(&mut self, reason: String) {
        let _ = self.machine.stop_all();
        if self.runner.take().is_some() {
            self.outcome = Some(JobOutcome::Failed { reason: reason.clone() });
        }
        self.homing = Homing::Idle;
        if self.safety.state() != SafetyState::Estop {
            let _ = self.apply(SafetyEvent::Fault { reason });
        }
    }

    fn update(&mut self) {
        let t = self.t();
        for ev in self.machine.poll() {
            match ev.kind {
                DeviceEventKind::Fault { code, message } if code == "ESTOP" => {
                    let _ = self.emergency_stop(&format!("{}: {message}", ev.device));
                }
                DeviceEventKind::Fault { code, message } => {
                    if self.safety.state() != SafetyState::Disconnected {
                        self.fault(format!("{} fault {code}: {message}", ev.device));
                    }
                }
                DeviceEventKind::Disconnected { reason } => {
                    let _ = self.machine.stop_all();
                    if let Some(r) = self.runner.take() {
                        drop(r);
                        self.outcome = Some(JobOutcome::Failed { reason: reason.clone() });
                    }
                    self.homing = Homing::Idle;
                    let _ = self.apply(SafetyEvent::ConnectionLost { reason });
                }
                DeviceEventKind::Connected | DeviceEventKind::Info { .. } => {}
            }
        }
        if self.safety.state() == SafetyState::Connected {
            if self.machine.is_connected() {
                let _ = self.apply(SafetyEvent::HandshakeOk);
            } else if t - self.connect_t > HANDSHAKE_TIMEOUT_S {
                let _ = self.apply(SafetyEvent::ConnectionLost { reason: "handshake timed out".into() });
            }
        }
        self.update_homing(t);
        if self.stop_pending && self.safety.state() == SafetyState::Stopping {
            self.stop_pending = false;
            let _ = self.apply(SafetyEvent::Stopped);
        }
        if matches!(self.safety.state(), SafetyState::Running | SafetyState::Paused)
            && let Some(runner) = self.runner.as_mut()
        {
            match runner.tick(t, &mut self.machine) {
                RunnerSignal::Continue => {}
                RunnerSignal::PausedAtBoundary => {
                    let _ = self.apply(SafetyEvent::Pause);
                }
                RunnerSignal::Completed => {
                    let d = runner.elapsed(t);
                    self.outcome = Some(JobOutcome::Completed { duration_s: d });
                    let _ = self.apply(SafetyEvent::Completed);
                    self.job = None;
                }
                RunnerSignal::Fault(reason) => self.fault(reason),
            }
        }
        self.sync_permissions();
    }

    fn update_homing(&mut self, t: f64) {
        if self.homing == Homing::Idle {
            return;
        }
        if t - self.homing_t > HOMING_TIMEOUT_S {
            self.fault("homing timed out".into());
            return;
        }
        let Some(axes) = self.machine.axes.as_mut() else { return };
        let (id, next): (CmdId, fn(CmdId) -> Homing) = match self.homing {
            Homing::Enabling(id) => (id, Homing::Moving),
            Homing::Moving(id) => (id, Homing::Status),
            Homing::Status(id) => (id, |_| Homing::Idle),
            Homing::Idle => return,
        };
        match axes.stage(id) {
            Some(CommandStage::Completed) => {
                let follow = match self.homing {
                    Homing::Enabling(_) => axes.home_u(),
                    Homing::Moving(_) => axes.request_status(),
                    _ => Ok(0),
                };
                match follow {
                    Ok(nid) => self.homing = next(nid),
                    Err(e) => self.fault(format!("homing: {e}")),
                }
            }
            Some(CommandStage::Failed) => {
                let e = axes.command_error(id).unwrap_or_default();
                self.homing = Homing::Idle;
                self.world.timeline.event(t, "homing", format!("homing failed: {e}"));
            }
            _ => {}
        }
    }

    /// Advance simulated time by `dt`, polling drivers at the simulator's sample rate.
    pub fn tick(&mut self, dt: f64) -> SessionSnapshot {
        let h = self.world.config.sample_dt.max(1e-4);
        let mut remaining = dt.max(0.0);
        while remaining > 1e-12 {
            let s = remaining.min(h);
            self.world.step(s);
            self.update();
            remaining -= s;
        }
        self.snapshot()
    }

    /// Run until the job finishes or `max_s` of simulated time elapses.
    pub fn run_to_completion(&mut self, max_s: f64) -> SessionSnapshot {
        let t0 = self.t();
        while self.t() - t0 < max_s && matches!(self.safety.state(), SafetyState::Running | SafetyState::Paused | SafetyState::Stopping) {
            self.tick(0.1);
        }
        self.snapshot()
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        let job = self.runner.as_ref().map(|r| JobProgress {
            unit: r.unit,
            unit_count: r.job.units.len(),
            step: r.step,
            progress: r.progress(),
            elapsed_s: r.elapsed(self.t()),
            estimated_s: r.job.estimated_s,
            paused: r.paused,
            pause_requested: r.pause_requested,
        });
        let last = self.world.timeline.samples.last();
        SessionSnapshot {
            t_s: self.t(),
            safety_state: self.safety.state(),
            last_fault: self.safety.last_fault().map(String::from),
            armed: self.safety.is_armed(),
            laser_permitted: self.safety.laser_permitted(),
            laser_on: last.is_some_and(|s| s.laser_on),
            power_pct: last.map_or(0.0, |s| s.power_pct),
            position: self.world.position(),
            f1_connected: self.machine.laser.is_connected(),
            axes_connected: self.machine.axes.as_ref().is_some_and(|a| a.is_connected()),
            axis_status: self.machine.axes.as_ref().and_then(|a| a.last_status()),
            homing: self.homing != Homing::Idle,
            prepared: self.job.is_some(),
            job,
            outcome: self.outcome.clone(),
            timeline_samples: self.world.timeline.samples.len(),
            timeline_events: self.world.timeline.events.len(),
            simulated: true,
        }
    }

    pub fn timeline_export(&self, from_sample: usize, from_event: usize) -> TimelineExport {
        let g = &self.project.machine.galvo;
        self.world.timeline.export(
            from_sample,
            from_event,
            self.project.mode,
            &self.project.workpiece,
            (g.center_x_mm, g.center_y_mm),
            (g.invert_x, g.invert_y),
        )
    }

    pub fn log_since(&self, seq: u64) -> Vec<ProtocolLogEntry> {
        self.log.lock().unwrap_or_else(|e| e.into_inner()).since(seq)
    }

    pub fn job_log(&self) -> Vec<JobLogEntry> {
        self.runner.as_ref().map(|r| r.log.clone()).unwrap_or_default()
    }

    pub fn safety_history(&self) -> Vec<SafetyTransition> {
        self.safety.history().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use laser_project::sample::sample_project;
    use laser_project::CylinderStrategy;
    use laser_simulator::InjectionKind;

    fn ready_session() -> SimSession {
        let mut s = SimSession::new(sample_project(), SimConfig::default());
        s.connect().unwrap();
        s.tick(0.2);
        assert_eq!(s.safety.state(), SafetyState::Idle);
        s.home().unwrap();
        s.tick(30.0);
        assert!(s.snapshot().axis_status.unwrap().homed);
        let r = s.prepare().unwrap();
        assert!(r.ok, "{:?}", r.errors);
        s
    }

    fn running_session() -> SimSession {
        let mut s = ready_session();
        s.arm(true).unwrap();
        s.start().unwrap();
        s
    }

    #[test]
    fn full_cylinder_job_completes_in_simulation() {
        let mut s = running_session();
        let units = s.job.as_ref().unwrap().units.len();
        let snap = s.run_to_completion(3600.0);
        assert_eq!(snap.safety_state, SafetyState::Idle, "{:?}", snap.last_fault);
        assert!(matches!(snap.outcome, Some(JobOutcome::Completed { .. })));
        assert!(units > 1);
        let tl = &s.world.timeline;
        assert!(tl.samples.iter().any(|x| x.laser_on));
        // Laser only ever on while Running.
        assert!(tl.samples.iter().filter(|x| x.laser_on).all(|x| x.state == SafetyState::Running));
        assert!(!snap.armed);
    }

    #[test]
    fn arming_requires_confirmation_and_job() {
        let mut s = SimSession::new(sample_project(), SimConfig::default());
        assert!(s.arm(true).is_err());
        let mut s = ready_session();
        assert!(s.arm(false).is_err());
        assert_eq!(s.safety.state(), SafetyState::Ready);
    }

    #[test]
    fn cylinder_prepare_requires_homing() {
        let mut s = SimSession::new(sample_project(), SimConfig::default());
        s.connect().unwrap();
        s.tick(0.2);
        let r = s.prepare().unwrap();
        assert!(!r.ok);
        assert!(r.errors.iter().any(|e| e.contains("homed")));
        assert_eq!(s.safety.state(), SafetyState::Idle);
    }

    #[test]
    fn coupled_strategy_is_rejected_for_execution() {
        let mut p = sample_project();
        p.cylinder.strategy = CylinderStrategy::Coupled;
        let mut s = SimSession::new(p, SimConfig::default());
        s.connect().unwrap();
        s.tick(0.2);
        s.home().unwrap();
        s.tick(30.0);
        let r = s.prepare().unwrap();
        assert!(!r.ok);
        assert!(s.arm(true).is_err());
    }

    fn run_with(kind: InjectionKind, after_s: f64) -> SimSession {
        let mut s = running_session();
        s.tick(after_s);
        s.inject(Injection { at_s: None, kind });
        s.run_to_completion(600.0);
        s
    }

    #[test]
    fn axis_fault_mid_job_faults_and_never_resumes() {
        let mut s = run_with(InjectionKind::AxisFault { code: "DRIVER".into() }, 3.0);
        assert_eq!(s.safety.state(), SafetyState::Fault);
        assert!(matches!(s.snapshot().outcome, Some(JobOutcome::Failed { .. })));
        let n = s.world.timeline.samples.len();
        s.tick(5.0);
        assert!(s.world.timeline.samples[n..].iter().all(|x| !x.laser_on));
        assert!(s.start().is_err());
        s.reset_fault(true).unwrap();
        assert_eq!(s.safety.state(), SafetyState::Idle);
        assert!(!s.snapshot().prepared);
    }

    #[test]
    fn dropped_completion_times_out() {
        let s = run_with(InjectionKind::AxisDropNextCompletion, 0.0);
        assert_eq!(s.safety.state(), SafetyState::Fault);
        assert!(s.safety.last_fault().unwrap().contains("did not complete"));
    }

    #[test]
    fn position_error_fails_verification() {
        let s = run_with(InjectionKind::AxisPositionError { a_deg: 0.5, u_mm: 0.0 }, 0.0);
        assert_eq!(s.safety.state(), SafetyState::Fault);
        assert!(s.safety.last_fault().unwrap().contains("verification"));
    }

    #[test]
    fn disconnect_during_job_faults() {
        let s = run_with(InjectionKind::AxisDisconnect, 2.0);
        assert_eq!(s.safety.state(), SafetyState::Fault);
    }

    #[test]
    fn hardware_estop_latches() {
        let mut s = run_with(InjectionKind::EstopButton, 2.0);
        assert_eq!(s.safety.state(), SafetyState::Estop);
        assert!(s.reset_estop(true, false).is_err());
        s.reset_estop(true, true).unwrap();
        assert_eq!(s.safety.state(), SafetyState::Idle);
        assert!(!s.snapshot().axis_status.unwrap().homed || !s.snapshot().prepared);
    }

    #[test]
    fn pause_resume_and_stop() {
        let mut s = running_session();
        let mut paused = false;
        for _ in 0..400 {
            s.tick(0.05);
            if s.runner.as_ref().is_some_and(|r| r.step == JobStep::WaitF1) {
                s.pause().unwrap();
                paused = true;
                break;
            }
        }
        assert!(paused);
        assert_eq!(s.safety.state(), SafetyState::Paused);
        let n = s.world.timeline.samples.len();
        s.tick(2.0);
        assert!(s.world.timeline.samples[n..].iter().all(|x| !x.laser_on));
        s.resume().unwrap();
        assert_eq!(s.safety.state(), SafetyState::Running);
        s.tick(0.5);
        s.stop().unwrap();
        s.tick(0.1);
        assert_eq!(s.safety.state(), SafetyState::Idle);
        assert_eq!(s.snapshot().outcome, Some(JobOutcome::Stopped));
    }

    #[test]
    fn flat_job_runs_without_external_moves() {
        let mut p = sample_project();
        p.mode = WorkspaceMode::Flat;
        let mut s = SimSession::new(p, SimConfig::default());
        s.connect().unwrap();
        s.tick(0.2);
        let r = s.prepare().unwrap();
        if !r.ok {
            // Sample geometry may exceed the flat field; that must be reported, not executed.
            assert!(s.arm(true).is_err());
            return;
        }
        s.arm(true).unwrap();
        s.start().unwrap();
        let snap = s.run_to_completion(3600.0);
        assert!(matches!(snap.outcome, Some(JobOutcome::Completed { .. })), "{:?}", snap.last_fault);
    }
}
