//! Travel optimization: greedy nearest-neighbour ordering of reorderable strokes.
//! Non-reorderable runs (hatch / raster) keep their generated order as a block.

use laser_geometry::Point;

use crate::strokes::Stroke;

const GREEDY_LIMIT: usize = 4000;

fn best_entry(s: &Stroke, from: Point) -> (f64, Option<usize>, bool) {
    // Returns (distance, rotate-to-index for closed, reverse for open).
    if s.closed {
        let (i, d) = s
            .points
            .iter()
            .enumerate()
            .map(|(i, p)| (i, p.distance(&from)))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap_or((0, f64::INFINITY));
        (d, Some(i), false)
    } else {
        let ds = s.start().distance(&from);
        let de = s.end().distance(&from);
        if de < ds { (de, None, true) } else { (ds, None, false) }
    }
}

fn apply_entry(mut s: Stroke, rot: Option<usize>, rev: bool) -> Stroke {
    if let Some(i) = rot {
        s.points.rotate_left(i);
    }
    if rev {
        s.points.reverse();
    }
    s
}

pub fn order_strokes(strokes: Vec<Stroke>, start: Point) -> Vec<Stroke> {
    let (mut free, fixed): (Vec<Stroke>, Vec<Stroke>) = strokes.into_iter().partition(|s| s.reorderable);
    let mut out = Vec::with_capacity(free.len() + fixed.len());
    let mut cursor = start;
    // Fixed blocks first (fills before outlines is the common LightBurn-style default).
    for s in fixed {
        cursor = s.end();
        out.push(s);
    }
    if free.len() > GREEDY_LIMIT {
        out.extend(free);
        return out;
    }
    while !free.is_empty() {
        let (idx, (_, rot, rev)) = free
            .iter()
            .enumerate()
            .map(|(i, s)| (i, best_entry(s, cursor)))
            .min_by(|a, b| a.1.0.total_cmp(&b.1.0))
            .expect("non-empty");
        let s = apply_entry(free.swap_remove(idx), rot, rev);
        cursor = s.end();
        out.push(s);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use laser_core::LaserSource;

    fn line(x0: f64, x1: f64) -> Stroke {
        Stroke {
            points: vec![Point::new(x0, 0.0), Point::new(x1, 0.0)],
            closed: false,
            power_pct: 10.0,
            speed_mm_s: 10.0,
            layer: 0,
            source: LaserSource::Blue,
            reorderable: true,
            overscan_mm: 0.0,
        }
    }

    #[test]
    fn reduces_travel_and_reverses() {
        let ordered = order_strokes(vec![line(20.0, 30.0), line(12.0, 2.0)], Point::new(0.0, 0.0));
        assert_eq!(ordered[0].start(), Point::new(2.0, 0.0));
        assert_eq!(ordered[1].start(), Point::new(20.0, 0.0));
    }
}
