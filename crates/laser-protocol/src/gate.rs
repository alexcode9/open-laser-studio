//! Write gate for real hardware. Every line sent to a real device passes through here.

use laser_core::{CoreError, Result};
use laser_gcode::{CommandClass, Dialect, classify, parse_line};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteGate {
    /// Default true: nothing is written to real hardware.
    pub simulation_only: bool,
    /// Explicit developer opt-in for real-device writes.
    pub developer_mode: bool,
    /// Laser emission on real hardware. Hard-wired false in Milestone 1: no emission command
    /// has been validated (see docs/research/F1_PROTOCOL.md §7).
    pub emission_validated: bool,
}

impl Default for WriteGate {
    fn default() -> Self {
        Self { simulation_only: true, developer_mode: false, emission_validated: false }
    }
}

/// Check that `lines` may be written to a real device in `dialect`.
pub fn check_lines(lines: &[String], dialect: &Dialect, gate: &WriteGate) -> Result<()> {
    if gate.simulation_only {
        return Err(CoreError::Safety("simulationOnly is enabled: real-device writes are disabled".into()));
    }
    if !gate.developer_mode {
        return Err(CoreError::Safety("real-device writes require developer mode".into()));
    }
    let mut modal_s = 0.0;
    for (i, l) in lines.iter().enumerate() {
        let b = parse_line(l, i + 1);
        match classify(&b, dialect, modal_s) {
            CommandClass::Unknown => {
                return Err(CoreError::Safety(format!("line {}: '{}' is not on the {} allowlist", i + 1, l, dialect.name)));
            }
            CommandClass::Emission if !gate.emission_validated => {
                return Err(CoreError::Safety(format!(
                    "line {}: '{}' would emit laser light; emission is not validated for real hardware",
                    i + 1,
                    l
                )));
            }
            _ => {}
        }
        if let Some(s) = b.param('S') {
            modal_s = s;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn default_gate_blocks_everything() {
        assert!(check_lines(&lines(&["G90"]), &Dialect::XTOOL_F1, &WriteGate::default()).is_err());
    }

    #[test]
    fn developer_mode_allows_laser_off_motion_only() {
        let g = WriteGate { simulation_only: false, developer_mode: true, emission_validated: false };
        assert!(check_lines(&lines(&["$L", "G90", "G0X10Y10", "G0 S0", "$P"]), &Dialect::XTOOL_F1, &g).is_ok());
        assert!(check_lines(&lines(&["G1X1Y1S100F600"]), &Dialect::XTOOL_F1, &g).is_err());
        assert!(check_lines(&lines(&["M3 S5"]), &Dialect::XTOOL_F1, &g).is_err());
        assert!(check_lines(&lines(&["M9999"]), &Dialect::XTOOL_F1, &g).is_err());
        // Modal power carried over from a previous S word.
        assert!(check_lines(&lines(&["G1 X1 S0", "S10", "G1 X2"]), &Dialect::XTOOL_F1, &g).is_err());
    }
}
