//! Geometry engine. Independent of any UI framework and of hardware.

pub mod affine;
pub mod bounds;
pub mod cylinder;
pub mod frame3;
pub mod path;
pub mod shapes;

pub use affine::Affine2;
pub use bounds::Bounds;
pub use cylinder::{CylinderMesh, CylinderTransform, WorldPoint};
pub use frame3::{AlignParams, AlignResult, Mat4, align_axis_to_rotary};
pub use path::{PathCmd, Polyline, flatten};

#[derive(Debug, Clone, Copy, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn distance(&self, other: &Point) -> f64 {
        (other.x - self.x).hypot(other.y - self.y)
    }

    pub fn lerp(&self, other: &Point, t: f64) -> Point {
        Point::new(self.x + (other.x - self.x) * t, self.y + (other.y - self.y) * t)
    }
}
