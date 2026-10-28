//! Persisted CAD workspace: imported model references, saved measurements and the CAD-derived
//! workpiece binding. Mirrors `packages/shared-types/src/cad.ts` (camelCase JSON).
//!
//! CAD source files are stored verbatim in the `.ols` container under `cad/<sha256>.<ext>` and
//! re-analysed on load; derived data (tessellation, topology tables) is never persisted, so a
//! project stays valid across kernel versions. Absolute file paths are never stored.

use std::collections::BTreeMap;

use laser_geometry::Mat4;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type Vec3 = [f64; 3];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum GeometrySourceType {
    #[default]
    Step,
    Stl,
    #[serde(rename = "3mf")]
    ThreeMf,
}

impl GeometrySourceType {
    pub fn ext(self) -> &'static str {
        match self {
            Self::Step => "step",
            Self::Stl => "stl",
            Self::ThreeMf => "3mf",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DisplayUnit {
    #[default]
    Mm,
    Cm,
    In,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeasurementQuality {
    Analytical,
    Computed,
    MeshDerived,
    Fitted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CadRefKind {
    Face,
    Edge,
    Vertex,
    Point,
    Part,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CadReference {
    pub model_id: String,
    pub geometry_revision: String,
    pub kind: CadRefKind,
    pub index: Option<u32>,
    pub point: Option<Vec3>,
    pub on_face: Option<u32>,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CadMeasurementKind {
    Distance,
    Radius,
    Diameter,
    Angle,
    Length,
    Area,
    PlaneDistance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MeasurementUnit {
    #[serde(rename = "mm")]
    Mm,
    #[serde(rename = "mm2")]
    Mm2,
    #[serde(rename = "deg")]
    Deg,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CadMeasurement {
    pub id: String,
    pub kind: CadMeasurementKind,
    pub value: f64,
    pub unit: MeasurementUnit,
    pub quality: MeasurementQuality,
    pub references: Vec<CadReference>,
    pub tolerance: Option<f64>,
    pub label: String,
    pub anchors: Vec<Vec3>,
    #[serde(default)]
    pub details: BTreeMap<String, Value>,
    #[serde(default = "yes")]
    pub persistent: bool,
    #[serde(default)]
    pub stale: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CadModelRef {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub source_type: GeometrySourceType,
    pub declared_unit: String,
    pub unit_scale_to_mm: f64,
    pub units_confirmed: bool,
    pub sha256: String,
    pub byte_length: u64,
    /// Path inside the `.ols` archive; (re)assigned on save.
    #[serde(default)]
    pub asset_path: String,
    pub geometry_revision: String,
    pub kernel_version: String,
    #[serde(default)]
    pub deflection_mm: f64,
    pub source_to_model: Mat4,
    pub model_to_workpiece: Mat4,
    #[serde(default)]
    pub hidden_parts: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CadWorkpieceBinding {
    pub model_id: String,
    pub cylinder_id: String,
    pub faces: Vec<CadReference>,
    pub diameter_mm: f64,
    pub axial_min_mm: f64,
    pub axial_max_mm: f64,
    pub axis_origin: Vec3,
    pub axis_direction: Vec3,
    pub seam_angle_deg: f64,
    pub reversed: bool,
    pub model_to_workpiece: Mat4,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CadWorkspace {
    pub models: Vec<CadModelRef>,
    pub measurements: Vec<CadMeasurement>,
    pub active_workpiece: Option<CadWorkpieceBinding>,
    pub display_unit: DisplayUnit,
    pub display_precision: u32,
}

impl Default for CadWorkspace {
    fn default() -> Self {
        Self { models: Vec::new(), measurements: Vec::new(), active_workpiece: None, display_unit: DisplayUnit::Mm, display_precision: 3 }
    }
}

/// Archive path of a CAD source file (content-addressed; never derived from user input).
pub fn cad_asset_path(sha256: &str, kind: GeometrySourceType) -> String {
    format!("cad/{sha256}.{}", kind.ext())
}

pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
