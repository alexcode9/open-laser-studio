use serde::Serialize;

use crate::parser::{Block, Code};

/// Interpreted command. Coordinates are as written (not yet resolved against modal state).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    Rapid { x: Option<f64>, y: Option<f64>, z: Option<f64>, u: Option<f64>, a: Option<f64>, f: Option<f64>, s: Option<f64> },
    Linear { x: Option<f64>, y: Option<f64>, z: Option<f64>, u: Option<f64>, a: Option<f64>, f: Option<f64>, s: Option<f64> },
    Arc { clockwise: bool, x: Option<f64>, y: Option<f64>, i: f64, j: f64, f: Option<f64>, s: Option<f64> },
    Dwell { seconds: f64 },
    Absolute,
    Relative,
    Millimeters,
    Inches,
    SetPosition { x: Option<f64>, y: Option<f64>, u: Option<f64>, a: Option<f64> },
    LaserConstant { s: f64 },
    LaserDynamic { s: f64 },
    LaserOff,
    /// Parameter-only line such as `S0` or `F1200`.
    Modal { f: Option<f64>, s: Option<f64> },
    /// Any M-code without generic semantics (dialect decides).
    MCode { code: f64, params: Vec<(char, f64)> },
    /// Any G-code without generic semantics (dialect decides).
    GCode { code: f64, params: Vec<(char, f64)> },
    Special { name: String },
    /// Preserved unknown content. Never interpreted as motion.
    Unknown { raw: String },
}

fn near(v: f64, c: f64) -> bool {
    (v - c).abs() < 1e-9
}

pub fn interpret(block: &Block) -> Vec<Command> {
    if !block.errors.is_empty() {
        return vec![Command::Unknown { raw: block.raw.clone() }];
    }
    let p = |c: char| block.param(c);
    let mut out = Vec::new();
    let mut had_motion = false;
    for code in &block.codes {
        match code {
            Code::G(g) if near(*g, 0.0) => {
                had_motion = true;
                out.push(Command::Rapid { x: p('X'), y: p('Y'), z: p('Z'), u: p('U'), a: p('A'), f: p('F'), s: p('S') });
            }
            Code::G(g) if near(*g, 1.0) => {
                had_motion = true;
                out.push(Command::Linear { x: p('X'), y: p('Y'), z: p('Z'), u: p('U'), a: p('A'), f: p('F'), s: p('S') });
            }
            Code::G(g) if near(*g, 2.0) || near(*g, 3.0) => {
                had_motion = true;
                match (p('I'), p('J')) {
                    (Some(i), Some(j)) => out.push(Command::Arc { clockwise: near(*g, 2.0), x: p('X'), y: p('Y'), i, j, f: p('F'), s: p('S') }),
                    _ => out.push(Command::Unknown { raw: block.raw.clone() }),
                }
            }
            Code::G(g) if near(*g, 4.0) => {
                out.push(Command::Dwell { seconds: p('P').map(|ms| ms / 1000.0).or(p('S')).unwrap_or(0.0) })
            }
            Code::G(g) if near(*g, 20.0) => out.push(Command::Inches),
            Code::G(g) if near(*g, 21.0) => out.push(Command::Millimeters),
            Code::G(g) if near(*g, 90.0) => out.push(Command::Absolute),
            Code::G(g) if near(*g, 91.0) => out.push(Command::Relative),
            Code::G(g) if near(*g, 92.0) => {
                had_motion = true;
                out.push(Command::SetPosition { x: p('X'), y: p('Y'), u: p('U'), a: p('A') })
            }
            Code::G(g) => {
                had_motion = true;
                out.push(Command::GCode { code: *g, params: block.params.clone() })
            }
            Code::M(m) if near(*m, 3.0) => out.push(Command::LaserConstant { s: p('S').unwrap_or(0.0) }),
            Code::M(m) if near(*m, 4.0) => out.push(Command::LaserDynamic { s: p('S').unwrap_or(0.0) }),
            Code::M(m) if near(*m, 5.0) => out.push(Command::LaserOff),
            Code::M(m) => {
                had_motion = true;
                out.push(Command::MCode { code: *m, params: block.params.clone() })
            }
            Code::Dollar(name) => out.push(Command::Special { name: name.clone() }),
        }
    }
    if !had_motion && !block.params.is_empty() {
        let only_fs = block.params.iter().all(|(l, _)| *l == 'F' || *l == 'S');
        let laser_mode = out.iter().any(|c| matches!(c, Command::LaserConstant { .. } | Command::LaserDynamic { .. }));
        if only_fs && !laser_mode {
            out.push(Command::Modal { f: p('F'), s: p('S') });
        } else if !only_fs {
            // Coordinates without a motion code: refuse to guess (no implicit modal motion).
            out.push(Command::Unknown { raw: block.raw.clone() });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_line;

    #[test]
    fn interprets_motion_and_modes() {
        let c = interpret(&parse_line("G1X1Y2S300F600", 1));
        assert!(matches!(c[0], Command::Linear { x: Some(1.0), s: Some(300.0), .. }));
        let c = interpret(&parse_line("G90", 1));
        assert_eq!(c, vec![Command::Absolute]);
        let c = interpret(&parse_line("M3 S0", 1));
        assert_eq!(c, vec![Command::LaserConstant { s: 0.0 }]);
    }

    #[test]
    fn coordinates_without_motion_code_are_unknown() {
        let c = interpret(&parse_line("X10 Y10", 1));
        assert!(matches!(c[0], Command::Unknown { .. }));
    }

    #[test]
    fn unknown_codes_preserved() {
        let c = interpret(&parse_line("G100", 1));
        assert!(matches!(c[0], Command::GCode { code, .. } if code == 100.0));
        let c = interpret(&parse_line("M116A2B-4", 1));
        assert!(matches!(&c[0], Command::MCode { code, params } if *code == 116.0 && params.len() == 2));
    }

    #[test]
    fn parameter_only_line() {
        assert_eq!(interpret(&parse_line("S0", 1)), vec![Command::Modal { f: None, s: Some(0.0) }]);
    }
}
