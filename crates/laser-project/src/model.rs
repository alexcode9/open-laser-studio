use std::collections::BTreeMap;

use laser_core::{CylinderSpec, LaserSource, MachineProfile};
use laser_geometry::{Affine2, PathCmd, shapes};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMode {
    /// Canvas = galvo field (mm).
    #[default]
    Flat,
    /// Canvas = unwrapped cylinder surface (x = u axial, y = s circumferential).
    Cylinder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CylinderStrategy {
    /// Strategy A: stop-and-go sections. Workpiece never moves during emission.
    #[default]
    Indexed,
    /// Strategy B/C: A/U follow the artwork with the galvo held at field center.
    /// EXPERIMENTAL — simulation only.
    Coupled,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CylinderJobSettings {
    pub strategy: CylinderStrategy,
    /// Width of one indexed section along the axis (mm). Clamped to the galvo field.
    pub section_width_mm: f64,
    /// Maximum allowed distance below focus at the edge of a section (mm).
    pub max_focus_error_mm: f64,
    /// Strokes that cross a section boundary by less than this stay unsplit (mm).
    pub section_overlap_mm: f64,
    /// Optional explicit circumferential window (mm). 0 = derive from focus error.
    pub angular_window_mm: f64,
    /// Helical pitch used by the helix helper (mm per revolution).
    pub helical_pitch_mm: f64,
}

impl Default for CylinderJobSettings {
    fn default() -> Self {
        Self {
            strategy: CylinderStrategy::Indexed,
            section_width_mm: 100.0,
            max_focus_error_mm: 0.5,
            section_overlap_mm: 1.0,
            angular_window_mm: 0.0,
            helical_pitch_mm: 10.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LayerMode {
    #[default]
    Line,
    Fill,
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DitherMode {
    Threshold,
    #[default]
    FloydSteinberg,
    Grayscale,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaserSettings {
    pub mode: LayerMode,
    pub source: LaserSource,
    pub speed_mm_s: f64,
    pub power_pct: f64,
    pub passes: u32,
    pub hatch_spacing_mm: f64,
    pub hatch_angle_deg: f64,
    pub crosshatch: bool,
    pub fill_outline: bool,
    pub lines_per_mm: f64,
    pub dither: DitherMode,
    pub threshold: u8,
    pub invert: bool,
    pub bidirectional: bool,
    pub overscan_mm: f64,
}

impl Default for LaserSettings {
    fn default() -> Self {
        Self {
            mode: LayerMode::Line,
            source: LaserSource::Blue,
            speed_mm_s: 100.0,
            power_pct: 20.0,
            passes: 1,
            hatch_spacing_mm: 0.2,
            hatch_angle_deg: 0.0,
            crosshatch: false,
            fill_outline: true,
            lines_per_mm: 5.0,
            dither: DitherMode::FloydSteinberg,
            threshold: 128,
            invert: false,
            bidirectional: true,
            overscan_mm: 2.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
    pub locked: bool,
    /// Excluded from toolpaths when false.
    pub output: bool,
    pub settings: LaserSettings,
}

impl Default for Layer {
    fn default() -> Self {
        Self {
            id: "layer-1".into(),
            name: "Layer 1".into(),
            color: "#38bdf8".into(),
            visible: true,
            locked: false,
            output: true,
            settings: LaserSettings::default(),
        }
    }
}

/// Konva-compatible transform: `translate(x, y) * rotate(rotation) * scale(scaleX, scaleY)`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Transform2 {
    pub x: f64,
    pub y: f64,
    pub rotation_deg: f64,
    pub scale_x: f64,
    pub scale_y: f64,
}

impl Default for Transform2 {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, rotation_deg: 0.0, scale_x: 1.0, scale_y: 1.0 }
    }
}

impl Transform2 {
    pub fn to_affine(&self) -> Affine2 {
        Affine2::translate(self.x, self.y)
            .mul(&Affine2::rotate_deg(self.rotation_deg))
            .mul(&Affine2::scale(self.scale_x, self.scale_y))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Shape {
    #[serde(rename_all = "camelCase")]
    Rect { width: f64, height: f64 },
    #[serde(rename_all = "camelCase")]
    Ellipse { rx: f64, ry: f64 },
    /// Flat `[x0, y0, x1, y1, ...]` polyline in local coordinates.
    #[serde(rename_all = "camelCase")]
    Line { points: Vec<f64>, closed: bool },
    #[serde(rename_all = "camelCase")]
    Path { commands: Vec<PathCmd> },
    /// Text is rendered by the UI; machine output uses `outline` (computed by `text_to_path`).
    #[serde(rename_all = "camelCase")]
    Text {
        text: String,
        font_size_mm: f64,
        font_family: String,
        #[serde(default)]
        outline: Option<Vec<PathCmd>>,
    },
    /// Raster image; `asset_id` refers to `Project::assets` (data URL).
    #[serde(rename_all = "camelCase")]
    Image { width_mm: f64, height_mm: f64, asset_id: String },
}

impl Shape {
    /// Vector outline in local coordinates (`None` for images and un-outlined text).
    pub fn path_commands(&self) -> Option<Vec<PathCmd>> {
        match self {
            Shape::Rect { width, height } => Some(shapes::rect(*width, *height)),
            Shape::Ellipse { rx, ry } => Some(shapes::ellipse(*rx, *ry)),
            Shape::Line { points, closed } => Some(shapes::polyline(points, *closed)),
            Shape::Path { commands } => Some(commands.clone()),
            Shape::Text { outline, .. } => outline.clone(),
            Shape::Image { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignObject {
    pub id: String,
    pub name: String,
    pub layer_id: String,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub transform: Transform2,
    pub shape: Shape,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Document {
    pub layers: Vec<Layer>,
    pub objects: Vec<DesignObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub schema_version: u32,
    pub name: String,
    pub mode: WorkspaceMode,
    pub document: Document,
    pub workpiece: CylinderSpec,
    pub cylinder: CylinderJobSettings,
    pub machine: MachineProfile,
    /// Asset id -> data URL. Stored as separate files inside `.ols`.
    pub assets: BTreeMap<String, String>,
    /// Imported CAD models, measurements and the CAD-derived workpiece (schema v2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cad: Option<crate::cad::CadWorkspace>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            schema_version: crate::OLS_SCHEMA_VERSION,
            name: "Untitled".into(),
            mode: WorkspaceMode::Flat,
            document: Document { layers: vec![Layer::default()], objects: Vec::new() },
            workpiece: CylinderSpec::default(),
            cylinder: CylinderJobSettings::default(),
            machine: MachineProfile::default(),
            assets: BTreeMap::new(),
            cad: None,
        }
    }
}

impl Project {
    pub fn layer(&self, id: &str) -> Option<&Layer> {
        self.document.layers.iter().find(|l| l.id == id)
    }
}
