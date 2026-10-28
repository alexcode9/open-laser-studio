//! Rigid 3D frames and the CAD-model → rotary-workpiece alignment.
//!
//! Coordinate spaces (see `docs/architecture/COORDINATE_SYSTEMS.md`):
//! - Source: coordinates as written in the CAD file, in the file's unit.
//! - Model: source scaled to millimetres (`sourceToModel`); assembly transforms applied.
//! - Workpiece: the cylinder local frame of [`crate::CylinderTransform`]: X along the axis with
//!   `u = 0` at the start of the selected cylinder, the seam (`s = 0`) on +Y, `s` increasing
//!   towards +Z. Machine and world poses are derived from it by `CylinderTransform::pose`.
//!
//! `modelToWorkpiece` is a rigid transform (rotation + translation, never scale), so the model
//! is never modified and the alignment can always be undone exactly with its inverse.

use laser_core::CoreError;
use serde::{Deserialize, Serialize};

pub type Vec3 = [f64; 3];

/// Column-major 4x4 matrix (three.js `Matrix4.elements` layout).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Mat4(pub [f64; 16]);

impl Mat4 {
    pub const IDENTITY: Mat4 = Mat4([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]);

    pub fn get(&self, row: usize, col: usize) -> f64 {
        self.0[col * 4 + row]
    }

    fn set(&mut self, row: usize, col: usize, v: f64) {
        self.0[col * 4 + row] = v;
    }

    /// Rigid transform from rotation rows and a translation.
    pub fn from_rows_translation(rows: [Vec3; 3], t: Vec3) -> Mat4 {
        let mut m = Mat4::IDENTITY;
        for (r, row) in rows.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                m.set(r, c, *v);
            }
            m.set(r, 3, t[r]);
        }
        m
    }

    pub fn transform_point(&self, p: Vec3) -> Vec3 {
        let mut out = [0.0; 3];
        for (r, o) in out.iter_mut().enumerate() {
            *o = self.get(r, 0) * p[0] + self.get(r, 1) * p[1] + self.get(r, 2) * p[2] + self.get(r, 3);
        }
        out
    }

    pub fn transform_dir(&self, d: Vec3) -> Vec3 {
        let mut out = [0.0; 3];
        for (r, o) in out.iter_mut().enumerate() {
            *o = self.get(r, 0) * d[0] + self.get(r, 1) * d[1] + self.get(r, 2) * d[2];
        }
        out
    }

    pub fn mul(&self, b: &Mat4) -> Mat4 {
        let mut m = Mat4([0.0; 16]);
        for r in 0..4 {
            for c in 0..4 {
                m.set(r, c, (0..4).map(|k| self.get(r, k) * b.get(k, c)).sum());
            }
        }
        m
    }

    /// Inverse of a rigid transform (orthonormal rotation + translation).
    pub fn rigid_inverse(&self) -> Mat4 {
        let rows = [
            [self.get(0, 0), self.get(1, 0), self.get(2, 0)],
            [self.get(0, 1), self.get(1, 1), self.get(2, 1)],
            [self.get(0, 2), self.get(1, 2), self.get(2, 2)],
        ];
        let t = [self.get(0, 3), self.get(1, 3), self.get(2, 3)];
        let ti = [-dot(rows[0], t), -dot(rows[1], t), -dot(rows[2], t)];
        Mat4::from_rows_translation(rows, ti)
    }

    /// `-0.0` does not survive JSON normalisation as `-0.0`; persisted matrices use `0.0`.
    pub fn without_negative_zero(mut self) -> Mat4 {
        for v in &mut self.0 {
            *v += 0.0;
        }
        self
    }

    pub fn is_finite(&self) -> bool {
        self.0.iter().all(|v| v.is_finite())
    }
}

pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

pub fn norm(a: Vec3) -> f64 {
    dot(a, a).sqrt()
}

fn scale(a: Vec3, k: f64) -> Vec3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn normalize(a: Vec3) -> Option<Vec3> {
    let n = norm(a);
    (n.is_finite() && n > 1e-12).then(|| scale(a, 1.0 / n))
}

/// Component of `v` perpendicular to unit `d`, normalised.
fn perpendicular(v: Vec3, d: Vec3) -> Option<Vec3> {
    normalize(sub(v, scale(d, dot(v, d))))
}

/// Rotate `v` about unit axis `k` by `angle` (Rodrigues).
fn rotate_about(v: Vec3, k: Vec3, angle: f64) -> Vec3 {
    let (s, c) = angle.sin_cos();
    let kxv = cross(k, v);
    let kdv = dot(k, v);
    [
        v[0] * c + kxv[0] * s + k[0] * kdv * (1.0 - c),
        v[1] * c + kxv[1] * s + k[1] * kdv * (1.0 - c),
        v[2] * c + kxv[2] * s + k[2] * kdv * (1.0 - c),
    ]
}

/// Deterministic seam reference for an axis: the model axis least aligned with it (ties resolved
/// in Z, Y, X order), projected perpendicular. A cylinder along model Z gets its seam on model +Y.
fn default_seam_reference(d: Vec3) -> Vec3 {
    let candidates: [Vec3; 3] = [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]];
    let mut best = candidates[0];
    let mut best_align = f64::INFINITY;
    for c in candidates {
        let a = dot(c, d).abs();
        if a < best_align - 1e-9 {
            best_align = a;
            best = c;
        }
    }
    best
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignParams {
    pub axis_origin: Vec3,
    pub axis_direction: Vec3,
    /// Extent of the selected cylinder, as distances from `axis_origin` along `axis_direction`.
    pub axial_min_mm: f64,
    pub axial_max_mm: f64,
    /// Rotation of the seam about the (possibly reversed) axis, right-handed, degrees.
    pub seam_angle_deg: f64,
    /// Flip the axis so `u = 0` is at the other end.
    pub reversed: bool,
    #[serde(default)]
    pub seam_reference: Option<Vec3>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignResult {
    pub model_to_workpiece: Mat4,
    pub workpiece_to_model: Mat4,
    pub length_mm: f64,
    pub seam_direction: Vec3,
}

/// Rigid transform taking a model-space cylinder axis to the rotary workpiece frame.
pub fn align_axis_to_rotary(p: &AlignParams) -> Result<AlignResult, CoreError> {
    let finite = p.axis_origin.iter().chain(p.axis_direction.iter()).all(|v| v.is_finite())
        && p.axial_min_mm.is_finite()
        && p.axial_max_mm.is_finite()
        && p.seam_angle_deg.is_finite();
    if !finite {
        return Err(CoreError::InvalidArgument("alignment parameters must be finite".into()));
    }
    let length = p.axial_max_mm - p.axial_min_mm;
    if length <= 1e-9 {
        return Err(CoreError::InvalidArgument("selected cylinder has no axial extent".into()));
    }
    let d0 = normalize(p.axis_direction).ok_or_else(|| CoreError::InvalidArgument("axis direction must be non-zero".into()))?;
    let (d, start) = if p.reversed { (scale(d0, -1.0), -p.axial_max_mm) } else { (d0, p.axial_min_mm) };

    let reference = p
        .seam_reference
        .filter(|r| r.iter().all(|v| v.is_finite()))
        .and_then(|r| perpendicular(r, d))
        .or_else(|| perpendicular(default_seam_reference(d), d))
        .ok_or_else(|| CoreError::InvalidArgument("could not establish a seam direction".into()))?;
    let e0 = rotate_about(reference, d, p.seam_angle_deg.to_radians());
    let e0 = perpendicular(e0, d).ok_or_else(|| CoreError::InvalidArgument("degenerate seam direction".into()))?;
    let e1 = cross(d, e0);

    let rows = [d, e0, e1];
    let o = p.axis_origin;
    let t = [-dot(d, o) - start, -dot(e0, o), -dot(e1, o)];
    let m = Mat4::from_rows_translation(rows, t).without_negative_zero();
    Ok(AlignResult {
        model_to_workpiece: m,
        workpiece_to_model: m.rigid_inverse().without_negative_zero(),
        length_mm: length,
        seam_direction: e0.map(|v| v + 0.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec3, b: Vec3, tol: f64) -> bool {
        a.iter().zip(b.iter()).all(|(x, y)| (x - y).abs() < tol)
    }

    fn params(origin: Vec3, dir: Vec3) -> AlignParams {
        AlignParams { axis_origin: origin, axis_direction: dir, axial_min_mm: 0.0, axial_max_mm: 150.0, seam_angle_deg: 0.0, reversed: false, seam_reference: None }
    }

    #[test]
    fn z_cylinder_maps_to_x_axis() {
        let r = align_axis_to_rotary(&params([0.0, 0.0, 0.0], [0.0, 0.0, 1.0])).unwrap();
        let m = r.model_to_workpiece;
        assert!(close(m.transform_point([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0], 1e-12));
        assert!(close(m.transform_point([0.0, 0.0, 150.0]), [150.0, 0.0, 0.0], 1e-12));
        assert!(close(m.transform_dir([0.0, 0.0, 1.0]), [1.0, 0.0, 0.0], 1e-12));
        // Seam reference for a Z axis is model +Y (Z is the axis itself).
        assert!(close(r.seam_direction, [0.0, 1.0, 0.0], 1e-12));
        assert!(close(m.transform_point([0.0, 15.0, 40.0]), [40.0, 15.0, 0.0], 1e-12));
        assert_eq!(r.length_mm, 150.0);
    }

    #[test]
    fn rigid_and_exactly_reversible() {
        let mut p = params([12.0, -7.0, 5.0], [1.0, 2.0, 2.0]);
        p.seam_angle_deg = 33.0;
        p.axial_min_mm = -4.0;
        let r = align_axis_to_rotary(&p).unwrap();
        let round = r.workpiece_to_model.mul(&r.model_to_workpiece);
        for (a, b) in round.0.iter().zip(Mat4::IDENTITY.0.iter()) {
            assert!((a - b).abs() < 1e-12);
        }
        let m = r.model_to_workpiece;
        let (x, y, z) = (m.transform_dir([1.0, 0.0, 0.0]), m.transform_dir([0.0, 1.0, 0.0]), m.transform_dir([0.0, 0.0, 1.0]));
        for v in [x, y, z] {
            assert!((norm(v) - 1.0).abs() < 1e-12);
        }
        assert!(close(cross(x, y), z, 1e-12), "must stay right-handed");
        // Axis start lands on u = 0, a radial point on the seam lands on +Y at radius distance.
        let d = [1.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0];
        let start = [12.0 - 4.0 * d[0], -7.0 - 4.0 * d[1], 5.0 - 4.0 * d[2]];
        assert!(close(m.transform_point(start), [0.0, 0.0, 0.0], 1e-12));
        let seam_pt = [start[0] + 15.0 * r.seam_direction[0], start[1] + 15.0 * r.seam_direction[1], start[2] + 15.0 * r.seam_direction[2]];
        assert!(close(m.transform_point(seam_pt), [0.0, 15.0, 0.0], 1e-12));
    }

    #[test]
    fn reversed_puts_u0_at_the_other_end() {
        let mut p = params([0.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
        p.reversed = true;
        let m = align_axis_to_rotary(&p).unwrap().model_to_workpiece;
        assert!(close(m.transform_point([0.0, 0.0, 150.0]), [0.0, 0.0, 0.0], 1e-12));
        assert!(close(m.transform_point([0.0, 0.0, 0.0]), [150.0, 0.0, 0.0], 1e-12));
    }

    #[test]
    fn seam_angle_rotates_about_the_axis() {
        let mut p = params([0.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
        p.seam_angle_deg = 90.0;
        let r = align_axis_to_rotary(&p).unwrap();
        // +Y rotated 90° right-handed about +Z is -X.
        assert!(close(r.seam_direction, [-1.0, 0.0, 0.0], 1e-12));
    }

    #[test]
    fn rejects_degenerate_input() {
        assert!(align_axis_to_rotary(&params([0.0; 3], [0.0; 3])).is_err());
        let mut p = params([0.0; 3], [0.0, 0.0, 1.0]);
        p.axial_max_mm = 0.0;
        assert!(align_axis_to_rotary(&p).is_err());
        let mut p = params([0.0; 3], [0.0, 0.0, 1.0]);
        p.axis_origin[1] = f64::NAN;
        assert!(align_axis_to_rotary(&p).is_err());
    }
}
