use laser_core::{CoreError, LaserSource, Result};
use laser_gcode::{CommandClass, Dialect, classify, parse_line};
use laser_protocol::{Direction, LineFramer};
use laser_simulator::{ControlChannel, F1Control, F1StatusCell, HostEnd, SimClock, SimHandles};

use crate::{Capabilities, DeviceEvent, DeviceEventKind, LaserDevice, SharedLog, log_push};

const CH: &str = "sim-f1";

/// Driver for the simulated F1. Speaks the same newline G-code stream as the real device
/// over an in-memory link.
pub struct SimF1Device {
    link: HostEnd,
    control: ControlChannel,
    status: F1StatusCell,
    clock: SimClock,
    log: SharedLog,
    framer: LineFramer,
    connected: bool,
    emission_permitted: bool,
    source: LaserSource,
    sent: u64,
    acked: u64,
    errors: Vec<String>,
    in_program: bool,
}

impl SimF1Device {
    pub fn new(h: &SimHandles, log: SharedLog) -> Self {
        Self {
            link: h.f1_link.clone(),
            control: h.f1_control.clone(),
            status: h.f1_status.clone(),
            clock: h.clock.clone(),
            log,
            framer: LineFramer::new(1024),
            connected: false,
            emission_permitted: false,
            source: LaserSource::Blue,
            sent: 0,
            acked: 0,
            errors: Vec::new(),
            in_program: false,
        }
    }

    fn t(&self) -> f64 {
        self.clock.now()
    }
}

pub(crate) fn contains_emission(lines: &[String]) -> bool {
    let mut modal = 0.0;
    for (i, l) in lines.iter().enumerate() {
        let b = parse_line(l, i + 1);
        if classify(&b, &Dialect::XTOOL_F1, modal) == CommandClass::Emission {
            return true;
        }
        if let Some(s) = b.param('S') {
            modal = s;
        }
    }
    false
}

impl LaserDevice for SimF1Device {
    fn name(&self) -> &str {
        "Simulated xTool F1"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            galvo: true,
            pause: true,
            machine_info: true,
            laser_sources: vec![LaserSource::Blue, LaserSource::Ir],
            simulated: true,
            ..Default::default()
        }
    }

    fn connect(&mut self) -> Result<()> {
        if !self.link.is_up() {
            return Err(CoreError::Communication("simulated F1 link is down".into()));
        }
        self.connected = true;
        log_push(&self.log, self.t(), CH, Direction::Info, "connected (simulated)");
        Ok(())
    }

    fn disconnect(&mut self) {
        if self.connected {
            self.connected = false;
            log_push(&self.log, self.t(), CH, Direction::Info, "disconnected");
        }
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    fn machine_info(&mut self) -> Result<serde_json::Value> {
        if !self.connected {
            return Err(CoreError::Communication("not connected".into()));
        }
        Ok(serde_json::json!({
            "deviceName": "xTool F1 (simulated)",
            "firmware": "sim-v1",
            "simulated": true,
        }))
    }

    fn set_emission_permitted(&mut self, permitted: bool) {
        self.emission_permitted = permitted;
    }

    fn set_laser_source(&mut self, source: LaserSource) {
        self.source = source;
    }

    fn send_program(&mut self, lines: &[String]) -> Result<()> {
        let t = self.t();
        if !self.connected {
            return Err(CoreError::Communication("not connected".into()));
        }
        if contains_emission(lines) && !self.emission_permitted {
            log_push(&self.log, t, CH, Direction::Blocked, "program refused: emission not permitted");
            return Err(CoreError::Safety("program contains emission but the laser is not permitted".into()));
        }
        let mut buf = String::new();
        for l in lines {
            buf.push_str(l);
            buf.push('\n');
        }
        if !self.link.write(buf.as_bytes()) {
            return Err(CoreError::Communication("link down".into()));
        }
        for l in lines {
            log_push(&self.log, t, CH, Direction::Tx, l.clone());
        }
        self.sent = lines.len() as u64;
        self.acked = 0;
        self.in_program = true;
        self.errors.clear();
        Ok(())
    }

    fn program_done(&self) -> bool {
        self.in_program && self.acked >= self.sent && !self.status.get().working
    }

    fn program_failed(&self) -> Option<String> {
        self.errors.first().cloned()
    }

    fn pause(&mut self) -> Result<()> {
        self.control.send(F1Control::Pause);
        Ok(())
    }

    fn resume(&mut self) -> Result<()> {
        self.control.send(F1Control::Resume);
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.control.send(F1Control::Stop);
        log_push(&self.log, self.t(), CH, Direction::Tx, "[http] POST /processing/stop");
        self.in_program = false;
        self.acked = self.sent;
        Ok(())
    }

    fn emergency_stop(&mut self) -> Result<()> {
        self.control.send(F1Control::EmergencyStop);
        log_push(&self.log, self.t(), CH, Direction::Tx, "[estop] stop processing");
        self.in_program = false;
        self.acked = self.sent;
        Ok(())
    }

    fn reset_estop(&mut self) -> Result<()> {
        self.control.send(F1Control::ResetEstop);
        Ok(())
    }

    fn poll(&mut self) -> Vec<DeviceEvent> {
        let t = self.t();
        let mut ev = Vec::new();
        if self.connected && !self.link.is_up() {
            self.connected = false;
            log_push(&self.log, t, CH, Direction::Error, "connection lost");
            ev.push(DeviceEvent {
                t_s: t,
                device: "f1".into(),
                kind: DeviceEventKind::Disconnected { reason: "F1 link lost".into() },
            });
            return ev;
        }
        let bytes = self.link.read();
        for line in self.framer.push(&bytes) {
            log_push(&self.log, t, CH, Direction::Rx, line.clone());
            if line == "ok" {
                self.acked += 1;
            } else if line.starts_with("error") {
                self.acked += 1;
                self.errors.push(line.clone());
                ev.push(DeviceEvent {
                    t_s: t,
                    device: "f1".into(),
                    kind: DeviceEventKind::Fault { code: "F1_ERROR".into(), message: line },
                });
            }
        }
        ev
    }
}
