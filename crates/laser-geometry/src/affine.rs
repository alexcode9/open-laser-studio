use serde::{Deserialize, Serialize};

use crate::Point;

/// 2D affine transform in SVG/Canvas order `[a, b, c, d, e, f]`:
/// `x' = a*x + c*y + e`, `y' = b*x + d*y + f`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Affine2(pub [f64; 6]);

impl Default for Affine2 {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Affine2 {
    pub const IDENTITY: Affine2 = Affine2([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

    pub fn translate(tx: f64, ty: f64) -> Self {
        Affine2([1.0, 0.0, 0.0, 1.0, tx, ty])
    }

    pub fn scale(sx: f64, sy: f64) -> Self {
        Affine2([sx, 0.0, 0.0, sy, 0.0, 0.0])
    }

    pub fn rotate_deg(deg: f64) -> Self {
        let (s, c) = deg.to_radians().sin_cos();
        Affine2([c, s, -s, c, 0.0, 0.0])
    }

    /// Returns `self * other`: apply `other` first, then `self`.
    pub fn then(&self, after: &Affine2) -> Affine2 {
        after.mul(self)
    }

    pub fn mul(&self, o: &Affine2) -> Affine2 {
        let [a, b, c, d, e, f] = self.0;
        let [oa, ob, oc, od, oe, of] = o.0;
        Affine2([
            a * oa + c * ob,
            b * oa + d * ob,
            a * oc + c * od,
            b * oc + d * od,
            a * oe + c * of + e,
            b * oe + d * of + f,
        ])
    }

    pub fn apply(&self, p: Point) -> Point {
        let [a, b, c, d, e, f] = self.0;
        Point::new(a * p.x + c * p.y + e, b * p.x + d * p.y + f)
    }

    pub fn determinant(&self) -> f64 {
        let [a, b, c, d, ..] = self.0;
        a * d - b * c
    }

    pub fn invert(&self) -> Option<Affine2> {
        let det = self.determinant();
        if det.abs() < 1e-12 {
            return None;
        }
        let [a, b, c, d, e, f] = self.0;
        Some(Affine2([
            d / det,
            -b / det,
            -c / det,
            a / det,
            (c * f - d * e) / det,
            (b * e - a * f) / det,
        ]))
    }

    /// Approximate uniform scale factor (used for flattening tolerance).
    pub fn mean_scale(&self) -> f64 {
        self.determinant().abs().sqrt()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_and_invert() {
        let t = Affine2::translate(10.0, 5.0).mul(&Affine2::rotate_deg(90.0));
        let p = t.apply(Point::new(1.0, 0.0));
        assert!((p.x - 10.0).abs() < 1e-9 && (p.y - 6.0).abs() < 1e-9);
        let back = t.invert().unwrap().apply(p);
        assert!((back.x - 1.0).abs() < 1e-9 && back.y.abs() < 1e-9);
    }

    #[test]
    fn then_applies_in_order() {
        let t = Affine2::scale(2.0, 2.0).then(&Affine2::translate(1.0, 0.0));
        let p = t.apply(Point::new(1.0, 1.0));
        assert_eq!((p.x, p.y), (3.0, 2.0));
    }
}
