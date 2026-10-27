//! Motion planner: project document → structured toolpath IR → machine output.
//!
//! Pipeline: `strokes` (vector/fill/raster in design mm) → `order` → strategy mapping
//! (`planner`) → [`Toolpath`] of [`MotionSegment`]s with timing (`timing`) → output
//! (`emit` for F1 G-code, `overlay` for the 3D preview).

pub mod emit;
pub mod hatch;
pub mod order;
pub mod overlay;
pub mod planner;
pub mod raster;
pub mod segment;
pub mod strokes;
pub mod timing;

pub use emit::{F1Program, emit_f1};
pub use overlay::{Overlay, build_overlay};
pub use planner::plan;
pub use segment::{MotionSegment, Section, SegmentKind, SyncKind, Toolpath, ToolpathStats};
pub use strokes::Stroke;
