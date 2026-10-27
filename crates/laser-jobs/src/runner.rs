use laser_devices::{CmdId, CommandStage, CompositeMachineDevice};
use serde::Serialize;

use crate::job::Job;

/// Position tolerance used when verifying external-axis moves.
pub const VERIFY_TOL_A_DEG: f64 = 0.05;
pub const VERIFY_TOL_U_MM: f64 = 0.02;
const VERIFY_TIMEOUT_S: f64 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStep {
    MoveExternal,
    WaitExternal,
    VerifyExternal,
    Settle,
    ExecuteF1,
    WaitF1,
    Advance,
    Done,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum JobOutcome {
    Completed { duration_s: f64 },
    Failed { reason: String },
    Stopped,
    EmergencyStopped,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLogEntry {
    pub t_s: f64,
    pub unit: usize,
    pub step: JobStep,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RunnerSignal {
    Continue,
    /// Reached a boundary while a pause was requested.
    PausedAtBoundary,
    Completed,
    Fault(String),
}

pub struct JobRunner {
    pub job: Job,
    pub unit: usize,
    pub step: JobStep,
    step_t: f64,
    start_t: f64,
    cmd: Option<CmdId>,
    pub settle_s: f64,
    pub pause_requested: bool,
    pub paused: bool,
    paused_at: f64,
    pub log: Vec<JobLogEntry>,
}

impl JobRunner {
    pub fn new(job: Job, settle_s: f64, t: f64) -> Self {
        Self {
            job,
            unit: 0,
            step: JobStep::MoveExternal,
            step_t: t,
            start_t: t,
            cmd: None,
            settle_s,
            pause_requested: false,
            paused: false,
            paused_at: 0.0,
            log: Vec::new(),
        }
    }

    pub fn progress(&self) -> f64 {
        let n = self.job.units.len().max(1) as f64;
        if self.step == JobStep::Done {
            return 1.0;
        }
        let within = match self.step {
            JobStep::MoveExternal | JobStep::WaitExternal | JobStep::VerifyExternal | JobStep::Settle => 0.0,
            JobStep::ExecuteF1 | JobStep::WaitF1 => 0.5,
            JobStep::Advance | JobStep::Done => 1.0,
        };
        ((self.unit as f64 + within) / n).clamp(0.0, 1.0)
    }

    fn goto(&mut self, step: JobStep, t: f64, msg: impl Into<String>) {
        self.step = step;
        self.step_t = t;
        self.log.push(JobLogEntry { t_s: t, unit: self.unit, step, message: msg.into() });
    }

    pub fn note(&mut self, t: f64, msg: impl Into<String>) {
        self.log.push(JobLogEntry { t_s: t, unit: self.unit, step: self.step, message: msg.into() });
    }

    /// Pause took effect (device-level pause or boundary pause).
    pub fn mark_paused(&mut self, t: f64) {
        self.paused = true;
        self.paused_at = t;
        self.note(t, "paused");
    }

    pub fn mark_resumed(&mut self, t: f64) {
        // Timeouts exclude time spent paused.
        self.step_t += t - self.paused_at;
        self.paused = false;
        self.pause_requested = false;
        self.note(t, "resumed");
    }

    fn fault(&mut self, t: f64, reason: String) -> RunnerSignal {
        self.note(t, format!("FAULT: {reason}"));
        RunnerSignal::Fault(reason)
    }

    pub fn tick(&mut self, t: f64, dev: &mut CompositeMachineDevice) -> RunnerSignal {
        if self.paused {
            return RunnerSignal::Continue;
        }
        let Some(unit) = self.job.units.get(self.unit).cloned() else {
            return RunnerSignal::Completed;
        };
        let el = t - self.step_t;
        match self.step {
            JobStep::MoveExternal => {
                if self.pause_requested {
                    self.mark_paused(t);
                    return RunnerSignal::PausedAtBoundary;
                }
                match (unit.target, dev.axes.as_mut()) {
                    (Some((a, u)), Some(axes)) => match axes.move_to(a, u) {
                        Ok(id) => {
                            self.cmd = Some(id);
                            self.goto(JobStep::WaitExternal, t, format!("section {}: move A={a:.3} U={u:.3}", unit.index));
                        }
                        Err(e) => return self.fault(t, format!("external move could not be sent: {e}")),
                    },
                    (Some(_), None) => return self.fault(t, "job needs external axes but none are connected".into()),
                    (None, _) => self.goto(JobStep::ExecuteF1, t, "flat job: no external move"),
                }
            }
            JobStep::WaitExternal => {
                let (Some(id), Some(axes)) = (self.cmd, dev.axes.as_ref()) else {
                    return self.fault(t, "lost external command".into());
                };
                match axes.stage(id) {
                    Some(CommandStage::Completed) => match dev.axes.as_mut().map(|a| a.request_status()) {
                        Some(Ok(sid)) => {
                            self.cmd = Some(sid);
                            self.goto(JobStep::VerifyExternal, t, "external move completed; verifying position");
                        }
                        _ => return self.fault(t, "status request failed".into()),
                    },
                    Some(CommandStage::Failed) => {
                        let e = axes.command_error(id).unwrap_or_default();
                        return self.fault(t, format!("external move failed: {e}"));
                    }
                    _ => {
                        let limit = unit.external_move_s * 2.0 + 3.0;
                        if el > limit {
                            return self.fault(t, format!("external move did not complete within {limit:.1} s"));
                        }
                    }
                }
            }
            JobStep::VerifyExternal => {
                let (Some(id), Some(axes)) = (self.cmd, dev.axes.as_ref()) else {
                    return self.fault(t, "lost status command".into());
                };
                match axes.stage(id) {
                    Some(CommandStage::Completed) => {
                        let (ta, tu) = unit.target.unwrap_or_default();
                        let Some(st) = axes.last_status() else {
                            return self.fault(t, "no status received".into());
                        };
                        if (st.a_deg - ta).abs() > VERIFY_TOL_A_DEG || (st.u_mm - tu).abs() > VERIFY_TOL_U_MM {
                            return self.fault(
                                t,
                                format!(
                                    "position verification failed: expected A={ta:.3} U={tu:.3}, controller reports A={:.3} U={:.3}",
                                    st.a_deg, st.u_mm
                                ),
                            );
                        }
                        self.goto(JobStep::Settle, t, "position verified");
                    }
                    Some(CommandStage::Failed) => return self.fault(t, "status request rejected".into()),
                    _ if el > VERIFY_TIMEOUT_S => return self.fault(t, "status request timed out".into()),
                    _ => {}
                }
            }
            JobStep::Settle => {
                if el >= self.settle_s {
                    self.goto(JobStep::ExecuteF1, t, "settled");
                }
            }
            JobStep::ExecuteF1 => match dev.laser.send_program(&unit.program) {
                Ok(()) => self.goto(JobStep::WaitF1, t, format!("F1 program sent ({} lines)", unit.program.len())),
                Err(e) => return self.fault(t, format!("F1 program refused: {e}")),
            },
            JobStep::WaitF1 => {
                if let Some(e) = dev.laser.program_failed() {
                    return self.fault(t, format!("F1 reported an error: {e}"));
                }
                if dev.laser.program_done() {
                    self.goto(JobStep::Advance, t, "F1 program complete");
                } else {
                    let limit = unit.estimated_s * 2.0 + 5.0;
                    if el > limit {
                        return self.fault(t, format!("F1 program did not complete within {limit:.1} s"));
                    }
                }
            }
            JobStep::Advance => {
                self.unit += 1;
                if self.unit >= self.job.units.len() {
                    self.goto(JobStep::Done, t, "job complete");
                    return RunnerSignal::Completed;
                }
                self.goto(JobStep::MoveExternal, t, format!("advance to unit {}", self.unit));
            }
            JobStep::Done => return RunnerSignal::Completed,
        }
        RunnerSignal::Continue
    }

    pub fn elapsed(&self, t: f64) -> f64 {
        t - self.start_t
    }
}
