//! Convert document objects into strokes (polylines with laser parameters) in design mm.

use laser_core::LaserSource;
use laser_geometry::{Point, Polyline, flatten};
use laser_project::{LayerMode, Project, Shape};

use crate::hatch::hatch;
use crate::raster::raster_runs;

/// Flattening tolerance in mm.
pub const FLATTEN_TOLERANCE_MM: f64 = 0.02;

#[derive(Debug, Clone, PartialEq)]
pub struct Stroke {
    pub points: Vec<Point>,
    pub closed: bool,
    pub power_pct: f64,
    pub speed_mm_s: f64,
    pub layer: u32,
    pub source: LaserSource,
    /// Vector strokes may be reversed / rotated by the optimizer; scan lines may not.
    pub reorderable: bool,
    /// Laser-off lead-in/out along the stroke direction (raster).
    pub overscan_mm: f64,
}

impl Stroke {
    pub fn start(&self) -> Point {
        self.points[0]
    }

    pub fn end(&self) -> Point {
        if self.closed { self.points[0] } else { *self.points.last().unwrap_or(&self.points[0]) }
    }

    /// Points to visit including the closing point.
    pub fn path(&self) -> Vec<Point> {
        let mut p = self.points.clone();
        if self.closed {
            p.push(self.points[0]);
        }
        p
    }
}

/// Strokes for one output layer, already multiplied by the number of passes.
#[derive(Debug, Clone)]
pub struct LayerStrokes {
    pub layer: u32,
    pub strokes: Vec<Stroke>,
}

pub fn collect(project: &Project) -> (Vec<LayerStrokes>, Vec<String>) {
    let mut warnings = Vec::new();
    let mut out = Vec::new();
    for (li, layer) in project.document.layers.iter().enumerate() {
        if !layer.output || !layer.visible {
            continue;
        }
        let st = &layer.settings;
        let li = li as u32;
        let base = Stroke {
            points: Vec::new(),
            closed: false,
            power_pct: st.power_pct.clamp(0.0, 100.0),
            speed_mm_s: st.speed_mm_s.max(0.1),
            layer: li,
            source: st.source,
            reorderable: true,
            overscan_mm: 0.0,
        };
        let mut strokes: Vec<Stroke> = Vec::new();
        for obj in project.document.objects.iter().filter(|o| o.layer_id == layer.id && o.visible) {
            let affine = obj.transform.to_affine();
            if let Shape::Image { width_mm, height_mm, asset_id } = &obj.shape {
                let Some(url) = project.assets.get(asset_id) else {
                    warnings.push(format!("'{}': image asset missing", obj.name));
                    continue;
                };
                let img = match laser_project::decode_data_url_gray(url) {
                    Ok(i) => i,
                    Err(e) => {
                        warnings.push(format!("'{}': {e}", obj.name));
                        continue;
                    }
                };
                let runs = raster_runs(
                    &img,
                    *width_mm,
                    *height_mm,
                    st.lines_per_mm,
                    st.dither,
                    st.threshold,
                    st.invert,
                    st.bidirectional,
                );
                for r in runs {
                    strokes.push(Stroke {
                        points: vec![
                            affine.apply(Point::new(r.x0_mm, r.y_mm)),
                            affine.apply(Point::new(r.x1_mm, r.y_mm)),
                        ],
                        power_pct: base.power_pct * r.intensity,
                        reorderable: false,
                        overscan_mm: st.overscan_mm.max(0.0),
                        ..base.clone()
                    });
                }
                continue;
            }
            let Some(cmds) = obj.shape.path_commands() else {
                if matches!(obj.shape, Shape::Text { .. }) {
                    warnings.push(format!("'{}': text has no outline yet; skipped", obj.name));
                }
                continue;
            };
            let polys: Vec<Polyline> = flatten(&cmds, &affine, FLATTEN_TOLERANCE_MM);
            match st.mode {
                LayerMode::Line | LayerMode::Image => {
                    for p in polys {
                        strokes.push(Stroke { points: p.points, closed: p.closed, ..base.clone() });
                    }
                }
                LayerMode::Fill => {
                    let mut angles = vec![st.hatch_angle_deg];
                    if st.crosshatch {
                        angles.push(st.hatch_angle_deg + 90.0);
                    }
                    let closed: Vec<Polyline> = polys.iter().filter(|p| p.closed).cloned().collect();
                    if closed.is_empty() {
                        warnings.push(format!("'{}': fill requires closed shapes; outlined instead", obj.name));
                    }
                    for a in angles {
                        for seg in hatch(&closed, st.hatch_spacing_mm, a, st.bidirectional) {
                            strokes.push(Stroke { points: seg.to_vec(), reorderable: false, ..base.clone() });
                        }
                    }
                    if st.fill_outline || closed.is_empty() {
                        for p in polys {
                            strokes.push(Stroke { points: p.points, closed: p.closed, ..base.clone() });
                        }
                    }
                }
            }
        }
        strokes.retain(|s| s.points.len() >= 2);
        if strokes.is_empty() {
            continue;
        }
        let passes = st.passes.clamp(1, 100) as usize;
        let mut all = Vec::with_capacity(strokes.len() * passes);
        for _ in 0..passes {
            all.extend(strokes.iter().cloned());
        }
        out.push(LayerStrokes { layer: li, strokes: all });
    }
    (out, warnings)
}
