use serde::{Deserialize, Serialize};

use crate::{Affine2, Point};

/// Path command in absolute coordinates. Serialized as `{ "t": "M", "x": .., "y": .. }`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum PathCmd {
    M { x: f64, y: f64 },
    L { x: f64, y: f64 },
    Q { x1: f64, y1: f64, x: f64, y: f64 },
    C { x1: f64, y1: f64, x2: f64, y2: f64, x: f64, y: f64 },
    Z,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Polyline {
    pub points: Vec<Point>,
    pub closed: bool,
}

impl Polyline {
    pub fn length(&self) -> f64 {
        let mut len: f64 = self.points.windows(2).map(|w| w[0].distance(&w[1])).sum();
        if self.closed && self.points.len() > 2 {
            len += self.points[self.points.len() - 1].distance(&self.points[0]);
        }
        len
    }

    pub fn first(&self) -> Option<Point> {
        self.points.first().copied()
    }

    /// End point, i.e. the first point again for closed polylines.
    pub fn last(&self) -> Option<Point> {
        if self.closed { self.points.first().copied() } else { self.points.last().copied() }
    }

    pub fn reversed(&self) -> Polyline {
        let mut points = self.points.clone();
        points.reverse();
        Polyline { points, closed: self.closed }
    }

    /// Points including the closing point for closed polylines.
    pub fn stroke_points(&self) -> Vec<Point> {
        let mut pts = self.points.clone();
        if self.closed
            && let Some(f) = self.points.first()
        {
            pts.push(*f);
        }
        pts
    }
}

fn subdivisions(chord: f64, tolerance: f64) -> usize {
    // Conservative estimate based on control-polygon length.
    ((chord / tolerance).sqrt().ceil() as usize).clamp(2, 512)
}

/// Flatten path commands into polylines, applying `transform`, within `tolerance_mm`
/// measured in transformed (output) units.
pub fn flatten(cmds: &[PathCmd], transform: &Affine2, tolerance_mm: f64) -> Vec<Polyline> {
    let tol = tolerance_mm.max(1e-4);
    let mut out: Vec<Polyline> = Vec::new();
    let mut current: Vec<Point> = Vec::new();
    let mut cursor = Point::default();
    let mut start = Point::default();
    let scale = transform.mean_scale().max(1e-9);

    let flush = |current: &mut Vec<Point>, out: &mut Vec<Polyline>, closed: bool| {
        if current.len() >= 2 {
            let mut pts = std::mem::take(current);
            if closed && pts.len() > 2 && pts[0].distance(&pts[pts.len() - 1]) < 1e-9 {
                pts.pop();
            }
            out.push(Polyline { points: pts, closed });
        } else {
            current.clear();
        }
    };

    for cmd in cmds {
        match *cmd {
            PathCmd::M { x, y } => {
                flush(&mut current, &mut out, false);
                cursor = Point::new(x, y);
                start = cursor;
                current.push(transform.apply(cursor));
            }
            PathCmd::L { x, y } => {
                if current.is_empty() {
                    current.push(transform.apply(cursor));
                }
                cursor = Point::new(x, y);
                current.push(transform.apply(cursor));
            }
            PathCmd::Q { x1, y1, x, y } => {
                if current.is_empty() {
                    current.push(transform.apply(cursor));
                }
                let p0 = cursor;
                let p1 = Point::new(x1, y1);
                let p2 = Point::new(x, y);
                let chord = (p0.distance(&p1) + p1.distance(&p2)) * scale;
                let n = subdivisions(chord, tol);
                for i in 1..=n {
                    let t = i as f64 / n as f64;
                    let mt = 1.0 - t;
                    let p = Point::new(
                        mt * mt * p0.x + 2.0 * mt * t * p1.x + t * t * p2.x,
                        mt * mt * p0.y + 2.0 * mt * t * p1.y + t * t * p2.y,
                    );
                    current.push(transform.apply(p));
                }
                cursor = p2;
            }
            PathCmd::C { x1, y1, x2, y2, x, y } => {
                if current.is_empty() {
                    current.push(transform.apply(cursor));
                }
                let p0 = cursor;
                let p1 = Point::new(x1, y1);
                let p2 = Point::new(x2, y2);
                let p3 = Point::new(x, y);
                let chord = (p0.distance(&p1) + p1.distance(&p2) + p2.distance(&p3)) * scale;
                let n = subdivisions(chord, tol);
                for i in 1..=n {
                    let t = i as f64 / n as f64;
                    let mt = 1.0 - t;
                    let a = mt * mt * mt;
                    let b = 3.0 * mt * mt * t;
                    let c = 3.0 * mt * t * t;
                    let d = t * t * t;
                    let p = Point::new(
                        a * p0.x + b * p1.x + c * p2.x + d * p3.x,
                        a * p0.y + b * p1.y + c * p2.y + d * p3.y,
                    );
                    current.push(transform.apply(p));
                }
                cursor = p3;
            }
            PathCmd::Z => {
                cursor = start;
                flush(&mut current, &mut out, true);
            }
        }
    }
    flush(&mut current, &mut out, false);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_is_closed() {
        let cmds = [
            PathCmd::M { x: 0.0, y: 0.0 },
            PathCmd::L { x: 10.0, y: 0.0 },
            PathCmd::L { x: 10.0, y: 10.0 },
            PathCmd::L { x: 0.0, y: 10.0 },
            PathCmd::Z,
        ];
        let p = flatten(&cmds, &Affine2::IDENTITY, 0.01);
        assert_eq!(p.len(), 1);
        assert!(p[0].closed);
        assert_eq!(p[0].points.len(), 4);
        assert!((p[0].length() - 40.0).abs() < 1e-9);
    }

    #[test]
    fn cubic_flattening_within_tolerance() {
        // Quarter circle approximation r = 10.
        let k = 0.552_284_749_8 * 10.0;
        let cmds = [
            PathCmd::M { x: 10.0, y: 0.0 },
            PathCmd::C { x1: 10.0, y1: k, x2: k, y2: 10.0, x: 0.0, y: 10.0 },
        ];
        let p = flatten(&cmds, &Affine2::IDENTITY, 0.01);
        for pt in &p[0].points {
            let r = pt.x.hypot(pt.y);
            assert!((r - 10.0).abs() < 0.03, "r = {r}");
        }
        let expected = std::f64::consts::FRAC_PI_2 * 10.0;
        assert!((p[0].length() - expected).abs() < 0.05);
    }

    #[test]
    fn transform_applied() {
        let cmds = [PathCmd::M { x: 0.0, y: 0.0 }, PathCmd::L { x: 1.0, y: 0.0 }];
        let p = flatten(&cmds, &Affine2::translate(5.0, 5.0), 0.01);
        assert_eq!(p[0].points[1], Point::new(6.0, 5.0));
    }

    #[test]
    fn multiple_subpaths() {
        let cmds = [
            PathCmd::M { x: 0.0, y: 0.0 },
            PathCmd::L { x: 1.0, y: 0.0 },
            PathCmd::M { x: 5.0, y: 5.0 },
            PathCmd::L { x: 6.0, y: 5.0 },
        ];
        assert_eq!(flatten(&cmds, &Affine2::IDENTITY, 0.01).len(), 2);
    }
}
