use laser_core::{LaserSource, MachinePosition};
use laser_geometry::Bounds;
use laser_project::{CylinderStrategy, WorkspaceMode};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SegmentKind {
    Travel,
    Mark,
    Dwell,
    /// External-axis repositioning between sections; laser guaranteed off.
    Barrier,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncKind {
    /// Galvo-only motion; external axes stationary.
    None,
    /// Must complete (and be verified) before the next segment starts.
    Barrier,
    /// Requires simultaneous external-axis motion (experimental).
    Coupled,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionSegment {
    pub start: MachinePosition,
    pub end: MachinePosition,
    pub kind: SegmentKind,
    pub sync: SyncKind,
    pub laser_on: bool,
    pub power_pct: f64,
    /// Galvo speed for galvo segments, surface speed for coupled segments (mm/s).
    pub speed_mm_s: f64,
    pub duration_s: f64,
    pub layer: u32,
    /// Section index (indexed strategy), -1 otherwise.
    pub section: i32,
    pub source: LaserSource,
    /// Surface coordinates `[u0, s0, u1, s1]` in cylinder mode.
    pub surface: Option<[f64; 4]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub index: u32,
    pub u_center_mm: f64,
    pub s_center_mm: f64,
    pub a_deg: f64,
    pub machine_u_mm: f64,
    /// Surface region covered by this section (x = u, y = s).
    pub surface_bounds: Bounds,
    pub first_segment: usize,
    pub segment_count: usize,
    pub max_focus_error_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolpathStats {
    pub segment_count: usize,
    pub mark_length_mm: f64,
    pub travel_length_mm: f64,
    pub estimated_time_s: f64,
    pub section_count: usize,
    pub galvo_bounds: Option<Bounds>,
    pub a_range_deg: Option<[f64; 2]>,
    pub u_range_mm: Option<[f64; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toolpath {
    pub mode: WorkspaceMode,
    pub strategy: Option<CylinderStrategy>,
    pub segments: Vec<MotionSegment>,
    pub sections: Vec<Section>,
    pub stats: ToolpathStats,
    pub warnings: Vec<String>,
    /// Blocking problems (bounds violations). A toolpath with errors must not be executed.
    pub errors: Vec<String>,
    /// True for strategies that may only run in simulation.
    pub simulation_only: bool,
}

impl Toolpath {
    pub fn is_executable(&self) -> bool {
        self.errors.is_empty() && !self.segments.is_empty()
    }
}
