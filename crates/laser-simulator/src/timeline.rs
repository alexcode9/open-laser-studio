use laser_core::{CylinderSpec, MachinePosition, SafetyState};
use laser_geometry::CylinderTransform;
use laser_project::WorkspaceMode;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub t_s: f64,
    pub pos: MachinePosition,
    pub laser_on: bool,
    pub power_pct: f64,
    pub state: SafetyState,
    pub section: i32,
    pub segment: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub t_s: f64,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct Timeline {
    pub samples: Vec<Sample>,
    pub events: Vec<TimelineEvent>,
}

pub fn state_code(s: SafetyState) -> f64 {
    match s {
        SafetyState::Disconnected => 0.0,
        SafetyState::Connected => 1.0,
        SafetyState::Idle => 2.0,
        SafetyState::Preparing => 3.0,
        SafetyState::Ready => 4.0,
        SafetyState::Armed => 5.0,
        SafetyState::Running => 6.0,
        SafetyState::Paused => 7.0,
        SafetyState::Stopping => 8.0,
        SafetyState::Fault => 9.0,
        SafetyState::Estop => 10.0,
    }
}

/// Column-oriented timeline for the UI. Includes the cylinder pose and the laser spot in the
/// cylinder-local frame so the renderer performs no coordinate math.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineExport {
    pub t: Vec<f64>,
    pub gx: Vec<f64>,
    pub gy: Vec<f64>,
    pub a: Vec<f64>,
    pub u: Vec<f64>,
    pub laser: Vec<f64>,
    pub power: Vec<f64>,
    pub state: Vec<f64>,
    pub section: Vec<f64>,
    pub segment: Vec<f64>,
    pub rot_x: Vec<f64>,
    pub tx: Vec<f64>,
    pub spot_x: Vec<f64>,
    pub spot_y: Vec<f64>,
    pub spot_z: Vec<f64>,
    pub events: Vec<TimelineEvent>,
    pub duration_s: f64,
}

impl Timeline {
    pub fn push(&mut self, s: Sample) {
        self.samples.push(s);
    }

    pub fn event(&mut self, t_s: f64, kind: &str, message: impl Into<String>) {
        self.events.push(TimelineEvent { t_s, kind: kind.into(), message: message.into() });
    }

    pub fn duration(&self) -> f64 {
        self.samples.last().map(|s| s.t_s).unwrap_or(0.0)
    }

    /// Export samples `[from..]` and events after `events_from`.
    pub fn export(
        &self,
        from: usize,
        events_from: usize,
        mode: WorkspaceMode,
        workpiece: &CylinderSpec,
        galvo_center: (f64, f64),
        invert: (bool, bool),
    ) -> TimelineExport {
        let cyl = CylinderTransform::new(*workpiece);
        let (cx, cy) = galvo_center;
        let sx = if invert.0 { -1.0 } else { 1.0 };
        let sy = if invert.1 { -1.0 } else { 1.0 };
        let mut e = TimelineExport::default();
        for s in self.samples.iter().skip(from) {
            let p = s.pos;
            e.t.push(s.t_s);
            e.gx.push(p.gx_mm);
            e.gy.push(p.gy_mm);
            e.a.push(p.a_deg);
            e.u.push(p.u_mm);
            e.laser.push(if s.laser_on { 1.0 } else { 0.0 });
            e.power.push(s.power_pct);
            e.state.push(state_code(s.state));
            e.section.push(f64::from(s.section));
            e.segment.push(f64::from(s.segment));
            match mode {
                WorkspaceMode::Cylinder => {
                    let pose = cyl.pose(p.a_deg, p.u_mm);
                    e.rot_x.push(pose.rotation_x_rad);
                    e.tx.push(pose.translation_x_mm);
                    // Surface point under the spot: section center + galvo offset.
                    let u = cyl.machine_u_to_u(p.u_mm) + sx * (p.gx_mm - cx);
                    let sv = cyl.a_deg_to_s(p.a_deg) + cyl.galvo_offset_to_arc(sy * (p.gy_mm - cy));
                    let l = cyl.surface_to_local(u, sv);
                    e.spot_x.push(l[0]);
                    e.spot_y.push(l[1]);
                    e.spot_z.push(l[2]);
                }
                WorkspaceMode::Flat => {
                    e.rot_x.push(0.0);
                    e.tx.push(0.0);
                    e.spot_x.push(p.gx_mm - cx);
                    e.spot_y.push(0.0);
                    e.spot_z.push(p.gy_mm - cy);
                }
            }
        }
        e.events = self.events.iter().skip(events_from).cloned().collect();
        e.duration_s = self.duration();
        e
    }
}
