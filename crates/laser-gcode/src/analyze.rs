use serde::Serialize;

use crate::dialect::{Dialect, Severity, validate};
use crate::ir::{Command, interpret};
use crate::parser::Block;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub lines: usize,
    pub motion_blocks: usize,
    pub mark_distance_mm: f64,
    pub travel_distance_mm: f64,
    pub estimated_time_s: f64,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub errors: usize,
    pub warnings: usize,
    pub unknown_lines: Vec<usize>,
}

/// Coordinate analyzer. Feed `F` is interpreted as mm/min (INFERRED for the F1).
pub fn analyze(blocks: &[Block], dialect: &Dialect, default_feed_mm_min: f64) -> Analysis {
    let mut a = Analysis {
        lines: blocks.len(),
        min_x: f64::INFINITY,
        min_y: f64::INFINITY,
        max_x: f64::NEG_INFINITY,
        max_y: f64::NEG_INFINITY,
        ..Default::default()
    };
    let (mut x, mut y) = (0.0_f64, 0.0_f64);
    let mut absolute = true;
    let mut feed = default_feed_mm_min.max(1.0);
    let mut power = 0.0_f64;
    for b in blocks {
        for c in interpret(b) {
            let (nx, ny, f, s, laser_capable) = match c {
                Command::Rapid { x: cx, y: cy, f, s, .. } => (cx, cy, f, s, false),
                Command::Linear { x: cx, y: cy, f, s, .. } => (cx, cy, f, s, true),
                Command::Absolute => {
                    absolute = true;
                    continue;
                }
                Command::Relative => {
                    absolute = false;
                    continue;
                }
                Command::Modal { f, s } => {
                    if let Some(f) = f { feed = f.max(1.0); }
                    if let Some(s) = s { power = s; }
                    continue;
                }
                Command::Unknown { .. } => {
                    a.unknown_lines.push(b.line_no);
                    continue;
                }
                _ => continue,
            };
            if let Some(f) = f { feed = f.max(1.0); }
            if let Some(s) = s { power = s; }
            let tx = nx.map(|v| if absolute { v } else { x + v }).unwrap_or(x);
            let ty = ny.map(|v| if absolute { v } else { y + v }).unwrap_or(y);
            let d = (tx - x).hypot(ty - y);
            if laser_capable && power > 0.0 {
                a.mark_distance_mm += d;
            } else {
                a.travel_distance_mm += d;
            }
            a.estimated_time_s += d / (feed / 60.0);
            a.motion_blocks += 1;
            x = tx;
            y = ty;
            a.min_x = a.min_x.min(x);
            a.min_y = a.min_y.min(y);
            a.max_x = a.max_x.max(x);
            a.max_y = a.max_y.max(y);
        }
    }
    for d in validate(blocks, dialect) {
        match d.severity {
            Severity::Error => a.errors += 1,
            Severity::Warning => a.warnings += 1,
            Severity::Info => {}
        }
    }
    if a.motion_blocks == 0 {
        a.min_x = 0.0;
        a.min_y = 0.0;
        a.max_x = 0.0;
        a.max_y = 0.0;
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse;

    #[test]
    fn distances_and_bounds() {
        let p = parse("G90\nG0X0Y0\nG1X10Y0S500F600\nG0X10Y10\nG91\nG1X-5Y0S0");
        let a = analyze(&p, &Dialect::XTOOL_F1, 600.0);
        assert_eq!(a.mark_distance_mm, 10.0);
        assert_eq!(a.travel_distance_mm, 15.0);
        assert_eq!((a.min_x, a.max_x, a.max_y), (0.0, 10.0, 10.0));
        assert!((a.estimated_time_s - 2.5).abs() < 1e-9);
    }
}
