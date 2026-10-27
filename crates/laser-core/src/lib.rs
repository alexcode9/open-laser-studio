//! Core domain types shared by every Open Laser Studio crate.
//!
//! Units are explicit in field names: `_mm`, `_deg`, `_rad`, `_mm_s`, `_s`, `_pct`.

pub mod error;
pub mod laser;
pub mod position;
pub mod profile;
pub mod safety;

pub use error::{CoreError, Result};
pub use laser::{LaserSource, LaserSourceInfo};
pub use position::{Axis, MachinePosition};
pub use profile::{
    AxisConfig, CylinderSpec, GalvoConfig, LinearAxisConfig, MachineProfile, RotaryAxisConfig,
};
pub use safety::{SafetyController, SafetyEvent, SafetyState, SafetyTransition};

/// Version of the native API exposed to the desktop app. Bump on breaking IPC changes.
pub const NATIVE_API_VERSION: u32 = 1;
