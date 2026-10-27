//! Virtual ESP32-S3 external axis controller (rotary A + linear U) speaking the OLS axis
//! protocol v1. Mirrors the firmware state machine in `firmware/esp32-motion-controller`.

use std::collections::VecDeque;

use laser_core::{LinearAxisConfig, RotaryAxisConfig};
use laser_motion::timing::{trapezoid_fraction, trapezoid_time};
use laser_protocol::LineFramer;
use laser_protocol::axis::{ControllerState, ControllerStatus, Frame, Request, Response};

pub const SIM_FIRMWARE: &str = "sim-0.1.0";
const HOMING_SETTLE_S: f64 = 0.3;

#[derive(Debug, Clone, Copy)]
struct Motion {
    seq: u32,
    start_t: f64,
    from: (f64, f64),
    to: (f64, f64),
    duration: f64,
    homing: bool,
}

pub struct VirtualAxisController {
    pub rotary: RotaryAxisConfig,
    pub linear: LinearAxisConfig,
    pub state: ControllerState,
    pub a_deg: f64,
    pub u_mm: f64,
    pub homed: bool,
    pub enabled: bool,
    pub latency_s: f64,
    pub extra_delay_s: f64,
    pub drop_next_completion: bool,
    pub position_error: (f64, f64),
    pub limit_hit_pending: bool,
    framer: LineFramer,
    inbox: VecDeque<(f64, String)>,
    outbox: VecDeque<(f64, String)>,
    motion: Option<Motion>,
    pub notes: Vec<(String, String)>,
}

impl VirtualAxisController {
    pub fn new(rotary: RotaryAxisConfig, linear: LinearAxisConfig) -> Self {
        Self {
            rotary,
            linear,
            state: ControllerState::Disabled,
            a_deg: 0.0,
            // Unknown position until homed; deliberately not at a limit.
            u_mm: 37.0,
            homed: false,
            enabled: false,
            latency_s: 0.004,
            extra_delay_s: 0.0,
            drop_next_completion: false,
            position_error: (0.0, 0.0),
            limit_hit_pending: false,
            framer: LineFramer::new(512),
            inbox: VecDeque::new(),
            outbox: VecDeque::new(),
            motion: None,
            notes: Vec::new(),
        }
    }

    pub fn status(&self) -> ControllerStatus {
        ControllerStatus { state: self.state, a_deg: self.a_deg, u_mm: self.u_mm, homed: self.homed, enabled: self.enabled }
    }

    pub fn receive(&mut self, bytes: &[u8], t: f64) {
        for line in self.framer.push(bytes) {
            self.inbox.push_back((t + self.latency_s, line));
        }
    }

    pub fn take_output(&mut self, t: f64) -> Vec<u8> {
        let mut out = Vec::new();
        while self.outbox.front().is_some_and(|(due, _)| *due <= t) {
            let (_, l) = self.outbox.pop_front().expect("checked");
            out.extend(l.as_bytes());
        }
        out
    }

    fn send(&mut self, t: f64, seq: u32, r: Response) {
        self.outbox.push_back((t + self.latency_s + self.extra_delay_s, r.to_frame(seq).encode()));
    }

    fn reject(&mut self, t: f64, seq: u32, code: &str, msg: &str) {
        self.send(t, seq, Response::Rejected { code: code.into(), message: msg.into() });
    }

    /// Unsolicited fault (seq 0). Aborts motion and disables drivers.
    pub fn fault(&mut self, t: f64, code: &str, msg: &str) {
        self.motion = None;
        self.state = if code == "ESTOP" { ControllerState::Estop } else { ControllerState::Fault };
        self.enabled = false;
        self.notes.push(("axis-fault".into(), format!("{code}: {msg}")));
        self.send(t, 0, Response::Fault { code: code.into(), message: msg.into() });
    }

    fn duration(&self, from: (f64, f64), to: (f64, f64)) -> f64 {
        let ta = trapezoid_time((to.0 - from.0).abs(), self.rotary.max_velocity_deg_s, self.rotary.max_accel_deg_s2);
        let tu = trapezoid_time((to.1 - from.1).abs(), self.linear.max_velocity_mm_s, self.linear.max_accel_mm_s2);
        ta.max(tu)
    }

    fn start_motion(&mut self, t: f64, seq: u32, to: (f64, f64), homing: bool) {
        let from = (self.a_deg, self.u_mm);
        let mut duration = self.duration(from, to);
        if homing {
            duration += HOMING_SETTLE_S;
        }
        self.state = if homing { ControllerState::Homing } else { ControllerState::Moving };
        self.motion = Some(Motion { seq, start_t: t, from, to, duration, homing });
        self.send(t, seq, Response::Accepted);
        self.send(t, seq, Response::Started);
    }

    fn handle(&mut self, line: &str, t: f64) {
        let frame = match Frame::decode(line) {
            Ok(f) => f,
            Err(e) => {
                self.notes.push(("axis-frame-error".into(), e.to_string()));
                self.reject(t, 0, "FRAME", "frame rejected");
                return;
            }
        };
        let seq = frame.seq;
        let req = match Request::from_frame(&frame) {
            Ok(r) => r,
            Err(_) => return self.reject(t, seq, "UNKNOWN", "unknown request"),
        };
        let busy = self.motion.is_some();
        let latched = matches!(self.state, ControllerState::Fault | ControllerState::Estop);
        match req {
            Request::Hello => self.send(t, seq, Response::Hello { proto: laser_protocol::axis::PROTOCOL_VERSION, firmware: SIM_FIRMWARE.into() }),
            Request::Caps => self.send(t, seq, Response::Caps { axes: "A U".into(), encoder: false, estop_input: true }),
            Request::Status => {
                let st = self.status();
                self.send(t, seq, Response::Status(st));
            }
            Request::Enable if latched => self.reject(t, seq, "STATE", "reset required"),
            Request::Enable => {
                self.enabled = true;
                if self.state == ControllerState::Disabled {
                    self.state = ControllerState::Idle;
                }
                self.send(t, seq, Response::Accepted);
            }
            Request::Disable if busy => self.reject(t, seq, "BUSY", "axis moving"),
            Request::Disable => {
                self.enabled = false;
                if !latched {
                    self.state = ControllerState::Disabled;
                }
                self.send(t, seq, Response::Accepted);
            }
            Request::HomeU | Request::Move { .. } if latched => self.reject(t, seq, "STATE", "fault latched"),
            Request::HomeU | Request::Move { .. } if !self.enabled => self.reject(t, seq, "DISABLED", "drivers disabled"),
            Request::HomeU | Request::Move { .. } if busy => self.reject(t, seq, "BUSY", "axis moving"),
            Request::HomeU => self.start_motion(t, seq, (self.a_deg, self.linear.travel_min_mm), true),
            Request::Move { a_deg, u_mm } => {
                let ta = a_deg.unwrap_or(self.a_deg);
                let tu = u_mm.unwrap_or(self.u_mm);
                if !ta.is_finite() || !tu.is_finite() {
                    return self.reject(t, seq, "ARG", "non-finite target");
                }
                if u_mm.is_some() && (tu - self.u_mm).abs() > 1e-9 && !self.homed {
                    return self.reject(t, seq, "NOT_HOMED", "U must be homed first");
                }
                if tu < self.linear.travel_min_mm - 1e-9 || tu > self.linear.travel_max_mm + 1e-9 {
                    return self.reject(t, seq, "LIMIT", "U target outside soft limits");
                }
                self.start_motion(t, seq, (ta, tu), false);
            }
            Request::Stop => {
                if let Some(m) = self.motion.take() {
                    self.state = ControllerState::Idle;
                    self.reject(t, m.seq, "ABORTED", "stopped by host");
                }
                self.send(t, seq, Response::Accepted);
            }
            Request::Estop => {
                self.send(t, seq, Response::Accepted);
                self.fault(t, "ESTOP", "host emergency stop");
                self.homed = false;
            }
            Request::Reset => {
                if latched {
                    self.state = ControllerState::Disabled;
                    self.enabled = false;
                }
                self.send(t, seq, Response::Accepted);
            }
        }
    }

    pub fn step(&mut self, t: f64) {
        while self.inbox.front().is_some_and(|(due, _)| *due <= t) {
            let (_, l) = self.inbox.pop_front().expect("checked");
            self.handle(&l, t);
        }
        let Some(m) = self.motion else { return };
        let el = (t - m.start_t).max(0.0);
        let travel = (el - if m.homing { HOMING_SETTLE_S } else { 0.0 }).max(0.0);
        let fa = trapezoid_fraction(m.to.0 - m.from.0, self.rotary.max_velocity_deg_s, self.rotary.max_accel_deg_s2, travel);
        let fu = trapezoid_fraction(m.to.1 - m.from.1, self.linear.max_velocity_mm_s, self.linear.max_accel_mm_s2, travel);
        self.a_deg = m.from.0 + (m.to.0 - m.from.0) * fa;
        self.u_mm = m.from.1 + (m.to.1 - m.from.1) * fu;
        if self.limit_hit_pending && el >= m.duration * 0.5 {
            self.limit_hit_pending = false;
            self.homed = false;
            self.fault(t, "LIMIT", "limit switch triggered during move");
            return;
        }
        if el >= m.duration {
            self.motion = None;
            self.state = ControllerState::Idle;
            self.a_deg = m.to.0 + self.position_error.0;
            self.u_mm = m.to.1 + self.position_error.1;
            if m.homing {
                self.homed = true;
            }
            if self.drop_next_completion {
                self.drop_next_completion = false;
                self.notes.push(("axis-injection".into(), "completion message dropped".into()));
            } else {
                self.send(t, m.seq, Response::Completed { a_deg: self.a_deg, u_mm: self.u_mm });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exchange(c: &mut VirtualAxisController, req: Request, seq: u32, t0: f64, until: f64) -> Vec<Response> {
        c.receive(req.to_frame(seq).encode().as_bytes(), t0);
        let mut out = Vec::new();
        let mut t = t0;
        while t < until {
            t += 0.002;
            c.step(t);
            let bytes = c.take_output(t);
            for l in String::from_utf8(bytes).unwrap().lines() {
                out.push(Response::from_frame(&Frame::decode(l).unwrap()).unwrap());
            }
        }
        out
    }

    fn ctrl() -> VirtualAxisController {
        VirtualAxisController::new(RotaryAxisConfig::default(), LinearAxisConfig::default())
    }

    #[test]
    fn move_requires_enable_and_home() {
        let mut c = ctrl();
        let r = exchange(&mut c, Request::Move { a_deg: Some(10.0), u_mm: None }, 1, 0.0, 0.1);
        assert!(matches!(&r[0], Response::Rejected { code, .. } if code == "DISABLED"));
        exchange(&mut c, Request::Enable, 2, 0.1, 0.2);
        let r = exchange(&mut c, Request::Move { a_deg: None, u_mm: Some(50.0) }, 3, 0.2, 0.3);
        assert!(matches!(&r[0], Response::Rejected { code, .. } if code == "NOT_HOMED"));
        let r = exchange(&mut c, Request::HomeU, 4, 0.3, 10.0);
        assert_eq!(r[0], Response::Accepted);
        assert_eq!(r[1], Response::Started);
        assert!(matches!(r[2], Response::Completed { u_mm, .. } if u_mm == 0.0));
        assert!(c.homed);
        let r = exchange(&mut c, Request::Move { a_deg: Some(90.0), u_mm: Some(50.0) }, 5, 10.0, 20.0);
        assert!(matches!(r[2], Response::Completed { a_deg, u_mm } if a_deg == 90.0 && u_mm == 50.0));
        let r = exchange(&mut c, Request::Move { a_deg: None, u_mm: Some(500.0) }, 6, 20.0, 20.1);
        assert!(matches!(&r[0], Response::Rejected { code, .. } if code == "LIMIT"));
    }

    #[test]
    fn estop_latches_until_reset() {
        let mut c = ctrl();
        exchange(&mut c, Request::Enable, 1, 0.0, 0.05);
        let r = exchange(&mut c, Request::Estop, 2, 0.05, 0.1);
        assert!(r.iter().any(|x| matches!(x, Response::Fault { code, .. } if code == "ESTOP")));
        let r = exchange(&mut c, Request::Enable, 3, 0.1, 0.15);
        assert!(matches!(&r[0], Response::Rejected { code, .. } if code == "STATE"));
        exchange(&mut c, Request::Reset, 4, 0.15, 0.2);
        let r = exchange(&mut c, Request::Enable, 5, 0.2, 0.25);
        assert_eq!(r[0], Response::Accepted);
        assert!(!c.homed);
    }

    #[test]
    fn dropped_completion_and_limit_injection() {
        let mut c = ctrl();
        exchange(&mut c, Request::Enable, 1, 0.0, 0.05);
        c.drop_next_completion = true;
        let r = exchange(&mut c, Request::Move { a_deg: Some(30.0), u_mm: None }, 2, 0.05, 5.0);
        assert_eq!(r, vec![Response::Accepted, Response::Started]);
        c.limit_hit_pending = true;
        exchange(&mut c, Request::HomeU, 3, 5.0, 5.05);
        let r = exchange(&mut c, Request::Status, 4, 5.05, 30.0);
        assert!(r.iter().any(|x| matches!(x, Response::Fault { code, .. } if code == "LIMIT")));
        assert_eq!(c.state, ControllerState::Fault);
    }
}
