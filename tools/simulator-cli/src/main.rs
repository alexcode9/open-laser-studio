//! `ols-sim`: run a project headlessly through the simulated machine (virtual F1 + virtual A/U
//! controller) using the same session/safety workflow as the desktop app, then export the
//! timeline. Nothing here can talk to real hardware.
//!
//! ```text
//! ols-sim [--project FILE.ols | --sample] [--mode flat|cylinder] [--speed-check]
//!         [--inject JSON]... [--csv OUT.csv] [--json OUT.json] [--max-s SECONDS]
//! ```
//!
//! `--inject` takes an injection as JSON, e.g.
//! `{"atS": 5.0, "kind": {"type": "axisFault", "code": "DRIVER"}}`.

use std::fmt::Write as _;
use std::process::ExitCode;

use laser_jobs::SimSession;
use laser_project::{Project, WorkspaceMode, load_ols, sample::sample_project};
use laser_simulator::{Injection, SimConfig, TimelineExport};

struct Args {
    project: Option<String>,
    mode: Option<WorkspaceMode>,
    injections: Vec<Injection>,
    csv: Option<String>,
    json: Option<String>,
    max_s: f64,
}

fn usage() -> &'static str {
    "usage: ols-sim [--project FILE.ols | --sample] [--mode flat|cylinder] [--inject JSON]... [--csv OUT.csv] [--json OUT.json] [--max-s SECONDS]"
}

fn parse_args() -> Result<Args, String> {
    let mut a = Args { project: None, mode: None, injections: Vec::new(), csv: None, json: None, max_s: 3600.0 };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut val = || it.next().ok_or_else(|| format!("{flag} needs a value"));
        match flag.as_str() {
            "--project" => a.project = Some(val()?),
            "--sample" => a.project = None,
            "--mode" => {
                a.mode = Some(match val()?.as_str() {
                    "flat" => WorkspaceMode::Flat,
                    "cylinder" => WorkspaceMode::Cylinder,
                    m => return Err(format!("unknown mode '{m}'")),
                })
            }
            "--inject" => a.injections.push(serde_json::from_str(&val()?).map_err(|e| format!("bad --inject JSON: {e}"))?),
            "--csv" => a.csv = Some(val()?),
            "--json" => a.json = Some(val()?),
            "--max-s" => a.max_s = val()?.parse().map_err(|_| "bad --max-s".to_string())?,
            "-h" | "--help" => return Err(usage().into()),
            other => return Err(format!("unknown argument '{other}'\n{}", usage())),
        }
    }
    Ok(a)
}

fn load(args: &Args) -> Result<Project, String> {
    let mut p = match &args.project {
        Some(path) => {
            let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
            load_ols(&bytes).map_err(|e| format!("{path}: {e}"))?.0
        }
        None => sample_project(),
    };
    if let Some(m) = args.mode {
        p.mode = m;
    }
    Ok(p)
}

fn to_csv(t: &TimelineExport) -> String {
    let mut s = String::from("t_s,gx_mm,gy_mm,a_deg,u_mm,laser,power_pct,state,section,segment\n");
    for i in 0..t.t.len() {
        let _ = writeln!(
            s,
            "{:.4},{:.4},{:.4},{:.5},{:.5},{},{:.1},{},{},{}",
            t.t[i], t.gx[i], t.gy[i], t.a[i], t.u[i], t.laser[i], t.power[i], t.state[i], t.section[i], t.segment[i]
        );
    }
    s
}

/// Advance the simulation until `done` returns true (bounded).
fn wait(s: &mut SimSession, limit_s: f64, done: impl Fn(&laser_jobs::SessionSnapshot) -> bool) -> bool {
    let mut t = 0.0;
    while t < limit_s {
        let snap = s.tick(0.05);
        if done(&snap) {
            return true;
        }
        t += 0.05;
    }
    false
}

fn run() -> Result<bool, String> {
    let args = parse_args()?;
    let project = load(&args)?;
    let cylinder = project.mode == WorkspaceMode::Cylinder;
    println!("project: {} ({:?})", project.name, project.mode);

    let mut s = SimSession::new(project, SimConfig::default());
    s.connect().map_err(|e| e.to_string())?;
    if !wait(&mut s, 5.0, |x| x.f1_connected && (!cylinder || x.axes_connected)) {
        return Err("simulated devices did not connect".into());
    }
    if cylinder {
        s.home().map_err(|e| e.to_string())?;
        if !wait(&mut s, 120.0, |x| x.axis_status.as_ref().is_some_and(|a| a.homed) && !x.homing) {
            return Err("homing did not complete".into());
        }
    }
    let report = s.prepare().map_err(|e| e.to_string())?;
    for w in &report.warnings {
        println!("warning: {w}");
    }
    if !report.ok {
        for e in &report.errors {
            println!("error: {e}");
        }
        return Err("prepare failed".into());
    }
    println!("prepared: {} unit(s), estimated {:.1} s", report.units, report.estimated_s);

    // Injections are scheduled relative to job start.
    let t0 = s.snapshot().t_s;
    for mut inj in args.injections {
        inj.at_s = inj.at_s.map(|t| t + t0);
        s.inject(inj);
    }
    s.arm(true).map_err(|e| e.to_string())?;
    s.start().map_err(|e| e.to_string())?;
    let snap = s.run_to_completion(args.max_s);

    let outcome = serde_json::to_string(&snap.outcome).unwrap_or_default();
    println!("state: {:?}", snap.safety_state);
    println!("outcome: {outcome}");
    if let Some(f) = &snap.last_fault {
        println!("fault: {f}");
    }
    for t in s.safety_history() {
        println!("  {:>9.3} s  {:?} -> {:?}  {}", t.t_s, t.from, t.to, t.event);
    }

    let tl = s.timeline_export(0, 0);
    println!("timeline: {} samples, {} events, {:.2} s", tl.t.len(), tl.events.len(), tl.duration_s);
    if let Some(path) = &args.csv {
        std::fs::write(path, to_csv(&tl)).map_err(|e| format!("{path}: {e}"))?;
        println!("wrote {path}");
    }
    if let Some(path) = &args.json {
        let v = serde_json::json!({ "outcome": snap.outcome, "events": tl.events, "jobLog": s.job_log(), "safety": s.safety_history() });
        std::fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default()).map_err(|e| format!("{path}: {e}"))?;
        println!("wrote {path}");
    }
    Ok(matches!(snap.outcome, Some(laser_jobs::JobOutcome::Completed { .. })))
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("{e}");
            ExitCode::from(2)
        }
    }
}
