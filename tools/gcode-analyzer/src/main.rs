//! `ols-gcode`: offline G-code checker. Parses a file, validates it against a dialect
//! (default: the inferred xTool F1 dialect) and prints bounds, distances and a time estimate.
//! It never sends anything to a device.
//!
//! ```text
//! ols-gcode FILE [--dialect xtool-f1|generic] [--json] [--feed MM_PER_MIN]
//! ```
//! Exit status: 0 = no errors, 1 = errors found, 2 = usage / IO error.

use std::process::ExitCode;

use laser_gcode::{Dialect, Severity, analyze, parse, validate};

fn main() -> ExitCode {
    let mut file = None;
    let mut dialect = Dialect::XTOOL_F1;
    let mut json = false;
    let mut feed = 3000.0 * 60.0;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--dialect" => match it.next().as_deref() {
                Some("xtool-f1") => dialect = Dialect::XTOOL_F1,
                Some("generic") => dialect = Dialect::GENERIC,
                other => {
                    eprintln!("unknown dialect {other:?}");
                    return ExitCode::from(2);
                }
            },
            "--json" => json = true,
            "--feed" => match it.next().and_then(|v| v.parse().ok()) {
                Some(v) => feed = v,
                None => {
                    eprintln!("--feed needs a number (mm/min)");
                    return ExitCode::from(2);
                }
            },
            "-h" | "--help" => {
                println!("usage: ols-gcode FILE [--dialect xtool-f1|generic] [--json] [--feed MM_PER_MIN]");
                return ExitCode::SUCCESS;
            }
            f => file = Some(f.to_string()),
        }
    }
    let Some(path) = file else {
        eprintln!("usage: ols-gcode FILE [--dialect xtool-f1|generic] [--json] [--feed MM_PER_MIN]");
        return ExitCode::from(2);
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{path}: {e}");
            return ExitCode::from(2);
        }
    };

    let blocks = parse(&text);
    let analysis = analyze(&blocks, &dialect, feed);
    let diags = validate(&blocks, &dialect);
    let errors = diags.iter().filter(|d| d.severity == Severity::Error).count();

    if json {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({ "dialect": dialect.name, "analysis": analysis, "diagnostics": diags })).unwrap_or_default());
    } else {
        println!("{path} ({} dialect)", dialect.name);
        println!("  lines            {}", analysis.lines);
        println!("  motion blocks    {}", analysis.motion_blocks);
        println!("  mark distance    {:.2} mm", analysis.mark_distance_mm);
        println!("  travel distance  {:.2} mm", analysis.travel_distance_mm);
        println!("  estimated time   {:.1} s", analysis.estimated_time_s);
        if analysis.min_x.is_finite() {
            println!("  bounds           X {:.2}..{:.2}  Y {:.2}..{:.2} mm", analysis.min_x, analysis.max_x, analysis.min_y, analysis.max_y);
        }
        let mut infos = 0;
        for d in &diags {
            if d.severity == Severity::Info {
                infos += 1;
            } else {
                println!("  {:?} line {}: {}", d.severity, d.line_no, d.message);
            }
        }
        let warnings = diags.len() - errors - infos;
        println!("  {errors} error(s), {warnings} warning(s), {infos} info note(s) (use --json for all)");
    }
    if errors > 0 { ExitCode::from(1) } else { ExitCode::SUCCESS }
}
