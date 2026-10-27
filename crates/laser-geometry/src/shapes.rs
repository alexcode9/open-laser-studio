//! Primitive shapes as path commands in local coordinates.

use crate::PathCmd;

/// Bezier constant for a quarter circle.
const KAPPA: f64 = 0.552_284_749_830_793_4;

/// Rectangle with its top-left corner at the local origin.
pub fn rect(width: f64, height: f64) -> Vec<PathCmd> {
    vec![
        PathCmd::M { x: 0.0, y: 0.0 },
        PathCmd::L { x: width, y: 0.0 },
        PathCmd::L { x: width, y: height },
        PathCmd::L { x: 0.0, y: height },
        PathCmd::Z,
    ]
}

/// Ellipse centered at the local origin.
pub fn ellipse(rx: f64, ry: f64) -> Vec<PathCmd> {
    let kx = rx * KAPPA;
    let ky = ry * KAPPA;
    vec![
        PathCmd::M { x: rx, y: 0.0 },
        PathCmd::C { x1: rx, y1: ky, x2: kx, y2: ry, x: 0.0, y: ry },
        PathCmd::C { x1: -kx, y1: ry, x2: -rx, y2: ky, x: -rx, y: 0.0 },
        PathCmd::C { x1: -rx, y1: -ky, x2: -kx, y2: -ry, x: 0.0, y: -ry },
        PathCmd::C { x1: kx, y1: -ry, x2: rx, y2: -ky, x: rx, y: 0.0 },
        PathCmd::Z,
    ]
}

/// Open or closed polyline from a flat `[x0, y0, x1, y1, ...]` list.
pub fn polyline(points: &[f64], closed: bool) -> Vec<PathCmd> {
    let mut cmds = Vec::with_capacity(points.len() / 2 + 1);
    for (i, &[x, y]) in points.as_chunks::<2>().0.iter().enumerate() {
        if i == 0 {
            cmds.push(PathCmd::M { x, y });
        } else {
            cmds.push(PathCmd::L { x, y });
        }
    }
    if closed {
        cmds.push(PathCmd::Z);
    }
    cmds
}
