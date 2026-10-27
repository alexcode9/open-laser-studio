//! Virtual xTool F1 (V1 firmware behaviour as documented in `docs/research/F1_PROTOCOL.md`).
//!
//! Accepts newline-terminated G-code, replies `ok` per line after a configurable latency
//! (reply format INFERRED), executes galvo moves at the commanded feed, and only turns the
//! simulated laser on when emission is permitted by the safety layer.

use std::collections::VecDeque;

use laser_core::{LaserSource, MachinePosition};
use laser_gcode::{Command, CommandClass, Dialect, classify, interpret, parse_line};
use laser_protocol::LineFramer;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Op {
    Move { x: f64, y: f64, feed_mm_s: f64, power_pct: f64 },
    Dwell(f64),
    SessionEnd,
}

#[derive(Debug, Clone, Copy)]
struct Active {
    op: Op,
    from: (f64, f64),
    duration: f64,
    elapsed: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum F1State {
    Idle,
    Working,
    Paused,
    Estop,
}

pub struct VirtualF1 {
    pub gx: f64,
    pub gy: f64,
    pub laser_on: bool,
    pub power_pct: f64,
    pub source: LaserSource,
    pub emission_permitted: bool,
    pub comm_latency_s: f64,
    pub exec_latency_s: f64,
    pub default_mark_mm_s: f64,
    pub default_travel_mm_s: f64,
    pub lines_received: u64,
    pub lines_rejected: u64,
    pub blocked_emissions: u64,
    framer: LineFramer,
    inbox: VecDeque<(f64, String)>,
    outbox: VecDeque<(f64, String)>,
    queue: VecDeque<Op>,
    active: Option<Active>,
    absolute: bool,
    g0_feed: Option<f64>,
    g1_feed: Option<f64>,
    s_modal: f64,
    laser_mode: bool,
    session: bool,
    paused: bool,
    estop: bool,
    blocked_reported: bool,
    /// (kind, message) notes drained by the world into timeline events.
    pub notes: Vec<(String, String)>,
}

impl VirtualF1 {
    pub fn new(center: (f64, f64), mark_mm_s: f64, travel_mm_s: f64) -> Self {
        Self {
            gx: center.0,
            gy: center.1,
            laser_on: false,
            power_pct: 0.0,
            source: LaserSource::Blue,
            emission_permitted: false,
            comm_latency_s: 0.005,
            exec_latency_s: 0.05,
            default_mark_mm_s: mark_mm_s,
            default_travel_mm_s: travel_mm_s,
            lines_received: 0,
            lines_rejected: 0,
            blocked_emissions: 0,
            framer: LineFramer::new(1024),
            inbox: VecDeque::new(),
            outbox: VecDeque::new(),
            queue: VecDeque::new(),
            active: None,
            absolute: true,
            g0_feed: None,
            g1_feed: None,
            s_modal: 0.0,
            laser_mode: false,
            session: false,
            paused: false,
            estop: false,
            blocked_reported: false,
            notes: Vec::new(),
        }
    }

    pub fn state(&self) -> F1State {
        if self.estop {
            F1State::Estop
        } else if self.paused {
            F1State::Paused
        } else if self.session || self.active.is_some() || !self.queue.is_empty() || !self.inbox.is_empty() {
            F1State::Working
        } else {
            F1State::Idle
        }
    }

    pub fn position(&self) -> MachinePosition {
        MachinePosition { gx_mm: self.gx, gy_mm: self.gy, a_deg: 0.0, u_mm: 0.0 }
    }

    pub fn receive(&mut self, bytes: &[u8], t: f64) {
        for line in self.framer.push(bytes) {
            self.inbox.push_back((t + self.comm_latency_s, line));
        }
    }

    /// Replies due at time `t`.
    pub fn take_output(&mut self, t: f64) -> Vec<u8> {
        let mut out = Vec::new();
        while self.outbox.front().is_some_and(|(due, _)| *due <= t) {
            let (_, l) = self.outbox.pop_front().expect("checked");
            out.extend(l.as_bytes());
            out.push(b'\n');
        }
        out
    }

    fn reply(&mut self, t: f64, text: &str) {
        self.outbox.push_back((t + self.comm_latency_s, text.to_string()));
    }

    fn note(&mut self, kind: &str, msg: impl Into<String>) {
        self.notes.push((kind.into(), msg.into()));
    }

    fn handle_line(&mut self, line: &str, t: f64) {
        self.lines_received += 1;
        if self.estop {
            self.lines_rejected += 1;
            self.reply(t, "error:estop");
            return;
        }
        let block = parse_line(line, self.lines_received as usize);
        if block.is_empty() {
            self.reply(t, "ok");
            return;
        }
        if !block.errors.is_empty() || classify(&block, &Dialect::XTOOL_F1, self.s_modal) == CommandClass::Unknown {
            self.lines_rejected += 1;
            self.note("f1-reject", format!("unsupported line '{line}'"));
            self.reply(t, "error:unsupported");
            return;
        }
        for cmd in interpret(&block) {
            self.apply(cmd);
        }
        self.reply(t, "ok");
    }

    fn target(&self, x: Option<f64>, y: Option<f64>) -> (f64, f64) {
        let (lx, ly) = self.queue_end();
        if self.absolute {
            (x.unwrap_or(lx), y.unwrap_or(ly))
        } else {
            (lx + x.unwrap_or(0.0), ly + y.unwrap_or(0.0))
        }
    }

    fn queue_end(&self) -> (f64, f64) {
        for op in self.queue.iter().rev() {
            if let Op::Move { x, y, .. } = op {
                return (*x, *y);
            }
        }
        match self.active {
            Some(Active { op: Op::Move { x, y, .. }, .. }) => (x, y),
            _ => (self.gx, self.gy),
        }
    }

    fn apply(&mut self, cmd: Command) {
        match cmd {
            Command::Special { name } if name == "L" => {
                self.session = true;
                self.queue.push_back(Op::Dwell(self.exec_latency_s));
            }
            Command::Special { name } if name == "P" => self.queue.push_back(Op::SessionEnd),
            Command::Absolute => self.absolute = true,
            Command::Relative => self.absolute = false,
            Command::Rapid { x, y, f, s, .. } => {
                if let Some(f) = f {
                    self.g0_feed = Some(f / 60.0);
                }
                if let Some(s) = s {
                    self.s_modal = s;
                }
                if x.is_some() || y.is_some() {
                    let (tx, ty) = self.target(x, y);
                    let feed = self.g0_feed.unwrap_or(self.default_travel_mm_s);
                    self.queue.push_back(Op::Move { x: tx, y: ty, feed_mm_s: feed, power_pct: 0.0 });
                }
            }
            Command::Linear { x, y, f, s, .. } => {
                if let Some(f) = f {
                    self.g1_feed = Some(f / 60.0);
                }
                if let Some(s) = s {
                    self.s_modal = s;
                }
                if x.is_some() || y.is_some() {
                    let (tx, ty) = self.target(x, y);
                    let feed = self.g1_feed.unwrap_or(self.default_mark_mm_s);
                    let power = if self.laser_mode { (self.s_modal / 10.0).clamp(0.0, 100.0) } else { 0.0 };
                    self.queue.push_back(Op::Move { x: tx, y: ty, feed_mm_s: feed, power_pct: power });
                }
            }
            Command::Dwell { seconds } => self.queue.push_back(Op::Dwell(seconds)),
            Command::LaserConstant { s } | Command::LaserDynamic { s } => {
                self.laser_mode = true;
                self.s_modal = s;
            }
            Command::LaserOff => {
                self.laser_mode = false;
            }
            Command::Modal { s: Some(s), .. } => self.s_modal = s,
            Command::MCode { code, params } if (code - 114.0).abs() < 1e-9 => {
                self.source = match params.iter().find(|(c, _)| *c == 'S').map(|(_, v)| *v) {
                    Some(v) if (v - 2.0).abs() < 1e-9 => LaserSource::Ir,
                    _ => LaserSource::Blue,
                };
            }
            _ => {}
        }
    }

    pub fn control_stop(&mut self) {
        self.queue.clear();
        self.active = None;
        self.inbox.clear();
        self.session = false;
        self.paused = false;
        self.laser_on = false;
        self.power_pct = 0.0;
        self.note("f1", "processing stopped");
    }

    pub fn control_pause(&mut self) {
        if self.state() == F1State::Working {
            self.paused = true;
            self.laser_on = false;
            self.note("f1", "paused");
        }
    }

    pub fn control_resume(&mut self) {
        if self.paused {
            self.paused = false;
            self.note("f1", "resumed");
        }
    }

    pub fn emergency_stop(&mut self) {
        self.control_stop();
        self.estop = true;
        self.note("f1", "emergency stop latched");
    }

    pub fn reset_estop(&mut self) {
        self.estop = false;
    }

    /// Advance by `dt` seconds ending at `t_end`. Returns true if the laser was on at any
    /// point in the interval (for timeline sampling).
    pub fn step(&mut self, t_end: f64, dt: f64) -> (bool, f64) {
        while self.inbox.front().is_some_and(|(due, _)| *due <= t_end) {
            let (_, l) = self.inbox.pop_front().expect("checked");
            self.handle_line(&l, t_end);
        }
        let mut any_on = self.laser_on;
        let mut max_power = self.power_pct;
        if self.paused || self.estop {
            self.laser_on = false;
            return (false, 0.0);
        }
        let mut budget = dt;
        while budget > 0.0 {
            if self.active.is_none() {
                let Some(op) = self.queue.pop_front() else { break };
                let duration = match op {
                    Op::Move { x, y, feed_mm_s, .. } => {
                        let d = ((x - self.gx).powi(2) + (y - self.gy).powi(2)).sqrt();
                        if feed_mm_s > 0.0 { d / feed_mm_s } else { 0.0 }
                    }
                    Op::Dwell(s) => s.max(0.0),
                    Op::SessionEnd => 0.0,
                };
                self.active = Some(Active { op, from: (self.gx, self.gy), duration, elapsed: 0.0 });
            }
            let a = self.active.as_mut().expect("set");
            let take = (a.duration - a.elapsed).min(budget).max(0.0);
            a.elapsed += take;
            budget -= take;
            let a = *a;
            match a.op {
                Op::Move { x, y, power_pct, .. } => {
                    let f = if a.duration > 0.0 { a.elapsed / a.duration } else { 1.0 };
                    self.gx = a.from.0 + (x - a.from.0) * f;
                    self.gy = a.from.1 + (y - a.from.1) * f;
                    let wants = power_pct > 0.0;
                    if wants && !self.emission_permitted {
                        self.laser_on = false;
                        self.power_pct = 0.0;
                        if !self.blocked_reported {
                            self.blocked_emissions += 1;
                            self.blocked_reported = true;
                            self.note("emission-blocked", "mark move executed with emission not permitted; laser held off");
                        }
                    } else {
                        self.laser_on = wants;
                        self.power_pct = power_pct;
                    }
                }
                Op::Dwell(_) => {
                    self.laser_on = false;
                    self.power_pct = 0.0;
                }
                Op::SessionEnd => {
                    self.session = false;
                    self.laser_on = false;
                    self.power_pct = 0.0;
                    self.blocked_reported = false;
                }
            }
            if self.laser_on {
                any_on = true;
                max_power = max_power.max(self.power_pct);
            }
            if a.elapsed >= a.duration {
                self.active = None;
            }
        }
        if self.active.is_none() && self.queue.is_empty() {
            self.laser_on = false;
            self.power_pct = 0.0;
        }
        (any_on, if any_on { max_power } else { 0.0 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(f1: &mut VirtualF1, until: f64) -> (bool, Vec<String>) {
        let mut t = 0.0;
        let mut on = false;
        let mut out = Vec::new();
        while t < until {
            t += 0.001;
            on |= f1.step(t, 0.001).0;
            out.extend(String::from_utf8(f1.take_output(t)).unwrap().lines().map(String::from));
        }
        (on, out)
    }

    #[test]
    fn executes_program_and_replies_ok() {
        let mut f1 = VirtualF1::new((57.5, 57.5), 100.0, 3000.0);
        f1.emission_permitted = true;
        let prog = "$L\nG0 F180000\nM3 S0\nG1 F180000\nM114 S1\nG21\nG90\nG0X10Y10\nG1X20Y10S300F600\nG0 S0\nG90\nG0 S0\nM6 P1\n$P\n";
        f1.receive(prog.as_bytes(), 0.0);
        let (on, out) = run(&mut f1, 2.0);
        assert!(on);
        assert_eq!(out.iter().filter(|l| *l == "ok").count(), 14);
        assert!((f1.gx - 20.0).abs() < 1e-9 && (f1.gy - 10.0).abs() < 1e-9);
        assert_eq!(f1.state(), F1State::Idle);
        assert!(!f1.laser_on);
    }

    #[test]
    fn emission_blocked_when_not_permitted() {
        let mut f1 = VirtualF1::new((57.5, 57.5), 100.0, 3000.0);
        f1.receive(b"$L\nM3 S0\nG1X20Y10S500F600\n$P\n", 0.0);
        let (on, _) = run(&mut f1, 1.0);
        assert!(!on);
        assert_eq!(f1.blocked_emissions, 1);
    }

    #[test]
    fn rejects_unknown_and_estop_latches() {
        let mut f1 = VirtualF1::new((0.0, 0.0), 100.0, 3000.0);
        f1.receive(b"M9999\n", 0.0);
        let (_, out) = run(&mut f1, 0.1);
        assert_eq!(out, vec!["error:unsupported"]);
        f1.emergency_stop();
        f1.receive(b"G90\n", 0.0);
        let (_, out) = run(&mut f1, 0.1);
        assert_eq!(out, vec!["error:estop"]);
        assert_eq!(f1.state(), F1State::Estop);
    }
}
