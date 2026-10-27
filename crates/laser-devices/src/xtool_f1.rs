//! Real xTool F1 driver (V1 firmware, TCP 8780 + HTTP 8080). UNVALIDATED on hardware.
//!
//! Every program passes through [`laser_protocol::check_lines`]: with the default gate
//! (`simulationOnly`) nothing is ever written; with developer mode only laser-off lines on the
//! allowlist can be sent, because no emission command is validated in Milestone 1.

use laser_core::{CoreError, LaserSource, Result};
use laser_gcode::Dialect;
use laser_protocol::f1::{F1Transport, F1TransportConfig};
use laser_protocol::{Direction, WriteGate, check_lines};

use crate::sim_f1::contains_emission;
use crate::{Capabilities, Clock, DeviceEvent, DeviceEventKind, LaserDevice, RealClock, SharedLog, log_push};

const CH: &str = "f1";

pub struct XToolF1Device {
    transport: F1Transport,
    pub gate: WriteGate,
    clock: RealClock,
    log: SharedLog,
    log_seq: u64,
    emission_permitted: bool,
    sent: u64,
    acked: u64,
    in_program: bool,
    working: Option<bool>,
    last_status_poll: f64,
    errors: Vec<String>,
}

impl XToolF1Device {
    pub fn new(config: F1TransportConfig, gate: WriteGate, log: SharedLog) -> Self {
        Self {
            transport: F1Transport::new(config),
            gate,
            clock: RealClock::default(),
            log,
            log_seq: 0,
            emission_permitted: false,
            sent: 0,
            acked: 0,
            in_program: false,
            working: None,
            last_status_poll: f64::NEG_INFINITY,
            errors: Vec::new(),
        }
    }

    fn sync_log(&mut self) {
        let entries = self.transport.log.since(self.log_seq);
        if let Some(last) = entries.last() {
            self.log_seq = last.seq;
        }
        let t = self.clock.now();
        for e in entries {
            log_push(&self.log, t, &e.channel, e.direction, e.text);
        }
    }

    fn gated(&self) -> Result<()> {
        check_lines(&[], &Dialect::XTOOL_F1, &self.gate)
    }
}

impl LaserDevice for XToolF1Device {
    fn name(&self) -> &str {
        "xTool F1 (V1 firmware, unvalidated)"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            galvo: true,
            // V1 has no documented pause; the job runner pauses at section boundaries.
            pause: false,
            machine_info: true,
            laser_sources: vec![LaserSource::Blue, LaserSource::Ir],
            simulated: false,
            hardware_writes: !self.gate.simulation_only && self.gate.developer_mode,
            ..Default::default()
        }
    }

    fn connect(&mut self) -> Result<()> {
        // Connecting is read-only but still requires leaving simulationOnly.
        if self.gate.simulation_only {
            return Err(CoreError::Safety("simulationOnly is enabled: real device connections are disabled".into()));
        }
        let r = self.transport.connect();
        self.sync_log();
        r
    }

    fn disconnect(&mut self) {
        self.transport.disconnect();
        self.sync_log();
    }

    fn is_connected(&self) -> bool {
        self.transport.is_connected()
    }

    fn machine_info(&mut self) -> Result<serde_json::Value> {
        if self.gate.simulation_only {
            return Err(CoreError::Safety("simulationOnly is enabled".into()));
        }
        let r = self.transport.machine_info();
        self.sync_log();
        r
    }

    fn set_emission_permitted(&mut self, permitted: bool) {
        self.emission_permitted = permitted;
    }

    fn set_laser_source(&mut self, _source: LaserSource) {}

    fn send_program(&mut self, lines: &[String]) -> Result<()> {
        if contains_emission(lines) && !self.emission_permitted {
            return Err(CoreError::Safety("program contains emission but the laser is not permitted".into()));
        }
        if let Err(e) = check_lines(lines, &Dialect::XTOOL_F1, &self.gate) {
            log_push(&self.log, self.clock.now(), CH, Direction::Blocked, e.to_string());
            return Err(e);
        }
        let r = self.transport.send_lines(lines);
        self.sync_log();
        r?;
        self.sent = lines.len() as u64;
        self.acked = 0;
        self.in_program = true;
        self.working = None;
        self.errors.clear();
        Ok(())
    }

    fn program_done(&self) -> bool {
        // INFERRED: completion = all lines acknowledged and the working-state query reports idle.
        self.in_program && self.acked >= self.sent && self.working == Some(false)
    }

    fn program_failed(&self) -> Option<String> {
        self.errors.first().cloned()
    }

    fn pause(&mut self) -> Result<()> {
        Err(CoreError::Unsupported("F1 V1 pause is not documented; pause happens at section boundaries".into()))
    }

    fn resume(&mut self) -> Result<()> {
        Err(CoreError::Unsupported("F1 V1 resume is not documented".into()))
    }

    fn stop(&mut self) -> Result<()> {
        self.gated()?;
        self.in_program = false;
        let r = self.transport.stop_processing();
        self.sync_log();
        r
    }

    fn emergency_stop(&mut self) -> Result<()> {
        // Software stop only. The F1's own emergency stop button is the primary safety device.
        self.in_program = false;
        if self.gate.simulation_only {
            return Ok(());
        }
        let r = self.transport.stop_processing();
        self.sync_log();
        r
    }

    fn reset_estop(&mut self) -> Result<()> {
        Ok(())
    }

    fn poll(&mut self) -> Vec<DeviceEvent> {
        let mut ev = Vec::new();
        if !self.transport.is_connected() {
            return ev;
        }
        let t = self.clock.now();
        match self.transport.poll_replies() {
            Ok(lines) => {
                for l in lines {
                    if l.starts_with("ok") {
                        self.acked += 1;
                    } else if l.starts_with("error") {
                        self.acked += 1;
                        self.errors.push(l.clone());
                        ev.push(DeviceEvent { t_s: t, device: "f1".into(), kind: DeviceEventKind::Fault { code: "F1_ERROR".into(), message: l } });
                    }
                }
            }
            Err(e) => ev.push(DeviceEvent { t_s: t, device: "f1".into(), kind: DeviceEventKind::Disconnected { reason: e.to_string() } }),
        }
        if self.in_program && self.acked >= self.sent && t - self.last_status_poll > 0.25 {
            self.last_status_poll = t;
            self.working = self.transport.working_state().ok().flatten();
        }
        self.sync_log();
        ev
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_log;

    #[test]
    fn default_gate_refuses_connection_and_writes() {
        let mut d = XToolF1Device::new(F1TransportConfig::default(), WriteGate::default(), shared_log());
        assert!(matches!(d.connect(), Err(CoreError::Safety(_))));
        assert!(matches!(d.send_program(&["G90".into()]), Err(CoreError::Safety(_))));
        assert!(matches!(d.machine_info(), Err(CoreError::Safety(_))));
        assert!(!d.capabilities().hardware_writes);
    }

    #[test]
    fn developer_mode_still_refuses_emission() {
        let gate = WriteGate { simulation_only: false, developer_mode: true, emission_validated: false };
        let mut d = XToolF1Device::new(F1TransportConfig::default(), gate, shared_log());
        d.set_emission_permitted(true);
        let r = d.send_program(&["$L".into(), "M3 S0".into(), "G1X1Y1S300F600".into(), "$P".into()]);
        assert!(matches!(r, Err(CoreError::Safety(m)) if m.contains("emission")));
    }
}
