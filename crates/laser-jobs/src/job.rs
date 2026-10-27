use laser_core::{CoreError, Result};
use laser_motion::{F1Program, SegmentKind, Toolpath};
use laser_project::WorkspaceMode;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobUnit {
    pub index: usize,
    /// External axis target `(A deg, U mm)`; `None` for flat jobs.
    pub target: Option<(f64, f64)>,
    pub program: Vec<String>,
    pub estimated_s: f64,
    pub external_move_s: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub mode: WorkspaceMode,
    pub units: Vec<JobUnit>,
    pub estimated_s: f64,
}

impl Job {
    pub fn from_toolpath(tp: &Toolpath, program: &F1Program) -> Result<Job> {
        if tp.simulation_only || !program.supported {
            return Err(CoreError::Unsupported(
                "this strategy is simulation-only (preview with the kinematic timeline)".into(),
            ));
        }
        if !tp.errors.is_empty() {
            return Err(CoreError::InvalidArgument(tp.errors.join("; ")));
        }
        if tp.segments.is_empty() {
            return Err(CoreError::InvalidArgument("toolpath is empty".into()));
        }
        let mut units = Vec::new();
        match tp.mode {
            WorkspaceMode::Flat => {
                let prog = program.sections.first().cloned().unwrap_or_default();
                let est = tp.segments.iter().map(|s| s.duration_s).sum();
                units.push(JobUnit { index: 0, target: None, program: prog, estimated_s: est, external_move_s: 0.0 });
            }
            WorkspaceMode::Cylinder => {
                if program.sections.len() != tp.sections.len() {
                    return Err(CoreError::InvalidArgument(format!(
                        "program has {} units but toolpath has {} sections",
                        program.sections.len(),
                        tp.sections.len()
                    )));
                }
                for (i, sec) in tp.sections.iter().enumerate() {
                    let segs = &tp.segments[sec.first_segment..sec.first_segment + sec.segment_count];
                    let est = segs.iter().filter(|s| s.kind != SegmentKind::Barrier).map(|s| s.duration_s).sum();
                    let ext = sec
                        .first_segment
                        .checked_sub(1)
                        .map(|i| &tp.segments[i])
                        .filter(|s| s.kind == SegmentKind::Barrier)
                        .map_or(0.0, |s| s.duration_s);
                    units.push(JobUnit {
                        index: i,
                        target: Some((sec.a_deg, sec.machine_u_mm)),
                        program: program.sections[i].clone(),
                        estimated_s: est,
                        external_move_s: ext,
                    });
                }
            }
        }
        let estimated_s = units.iter().map(|u| u.estimated_s + u.external_move_s).sum();
        Ok(Job { mode: tp.mode, units, estimated_s })
    }
}
