//! Scanline hatch fill (even-odd rule) for closed polylines.

use laser_geometry::{Affine2, Point, Polyline};

/// Hatch lines inside `polys` at `angle_deg` with `spacing`. Lines alternate direction when
/// `bidirectional` is true. Returns line segments in order.
pub fn hatch(polys: &[Polyline], spacing: f64, angle_deg: f64, bidirectional: bool) -> Vec<[Point; 2]> {
    let spacing = spacing.max(0.01);
    let to_local = Affine2::rotate_deg(-angle_deg);
    let to_world = Affine2::rotate_deg(angle_deg);
    let edges: Vec<(Point, Point)> = polys
        .iter()
        .filter(|p| p.closed && p.points.len() >= 3)
        .flat_map(|p| {
            let pts: Vec<Point> = p.points.iter().map(|q| to_local.apply(*q)).collect();
            let n = pts.len();
            (0..n).map(move |i| (pts[i], pts[(i + 1) % n])).collect::<Vec<_>>()
        })
        .collect();
    if edges.is_empty() {
        return Vec::new();
    }
    let min_y = edges.iter().map(|e| e.0.y.min(e.1.y)).fold(f64::INFINITY, f64::min);
    let max_y = edges.iter().map(|e| e.0.y.max(e.1.y)).fold(f64::NEG_INFINITY, f64::max);
    let mut out = Vec::new();
    let mut y = min_y + spacing / 2.0;
    let mut forward = true;
    while y < max_y {
        let mut xs: Vec<f64> = edges
            .iter()
            .filter_map(|(a, b)| {
                // Half-open interval avoids double-counting shared vertices.
                let (lo, hi) = if a.y < b.y { (a, b) } else { (b, a) };
                if y >= lo.y && y < hi.y {
                    Some(lo.x + (y - lo.y) * (hi.x - lo.x) / (hi.y - lo.y))
                } else {
                    None
                }
            })
            .collect();
        xs.sort_by(f64::total_cmp);
        let mut row: Vec<[Point; 2]> = xs
            .as_chunks::<2>()
            .0
            .iter()
            .filter(|&&[x0, x1]| x1 - x0 > 1e-9)
            .map(|&[x0, x1]| [to_world.apply(Point::new(x0, y)), to_world.apply(Point::new(x1, y))])
            .collect();
        if bidirectional && !forward {
            row.reverse();
            for seg in &mut row {
                seg.swap(0, 1);
            }
        }
        out.extend(row);
        forward = !forward;
        y += spacing;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x: f64, y: f64, s: f64) -> Polyline {
        Polyline {
            points: vec![Point::new(x, y), Point::new(x + s, y), Point::new(x + s, y + s), Point::new(x, y + s)],
            closed: true,
        }
    }

    #[test]
    fn fills_square() {
        let lines = hatch(&[square(0.0, 0.0, 10.0)], 1.0, 0.0, true);
        assert_eq!(lines.len(), 10);
        let total: f64 = lines.iter().map(|l| l[0].distance(&l[1])).sum();
        assert!((total - 100.0).abs() < 1e-9);
        // Bidirectional: second line runs right-to-left.
        assert!(lines[1][0].x > lines[1][1].x);
    }

    #[test]
    fn even_odd_hole() {
        let lines = hatch(&[square(0.0, 0.0, 10.0), square(3.0, 3.0, 4.0)], 1.0, 0.0, false);
        let total: f64 = lines.iter().map(|l| l[0].distance(&l[1])).sum();
        assert!((total - (100.0 - 16.0)).abs() < 1e-9);
    }

    #[test]
    fn rotated_hatch_stays_inside() {
        for l in hatch(&[square(0.0, 0.0, 10.0)], 0.5, 45.0, true) {
            for p in l {
                assert!(p.x > -1e-9 && p.x < 10.0 + 1e-9 && p.y > -1e-9 && p.y < 10.0 + 1e-9);
            }
        }
    }
}
