use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Axis {
    /// Galvo X (mm in the marking field).
    Gx,
    /// Galvo Y (mm in the marking field).
    Gy,
    /// Workpiece rotation (degrees).
    A,
    /// Axial translation (mm).
    U,
}

/// Full four-coordinate machine position.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachinePosition {
    pub gx_mm: f64,
    pub gy_mm: f64,
    pub a_deg: f64,
    pub u_mm: f64,
}

impl MachinePosition {
    pub const fn new(gx_mm: f64, gy_mm: f64, a_deg: f64, u_mm: f64) -> Self {
        Self { gx_mm, gy_mm, a_deg, u_mm }
    }

    pub fn lerp(&self, other: &MachinePosition, t: f64) -> MachinePosition {
        MachinePosition {
            gx_mm: self.gx_mm + (other.gx_mm - self.gx_mm) * t,
            gy_mm: self.gy_mm + (other.gy_mm - self.gy_mm) * t,
            a_deg: self.a_deg + (other.a_deg - self.a_deg) * t,
            u_mm: self.u_mm + (other.u_mm - self.u_mm) * t,
        }
    }

    pub fn galvo_distance(&self, other: &MachinePosition) -> f64 {
        (other.gx_mm - self.gx_mm).hypot(other.gy_mm - self.gy_mm)
    }

    pub fn get(&self, axis: Axis) -> f64 {
        match axis {
            Axis::Gx => self.gx_mm,
            Axis::Gy => self.gy_mm,
            Axis::A => self.a_deg,
            Axis::U => self.u_mm,
        }
    }
}
