use laser_core::{MachinePosition, MachineProfile, SafetyState};
use serde::{Deserialize, Serialize};

use crate::axis_ctrl::VirtualAxisController;
use crate::f1::VirtualF1;
use crate::f1::F1State;
use crate::link::{ControlChannel, DeviceEnd, F1Control, F1StatusCell, F1StatusSnapshot, HostEnd, SimClock, pipe};
use crate::timeline::{Sample, Timeline};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SimConfig {
    /// Timeline sampling interval and maximum integration step (s).
    pub sample_dt: f64,
    pub f1_comm_latency_s: f64,
    pub f1_exec_latency_s: f64,
    pub axis_latency_s: f64,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self { sample_dt: 0.01, f1_comm_latency_s: 0.005, f1_exec_latency_s: 0.05, axis_latency_s: 0.004 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum InjectionKind {
    F1Disconnect,
    F1Reconnect,
    AxisDisconnect,
    AxisReconnect,
    AxisFault { code: String },
    AxisDropNextCompletion,
    AxisDelay { seconds: f64 },
    AxisLimitHit,
    AxisPositionError { a_deg: f64, u_mm: f64 },
    /// Hardware e-stop input on the external controller.
    EstopButton,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Injection {
    /// Simulated time to apply at; `None` applies at the next step.
    pub at_s: Option<f64>,
    pub kind: InjectionKind,
}

/// Host-side handles handed to device drivers.
#[derive(Clone)]
pub struct SimHandles {
    pub clock: SimClock,
    pub f1_link: HostEnd,
    pub f1_control: ControlChannel,
    pub f1_status: F1StatusCell,
    pub axis_link: HostEnd,
}

pub struct SimWorld {
    pub config: SimConfig,
    pub clock: SimClock,
    pub f1: VirtualF1,
    pub axis: VirtualAxisController,
    pub timeline: Timeline,
    /// Set by the session each tick so samples carry the safety state.
    pub safety_state: SafetyState,
    pub section: i32,
    pub emission_permitted: bool,
    f1_dev: DeviceEnd,
    axis_dev: DeviceEnd,
    handles: SimHandles,
    pending: Vec<Injection>,
    t: f64,
}

impl SimWorld {
    pub fn new(profile: &MachineProfile, config: SimConfig) -> Self {
        let g = &profile.galvo;
        let mut f1 = VirtualF1::new((g.center_x_mm, g.center_y_mm), g.max_mark_speed_mm_s, g.max_travel_speed_mm_s);
        f1.comm_latency_s = config.f1_comm_latency_s;
        f1.exec_latency_s = config.f1_exec_latency_s;
        let mut axis = VirtualAxisController::new(profile.rotary.clone(), profile.linear.clone());
        axis.latency_s = config.axis_latency_s;
        let (f1_host, f1_dev) = pipe();
        let (axis_host, axis_dev) = pipe();
        let clock = SimClock::default();
        let handles = SimHandles {
            clock: clock.clone(),
            f1_link: f1_host,
            f1_control: ControlChannel::default(),
            f1_status: F1StatusCell::default(),
            axis_link: axis_host,
        };
        Self {
            config,
            clock,
            f1,
            axis,
            timeline: Timeline::default(),
            safety_state: SafetyState::Disconnected,
            section: -1,
            emission_permitted: false,
            f1_dev,
            axis_dev,
            handles,
            pending: Vec::new(),
            t: 0.0,
        }
    }

    pub fn handles(&self) -> SimHandles {
        self.handles.clone()
    }

    pub fn now(&self) -> f64 {
        self.t
    }

    pub fn position(&self) -> MachinePosition {
        MachinePosition { gx_mm: self.f1.gx, gy_mm: self.f1.gy, a_deg: self.axis.a_deg, u_mm: self.axis.u_mm }
    }

    pub fn inject(&mut self, inj: Injection) {
        self.pending.push(inj);
    }

    fn apply_injection(&mut self, kind: InjectionKind) {
        let t = self.t;
        self.timeline.event(t, "injection", format!("{kind:?}"));
        match kind {
            InjectionKind::F1Disconnect => self.f1_dev.set_up(false),
            InjectionKind::F1Reconnect => self.f1_dev.set_up(true),
            InjectionKind::AxisDisconnect => self.axis_dev.set_up(false),
            InjectionKind::AxisReconnect => self.axis_dev.set_up(true),
            InjectionKind::AxisFault { code } => self.axis.fault(t, &code, "injected fault"),
            InjectionKind::AxisDropNextCompletion => self.axis.drop_next_completion = true,
            InjectionKind::AxisDelay { seconds } => self.axis.extra_delay_s = seconds.max(0.0),
            InjectionKind::AxisLimitHit => self.axis.limit_hit_pending = true,
            InjectionKind::AxisPositionError { a_deg, u_mm } => self.axis.position_error = (a_deg, u_mm),
            InjectionKind::EstopButton => {
                self.axis.fault(t, "ESTOP", "hardware e-stop input");
                self.axis.homed = false;
            }
        }
    }

    fn substep(&mut self, h: f64) {
        let t_end = self.t + h;
        let due: Vec<InjectionKind> = {
            let (now, later): (Vec<_>, Vec<_>) =
                std::mem::take(&mut self.pending).into_iter().partition(|i| i.at_s.is_none_or(|at| at <= t_end));
            self.pending = later;
            now.into_iter().map(|i| i.kind).collect()
        };
        for k in due {
            self.apply_injection(k);
        }
        for c in self.handles.f1_control.drain() {
            match c {
                F1Control::Stop => self.f1.control_stop(),
                F1Control::Pause => self.f1.control_pause(),
                F1Control::Resume => self.f1.control_resume(),
                F1Control::EmergencyStop => self.f1.emergency_stop(),
                F1Control::ResetEstop => self.f1.reset_estop(),
            }
        }
        if self.f1_dev.is_up() {
            let b = self.f1_dev.read();
            self.f1.receive(&b, self.t);
        }
        if self.axis_dev.is_up() {
            let b = self.axis_dev.read();
            self.axis.receive(&b, self.t);
        }
        self.f1.emission_permitted = self.emission_permitted;
        let (laser_on, power) = self.f1.step(t_end, h);
        self.axis.step(t_end);
        self.t = t_end;
        self.clock.set(t_end);
        let out = self.f1.take_output(t_end);
        self.f1_dev.write(&out);
        let out = self.axis.take_output(t_end);
        self.axis_dev.write(&out);
        let st = self.f1.state();
        self.handles.f1_status.set(F1StatusSnapshot {
            working: st == F1State::Working || st == F1State::Paused,
            paused: st == F1State::Paused,
            estop: st == F1State::Estop,
            gx: self.f1.gx,
            gy: self.f1.gy,
            lines_rejected: self.f1.lines_rejected,
        });
        for (kind, msg) in self.f1.notes.drain(..).chain(self.axis.notes.drain(..)).collect::<Vec<_>>() {
            self.timeline.event(t_end, &kind, msg);
        }
        let pos = self.position();
        self.timeline.push(Sample {
            t_s: t_end,
            pos,
            laser_on,
            power_pct: power,
            state: self.safety_state,
            section: self.section,
            segment: -1,
        });
    }

    /// Advance simulated time by `dt` in steps of at most `sample_dt`.
    pub fn step(&mut self, dt: f64) {
        let max_h = self.config.sample_dt.max(1e-4);
        let mut remaining = dt.max(0.0);
        while remaining > 1e-12 {
            let h = remaining.min(max_h);
            self.substep(h);
            remaining -= h;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use laser_protocol::axis::{Frame, Request, Response};

    #[test]
    fn links_carry_traffic_with_latency() {
        let mut w = SimWorld::new(&MachineProfile::default(), SimConfig::default());
        let h = w.handles();
        h.axis_link.write(Request::Hello.to_frame(1).encode().as_bytes());
        h.f1_link.write(b"G90\n");
        w.step(0.001);
        assert!(h.axis_link.read().is_empty());
        w.step(0.05);
        let reply = String::from_utf8(h.axis_link.read()).unwrap();
        let r = Response::from_frame(&Frame::decode(reply.trim()).unwrap()).unwrap();
        assert!(matches!(r, Response::Hello { proto: 1, .. }));
        assert_eq!(String::from_utf8(h.f1_link.read()).unwrap(), "ok\n");
        assert!((h.clock.now() - w.now()).abs() < 1e-12);
    }

    #[test]
    fn disconnect_injection_silences_link() {
        let mut w = SimWorld::new(&MachineProfile::default(), SimConfig::default());
        let h = w.handles();
        w.inject(Injection { at_s: None, kind: InjectionKind::AxisDisconnect });
        w.step(0.01);
        assert!(!h.axis_link.write(b"x\n"));
        assert!(!h.axis_link.is_up());
    }
}
