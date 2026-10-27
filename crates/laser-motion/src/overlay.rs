//! 3D overlay buffers for the preview. Cylinder mode: points on the cylinder's local frame
//! (see `laser_geometry::cylinder`). Flat mode: points on the field plane `(gx - cx, 0, gy - cy)`.

use laser_geometry::CylinderTransform;
use laser_project::{Project, WorkspaceMode};
use serde::Serialize;

use crate::segment::{SegmentKind, Toolpath};

/// Line-segment vertex buffers (`xyz` per vertex, two vertices per line piece).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub mark_positions: Vec<f32>,
    pub travel_positions: Vec<f32>,
    /// For each toolpath segment, the number of mark vertices emitted before it (length n+1).
    /// Lets the renderer draw "completed" geometry with a draw range.
    pub mark_vertex_offsets: Vec<u32>,
}

const LIFT_MM: f64 = 0.05;
const MAX_PIECE_MM: f64 = 1.0;

pub fn build_overlay(tp: &Toolpath, project: &Project) -> Overlay {
    let mut o = Overlay { mark_vertex_offsets: Vec::with_capacity(tp.segments.len() + 1), ..Default::default() };
    let lifted = laser_core::CylinderSpec {
        diameter_mm: project.workpiece.diameter_mm + 2.0 * LIFT_MM,
        ..project.workpiece
    };
    // Surface arc lengths are measured on the real radius; scale s to the lifted radius.
    let cyl = CylinderTransform::new(lifted);
    let s_scale = lifted.radius_mm() / project.workpiece.radius_mm().max(1e-9);
    let (cx, cy) = (project.machine.galvo.center_x_mm, project.machine.galvo.center_y_mm);
    for seg in &tp.segments {
        o.mark_vertex_offsets.push((o.mark_positions.len() / 3) as u32);
        let buf = match seg.kind {
            SegmentKind::Mark => &mut o.mark_positions,
            SegmentKind::Travel => &mut o.travel_positions,
            _ => continue,
        };
        match (project.mode, seg.surface) {
            (WorkspaceMode::Cylinder, Some([u0, s0, u1, s1])) => {
                let len = (u1 - u0).hypot(s1 - s0);
                let n = ((len / MAX_PIECE_MM).ceil() as usize).clamp(1, 512);
                let mut prev = cyl.surface_to_local(u0, s0 * s_scale);
                for i in 1..=n {
                    let t = i as f64 / n as f64;
                    let p = cyl.surface_to_local(u0 + (u1 - u0) * t, (s0 + (s1 - s0) * t) * s_scale);
                    buf.extend(prev.iter().chain(p.iter()).map(|v| *v as f32));
                    prev = p;
                }
            }
            (WorkspaceMode::Flat, _) => {
                let a = [seg.start.gx_mm - cx, 0.0, seg.start.gy_mm - cy];
                let b = [seg.end.gx_mm - cx, 0.0, seg.end.gy_mm - cy];
                buf.extend(a.iter().chain(b.iter()).map(|v| *v as f32));
            }
            _ => {}
        }
    }
    o.mark_vertex_offsets.push((o.mark_positions.len() / 3) as u32);
    o
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan;
    use laser_project::sample::sample_project;

    #[test]
    fn overlay_points_lie_on_lifted_cylinder() {
        let p = sample_project();
        let tp = plan(&p);
        let o = build_overlay(&tp, &p);
        assert_eq!(o.mark_vertex_offsets.len(), tp.segments.len() + 1);
        let r = (p.workpiece.radius_mm() + LIFT_MM) as f32;
        for &[_, y, z] in o.mark_positions.as_chunks::<3>().0 {
            assert!((y.hypot(z) - r).abs() < 1e-3);
        }
    }
}
