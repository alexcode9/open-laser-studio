//! Machine dialects: allowlists and command classification.

use serde::Serialize;

use crate::ir::{Command, interpret};
use crate::parser::Block;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandClass {
    /// Moves with the laser guaranteed off.
    Motion,
    /// Anything that can emit laser light (G1/G2/G3 with S > 0, M3/M4 with S > 0, mode change
    /// followed by marking).
    Emission,
    /// Explicitly turns the laser off.
    LaserOff,
    /// Units, positioning modes, feed, source selection.
    Config,
    /// Session control (`$L`, `$P`, `G100`, `G101`, ...).
    Session,
    /// Not on the dialect allowlist / not understood.
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub line_no: usize,
    pub severity: Severity,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct Dialect {
    pub name: &'static str,
    pub g_codes: &'static [f64],
    pub m_codes: &'static [f64],
    pub specials: &'static [&'static str],
    /// Axis letters accepted in motion words.
    pub axes: &'static [char],
}

impl Dialect {
    /// xTool F1 legacy (V1 firmware) dialect, from BeamInk and xTool support articles.
    /// See `docs/research/F1_PROTOCOL.md`.
    pub const XTOOL_F1: Dialect = Dialect {
        name: "xtool-f1-v1",
        g_codes: &[0.0, 1.0, 21.0, 90.0, 91.0, 100.0, 101.0],
        m_codes: &[3.0, 4.0, 5.0, 6.0, 114.0, 116.0],
        specials: &["L", "P"],
        axes: &['X', 'Y'],
    };

    /// Generic GRBL-like dialect used for analysis of imported files.
    pub const GENERIC: Dialect = Dialect {
        name: "generic",
        g_codes: &[0.0, 1.0, 2.0, 3.0, 4.0, 20.0, 21.0, 90.0, 91.0, 92.0],
        m_codes: &[3.0, 4.0, 5.0],
        specials: &[],
        axes: &['X', 'Y', 'Z', 'A', 'U'],
    };

    fn allows_g(&self, g: f64) -> bool {
        self.g_codes.iter().any(|c| (c - g).abs() < 1e-9)
    }

    fn allows_m(&self, m: f64) -> bool {
        self.m_codes.iter().any(|c| (c - m).abs() < 1e-9)
    }
}

fn positive(s: Option<f64>) -> bool {
    s.is_some_and(|v| v > 0.0)
}

/// Classify a block in isolation. `laser_power_modal` is the S value currently in effect,
/// needed because `G1 X..` without S inherits the modal power.
pub fn classify(block: &Block, dialect: &Dialect, laser_power_modal: f64) -> CommandClass {
    if !block.errors.is_empty() {
        return CommandClass::Unknown;
    }
    let cmds = interpret(block);
    let mut class = CommandClass::Config;
    for c in &cmds {
        let this = match c {
            Command::Rapid { s, .. } => {
                if positive(*s) { CommandClass::Unknown } else if *s == Some(0.0) { CommandClass::LaserOff } else { CommandClass::Motion }
            }
            Command::Linear { s, .. } | Command::Arc { s, .. } => {
                if positive(*s) || (s.is_none() && laser_power_modal > 0.0) {
                    CommandClass::Emission
                } else {
                    CommandClass::Motion
                }
            }
            Command::LaserConstant { s } | Command::LaserDynamic { s } => {
                if *s > 0.0 { CommandClass::Emission } else { CommandClass::Config }
            }
            Command::LaserOff => CommandClass::LaserOff,
            Command::Modal { s, .. } => {
                if positive(*s) { CommandClass::Emission } else if *s == Some(0.0) { CommandClass::LaserOff } else { CommandClass::Config }
            }
            Command::Absolute | Command::Relative | Command::Millimeters | Command::Inches => CommandClass::Config,
            Command::Dwell { .. } | Command::SetPosition { .. } => CommandClass::Motion,
            Command::GCode { code, .. } => {
                if dialect.allows_g(*code) { CommandClass::Session } else { CommandClass::Unknown }
            }
            Command::MCode { code, .. } => {
                if !dialect.allows_m(*code) { CommandClass::Unknown } else if (*code - 114.0).abs() < 1e-9 { CommandClass::Config } else { CommandClass::Session }
            }
            Command::Special { name } => {
                if dialect.specials.contains(&name.as_str()) { CommandClass::Session } else { CommandClass::Unknown }
            }
            Command::Unknown { .. } => CommandClass::Unknown,
        };
        class = worst(class, this);
    }
    // Generic codes must still be on the dialect allowlist.
    for code in &block.codes {
        let ok = match code {
            crate::Code::G(g) => dialect.allows_g(*g),
            crate::Code::M(m) => dialect.allows_m(*m),
            crate::Code::Dollar(s) => dialect.specials.contains(&s.as_str()),
        };
        if !ok {
            return CommandClass::Unknown;
        }
    }
    class
}

fn rank(c: CommandClass) -> u8 {
    match c {
        CommandClass::Config => 0,
        CommandClass::LaserOff => 1,
        CommandClass::Session => 2,
        CommandClass::Motion => 3,
        CommandClass::Emission => 4,
        CommandClass::Unknown => 5,
    }
}

fn worst(a: CommandClass, b: CommandClass) -> CommandClass {
    if rank(b) > rank(a) { b } else { a }
}

/// Validate a full program against a dialect.
pub fn validate(blocks: &[Block], dialect: &Dialect) -> Vec<Diagnostic> {
    let mut diags = Vec::new();
    let mut modal_s = 0.0;
    for b in blocks {
        for e in &b.errors {
            diags.push(Diagnostic { line_no: b.line_no, severity: Severity::Error, message: e.clone() });
        }
        if b.is_empty() {
            continue;
        }
        for (letter, _) in &b.params {
            let is_axis = matches!(letter, 'X' | 'Y' | 'Z' | 'A' | 'B' | 'U');
            let is_m116 = b.codes.iter().any(|c| matches!(c, crate::Code::M(m) if (*m - 116.0).abs() < 1e-9));
            if is_axis && !is_m116 && !dialect.axes.contains(letter) {
                diags.push(Diagnostic {
                    line_no: b.line_no,
                    severity: Severity::Warning,
                    message: format!("axis '{letter}' is not supported by dialect {}", dialect.name),
                });
            }
        }
        let class = classify(b, dialect, modal_s);
        match class {
            CommandClass::Unknown => diags.push(Diagnostic {
                line_no: b.line_no,
                severity: Severity::Error,
                message: format!("not allowed / not understood by dialect {}: '{}'", dialect.name, b.raw),
            }),
            CommandClass::Emission => diags.push(Diagnostic {
                line_no: b.line_no,
                severity: Severity::Info,
                message: "laser emission".into(),
            }),
            _ => {}
        }
        if let Some(s) = b.param('S') {
            modal_s = s;
        }
    }
    diags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse, parse_line};

    #[test]
    fn classification() {
        let d = &Dialect::XTOOL_F1;
        assert_eq!(classify(&parse_line("G0X1Y1", 1), d, 0.0), CommandClass::Motion);
        assert_eq!(classify(&parse_line("G1X1Y1S0F600", 1), d, 0.0), CommandClass::Motion);
        assert_eq!(classify(&parse_line("G1X1Y1S500F600", 1), d, 0.0), CommandClass::Emission);
        assert_eq!(classify(&parse_line("G1X1Y1", 1), d, 300.0), CommandClass::Emission);
        assert_eq!(classify(&parse_line("G0 S0", 1), d, 0.0), CommandClass::LaserOff);
        assert_eq!(classify(&parse_line("M114 S2", 1), d, 0.0), CommandClass::Config);
        assert_eq!(classify(&parse_line("$L", 1), d, 0.0), CommandClass::Session);
        assert_eq!(classify(&parse_line("M116A2B-4", 1), d, 0.0), CommandClass::Session);
        assert_eq!(classify(&parse_line("M999", 1), d, 0.0), CommandClass::Unknown);
        assert_eq!(classify(&parse_line("G2 X1 Y1 I1 J0", 1), d, 0.0), CommandClass::Unknown);
        assert_eq!(classify(&parse_line("$H", 1), d, 0.0), CommandClass::Unknown);
        assert_eq!(classify(&parse_line("M3 S10", 1), d, 0.0), CommandClass::Emission);
    }

    #[test]
    fn rapid_with_power_is_rejected() {
        assert_eq!(classify(&parse_line("G0 X1 S500", 1), &Dialect::XTOOL_F1, 0.0), CommandClass::Unknown);
    }

    #[test]
    fn validate_program() {
        let prog = parse("$L\nG90\nG0X1Y1\nG1X2Y2S100F600\nZ5\nM777\n$P");
        let d = validate(&prog, &Dialect::XTOOL_F1);
        assert_eq!(d.iter().filter(|d| d.severity == Severity::Error).count(), 2);
        assert_eq!(d.iter().filter(|d| d.severity == Severity::Info).count(), 1);
    }
}
