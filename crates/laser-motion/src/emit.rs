//! xTool F1 (V1 firmware) G-code emitter. Session sequence follows BeamInk (see
//! `docs/research/PROTOCOL_EVIDENCE.md` E-004). Emitted text is for inspection and for the
//! simulator; real transmission is gated by the safety layer.

use laser_core::LaserSource;
use laser_gcode::fmt_num;
use serde::Serialize;

use crate::segment::{SegmentKind, SyncKind, Toolpath};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct F1Program {
    /// One G-code program per F1 execution unit (one for flat, one per indexed section).
    pub sections: Vec<Vec<String>>,
    /// Human-readable full listing including external-axis comments.
    pub listing: Vec<String>,
    pub supported: bool,
}

fn source_cmd(s: LaserSource) -> &'static str {
    match s {
        LaserSource::Blue => "M114 S1",
        LaserSource::Ir => "M114 S2",
    }
}

/// Power percent → F1 `S` value (0..1000). DOCUMENTED by BeamInk usage (E-005).
pub fn power_to_s(power_pct: f64) -> u32 {
    (power_pct.clamp(0.0, 100.0) * 10.0).round() as u32
}

pub fn session_start(travel_mm_s: f64, source: LaserSource) -> Vec<String> {
    let f = fmt_num(travel_mm_s * 60.0);
    vec![
        "$L".into(),
        format!("G0 F{f}"),
        "M3 S0".into(),
        format!("G1 F{f}"),
        source_cmd(source).into(),
        "G21".into(),
        "G90".into(),
    ]
}

pub fn session_end(travel_mm_s: f64) -> Vec<String> {
    let f = fmt_num(travel_mm_s * 60.0);
    vec!["G90".into(), "G0 S0".into(), format!("G0 F{f}"), format!("G1 F{f}"), "M6 P1".into(), "$P".into()]
}

pub fn emit_f1(tp: &Toolpath, travel_mm_s: f64) -> F1Program {
    let mut listing = Vec::new();
    if tp.segments.iter().any(|s| s.sync == SyncKind::Coupled) {
        listing.push("; Coupled strategy cannot be expressed as F1 G-code.".into());
        listing.push("; External axes would have to move during emission (simulation only).".into());
        return F1Program { sections: Vec::new(), listing, supported: false };
    }
    let mut sections: Vec<Vec<String>> = Vec::new();
    let mut current: Option<Vec<String>> = None;
    let mut source = None;
    let mut feed: Option<f64> = None;
    let mut marking = false;

    let close = |cur: &mut Option<Vec<String>>, sections: &mut Vec<Vec<String>>, listing: &mut Vec<String>| {
        if let Some(mut lines) = cur.take() {
            lines.extend(session_end(travel_mm_s));
            listing.extend(lines.iter().cloned());
            sections.push(lines);
        }
    };

    for s in &tp.segments {
        if s.kind == SegmentKind::Barrier {
            close(&mut current, &mut sections, &mut listing);
            listing.push(format!(
                "; ---- external move (motion controller): A={} U={} — wait for completion, verify, settle ----",
                fmt_num(s.end.a_deg),
                fmt_num(s.end.u_mm)
            ));
            continue;
        }
        let lines = current.get_or_insert_with(|| {
            source = Some(s.source);
            feed = None;
            marking = false;
            let mut l = Vec::new();
            if s.section >= 0 {
                l.push(format!("; section {}", s.section));
            }
            l.extend(session_start(travel_mm_s, s.source));
            l
        });
        if source != Some(s.source) {
            lines.push(source_cmd(s.source).into());
            source = Some(s.source);
        }
        match s.kind {
            SegmentKind::Mark if s.laser_on => {
                let f = s.speed_mm_s * 60.0;
                let mut line = format!(
                    "G1X{}Y{}S{}",
                    fmt_num(s.end.gx_mm),
                    fmt_num(s.end.gy_mm),
                    power_to_s(s.power_pct)
                );
                if feed.is_none_or(|old| (old - f).abs() > 1e-9) {
                    line.push_str(&format!("F{}", fmt_num(f)));
                    feed = Some(f);
                }
                lines.push(line);
                marking = true;
            }
            SegmentKind::Travel | SegmentKind::Mark => {
                if marking {
                    lines.push("G0 S0".into());
                    marking = false;
                }
                lines.push(format!("G0X{}Y{}", fmt_num(s.end.gx_mm), fmt_num(s.end.gy_mm)));
            }
            SegmentKind::Dwell | SegmentKind::Barrier => {}
        }
    }
    close(&mut current, &mut sections, &mut listing);
    F1Program { sections, listing, supported: true }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan;
    use laser_gcode::{Dialect, Severity, parse, validate};
    use laser_project::sample::sample_project;

    #[test]
    fn indexed_program_has_one_unit_per_section_and_validates() {
        let p = sample_project();
        let tp = plan(&p);
        let prog = emit_f1(&tp, p.machine.galvo.max_travel_speed_mm_s);
        assert!(prog.supported);
        assert_eq!(prog.sections.len(), tp.sections.len());
        for sec in &prog.sections {
            let diags = validate(&parse(&sec.join("\n")), &Dialect::XTOOL_F1);
            let errs: Vec<_> = diags.iter().filter(|d| d.severity == Severity::Error).collect();
            assert!(errs.is_empty(), "{errs:?}");
            assert_eq!(sec.iter().filter(|l| l.as_str() == "$L").count(), 1);
            assert_eq!(sec.last().map(String::as_str), Some("$P"));
        }
    }

    #[test]
    fn power_scale() {
        assert_eq!(power_to_s(0.0), 0);
        assert_eq!(power_to_s(25.0), 250);
        assert_eq!(power_to_s(150.0), 1000);
    }
}
