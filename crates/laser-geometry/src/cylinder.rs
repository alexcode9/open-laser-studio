//! Cylindrical coordinate transforms — the single source of truth for 2D editor, 3D preview,
//! motion planner and simulator.
//!
//! Conventions (see `docs/architecture/MOTION_MODEL.md`):
//! - Surface coordinates: `u` axial distance (mm), `s` circumferential arc length (mm).
//! - Machine: `A` rotation (deg), `U` axial translation (mm).
//!   `A = A0 + sign * s / (PI * D) * 360`, `U = U0 + u`.
//! - World (3D preview): X along the cylinder axis, Y up (towards the laser), Z towards viewer.
//!   The laser spot at galvo field center is at world origin `(0, R, 0)` on top of the workpiece.
//! - Cylinder local frame: point `(u, s)` lies at `(u, R cos(s/R), R sin(s/R))`.
//!   The cylinder group is placed with `rotation.x = -(s_top / R)` and `position.x = -u_top`,
//!   where `(u_top, s_top)` is the surface point under the field center for machine `(A, U)`.

use laser_core::CylinderSpec;
use serde::Serialize;

use std::f64::consts::PI;

pub type WorldPoint = [f64; 3];

#[derive(Debug, Clone, Copy)]
pub struct CylinderTransform {
    pub spec: CylinderSpec,
}

/// Pose of the cylinder group in the 3D world for a machine position.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CylinderPose {
    pub rotation_x_rad: f64,
    pub translation_x_mm: f64,
}

impl CylinderTransform {
    pub fn new(spec: CylinderSpec) -> Self {
        Self { spec }
    }

    pub fn radius(&self) -> f64 {
        self.spec.radius_mm()
    }

    pub fn circumference(&self) -> f64 {
        self.spec.circumference_mm()
    }

    /// Machine A (deg) that brings surface coordinate `s` under the laser.
    pub fn s_to_a_deg(&self, s_mm: f64) -> f64 {
        self.spec.angular_zero_deg + self.spec.rotation_sign * s_mm / self.circumference() * 360.0
    }

    /// Surface coordinate `s` under the laser for machine A (deg).
    pub fn a_deg_to_s(&self, a_deg: f64) -> f64 {
        (a_deg - self.spec.angular_zero_deg) * self.spec.rotation_sign / 360.0 * self.circumference()
    }

    /// Machine U (mm) that brings surface coordinate `u` under the galvo field center.
    pub fn u_to_machine_u(&self, u_mm: f64) -> f64 {
        self.spec.axial_zero_mm + u_mm
    }

    pub fn machine_u_to_u(&self, machine_u_mm: f64) -> f64 {
        machine_u_mm - self.spec.axial_zero_mm
    }

    /// `(A_deg, U_mm)` that centers surface point `(u, s)` under the galvo field center.
    pub fn surface_to_machine(&self, u_mm: f64, s_mm: f64) -> (f64, f64) {
        (self.s_to_a_deg(s_mm), self.u_to_machine_u(u_mm))
    }

    /// Splits `s` into (revolution index, s within `[0, C)`) for seam handling.
    pub fn wrap_s(&self, s_mm: f64) -> (i64, f64) {
        let c = self.circumference();
        let rev = (s_mm / c).floor();
        (rev as i64, s_mm - rev * c)
    }

    /// Point in the cylinder's local 3D frame (before the machine pose is applied).
    pub fn surface_to_local(&self, u_mm: f64, s_mm: f64) -> WorldPoint {
        let r = self.radius();
        let phi = s_mm / r;
        [u_mm, r * phi.cos(), r * phi.sin()]
    }

    pub fn local_normal(&self, s_mm: f64) -> WorldPoint {
        let phi = s_mm / self.radius();
        [0.0, phi.cos(), phi.sin()]
    }

    /// Pose of the cylinder group for machine `(A, U)`.
    pub fn pose(&self, a_deg: f64, machine_u_mm: f64) -> CylinderPose {
        let s_top = self.a_deg_to_s(a_deg);
        CylinderPose {
            rotation_x_rad: -(s_top / self.radius()),
            translation_x_mm: -self.machine_u_to_u(machine_u_mm),
        }
    }

    /// Apply a pose to a local point (rotation about X then translation along X).
    pub fn apply_pose(pose: &CylinderPose, p: WorldPoint) -> WorldPoint {
        let (s, c) = pose.rotation_x_rad.sin_cos();
        [p[0] + pose.translation_x_mm, p[1] * c - p[2] * s, p[1] * s + p[2] * c]
    }

    /// Galvo offset (mm, perpendicular to the axis) that hits surface arc offset `ds` from the
    /// top line, for a vertical beam: `d = R sin(ds / R)`.
    pub fn arc_to_galvo_offset(&self, ds_mm: f64) -> f64 {
        let r = self.radius();
        r * (ds_mm / r).sin()
    }

    pub fn galvo_offset_to_arc(&self, d_mm: f64) -> f64 {
        let r = self.radius();
        r * (d_mm / r).clamp(-1.0, 1.0).asin()
    }

    /// Height drop below the focal plane at arc offset `ds` from the top line: `R (1 - cos)`.
    pub fn focus_error_mm(&self, ds_mm: f64) -> f64 {
        let r = self.radius();
        r * (1.0 - (ds_mm / r).cos())
    }

    /// Largest arc half-window keeping the focus error below `max_focus_error_mm`.
    pub fn max_arc_half_window(&self, max_focus_error_mm: f64) -> f64 {
        let r = self.radius();
        let cos_v = (1.0 - max_focus_error_mm / r).clamp(-1.0, 1.0);
        r * cos_v.acos()
    }

    /// Helical coupling: `U = U0 + P * A / 360`.
    pub fn helix_u(u0_mm: f64, pitch_mm_per_rev: f64, a_deg: f64) -> f64 {
        u0_mm + pitch_mm_per_rev * a_deg / 360.0
    }

    /// Radial segment count so the chord error stays below `tolerance_mm`.
    pub fn radial_segments(&self, tolerance_mm: f64) -> u32 {
        let r = self.radius();
        let t = tolerance_mm.clamp(1e-4, r);
        let half_angle = (1.0 - t / r).clamp(-1.0, 1.0).acos();
        let n = (PI / half_angle.max(1e-6)).ceil();
        (n as u32).clamp(24, 512)
    }

    pub fn mesh(&self, tolerance_mm: f64, axial_segments: u32) -> CylinderMesh {
        CylinderMesh::build(self, self.radial_segments(tolerance_mm), axial_segments.max(1))
    }
}

/// Indexed triangle mesh of the cylinder surface in the local frame, with UVs
/// `uv = (u / length, s / C)`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CylinderMesh {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
    pub radial_segments: u32,
    pub axial_segments: u32,
}

impl CylinderMesh {
    fn build(t: &CylinderTransform, radial: u32, axial: u32) -> Self {
        let len = t.spec.length_mm;
        let c = t.circumference();
        let cols = radial + 1;
        let rows = axial + 1;
        let n = (cols * rows) as usize;
        let mut positions = Vec::with_capacity(n * 3);
        let mut normals = Vec::with_capacity(n * 3);
        let mut uvs = Vec::with_capacity(n * 2);
        for j in 0..rows {
            let fu = f64::from(j) / f64::from(axial);
            let u = fu * len;
            for i in 0..cols {
                let fs = f64::from(i) / f64::from(radial);
                let s = fs * c;
                let p = t.surface_to_local(u, s);
                let nrm = t.local_normal(s);
                positions.extend(p.iter().map(|v| *v as f32));
                normals.extend(nrm.iter().map(|v| *v as f32));
                uvs.push(fu as f32);
                uvs.push(fs as f32);
            }
        }
        let mut indices = Vec::with_capacity((radial * axial * 6) as usize);
        for j in 0..axial {
            for i in 0..radial {
                let a = j * cols + i;
                let b = a + 1;
                let d = (j + 1) * cols + i;
                let e = d + 1;
                // Outward-facing winding.
                indices.extend_from_slice(&[a, d, b, b, d, e]);
            }
        }
        Self { positions, normals, uvs, indices, radial_segments: radial, axial_segments: axial }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t30() -> CylinderTransform {
        CylinderTransform::new(CylinderSpec { diameter_mm: 30.0, ..Default::default() })
    }

    #[test]
    fn spec_example_one_wrap() {
        // Spec: 200 x 94.25 mm artwork wraps approximately once around D = 30 mm.
        let t = t30();
        assert!((t.circumference() - 94.247_779_6).abs() < 1e-6);
        assert!((t.s_to_a_deg(94.25) - 360.0).abs() < 0.01);
    }

    #[test]
    fn roundtrip_s_a() {
        let mut t = t30();
        for sign in [1.0, -1.0] {
            t.spec.rotation_sign = sign;
            t.spec.angular_zero_deg = 37.0;
            for s in [-200.0, -1.0, 0.0, 12.3, 94.0, 500.0] {
                assert!((t.a_deg_to_s(t.s_to_a_deg(s)) - s).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn negative_rotation_sign() {
        let mut t = t30();
        t.spec.rotation_sign = -1.0;
        assert!((t.s_to_a_deg(t.circumference() / 4.0) + 90.0).abs() < 1e-9);
    }

    #[test]
    fn multi_revolution_and_seam() {
        let t = t30();
        let c = t.circumference();
        assert!((t.s_to_a_deg(2.5 * c) - 900.0).abs() < 1e-9);
        let (rev, s) = t.wrap_s(2.5 * c);
        assert_eq!(rev, 2);
        assert!((s - 0.5 * c).abs() < 1e-9);
        let (rev, s) = t.wrap_s(-0.25 * c);
        assert_eq!(rev, -1);
        assert!((s - 0.75 * c).abs() < 1e-9);
    }

    #[test]
    fn pose_puts_target_point_on_top() {
        let mut t = t30();
        t.spec.angular_zero_deg = 15.0;
        t.spec.axial_zero_mm = 20.0;
        for (u, s) in [(0.0, 0.0), (35.0, 10.0), (120.0, 80.0), (5.0, -30.0)] {
            let (a, mu) = t.surface_to_machine(u, s);
            let pose = t.pose(a, mu);
            let w = CylinderTransform::apply_pose(&pose, t.surface_to_local(u, s));
            assert!(w[0].abs() < 1e-9, "x = {}", w[0]);
            assert!((w[1] - 15.0).abs() < 1e-9, "y = {}", w[1]);
            assert!(w[2].abs() < 1e-9, "z = {}", w[2]);
        }
    }

    #[test]
    fn galvo_projection_inverse() {
        let t = t30();
        for ds in [-10.0, -1.0, 0.0, 3.0, 10.0] {
            assert!((t.galvo_offset_to_arc(t.arc_to_galvo_offset(ds)) - ds).abs() < 1e-9);
        }
        // Small offsets are nearly linear.
        assert!((t.arc_to_galvo_offset(0.5) - 0.5).abs() < 1e-3);
        let w = t.max_arc_half_window(0.5);
        assert!((t.focus_error_mm(w) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn helix() {
        assert_eq!(CylinderTransform::helix_u(10.0, 2.0, 720.0), 14.0);
        assert_eq!(CylinderTransform::helix_u(10.0, 2.0, -180.0), 9.0);
    }

    #[test]
    fn diameter_change_scales_angle() {
        let a = CylinderTransform::new(CylinderSpec { diameter_mm: 20.0, ..Default::default() });
        let b = CylinderTransform::new(CylinderSpec { diameter_mm: 40.0, ..Default::default() });
        assert!((a.s_to_a_deg(10.0) - 2.0 * b.s_to_a_deg(10.0)).abs() < 1e-9);
    }

    #[test]
    fn mesh_counts_and_adaptive_tessellation() {
        let t = t30();
        let m = t.mesh(0.01, 4);
        let cols = m.radial_segments + 1;
        assert_eq!(m.positions.len() as u32, cols * 5 * 3);
        assert_eq!(m.indices.len() as u32, m.radial_segments * 4 * 6);
        let big = CylinderTransform::new(CylinderSpec { diameter_mm: 200.0, ..Default::default() });
        assert!(big.radial_segments(0.01) > t.radial_segments(0.01));
    }
}
