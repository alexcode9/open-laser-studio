//! Machine profiles. No mechanical value is hardcoded in application logic; everything
//! here is configuration that the user can edit, export and import.

use serde::{Deserialize, Serialize};

use crate::{CoreError, Result};

/// Common derived quantities for stepper-driven axes.
pub trait AxisConfig {
    /// Microsteps per user unit (mm for linear, degree for rotary).
    fn steps_per_unit(&self) -> f64;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GalvoConfig {
    pub field_width_mm: f64,
    pub field_height_mm: f64,
    /// Field position used as the "center" when mapping local sections.
    pub center_x_mm: f64,
    pub center_y_mm: f64,
    pub invert_x: bool,
    pub invert_y: bool,
    /// Rotation of the galvo field relative to the cylinder axis (degrees).
    pub rotation_deg: f64,
    /// Mark speed ceiling used for estimates. Placeholder until measured.
    pub max_mark_speed_mm_s: f64,
    pub max_travel_speed_mm_s: f64,
}

impl Default for GalvoConfig {
    fn default() -> Self {
        // F1 field ~120 x 120 mm (BeamInk StageConfig, DOCUMENTED). Speeds are placeholders.
        Self {
            field_width_mm: 115.0,
            field_height_mm: 115.0,
            center_x_mm: 57.5,
            center_y_mm: 57.5,
            invert_x: false,
            invert_y: false,
            rotation_deg: 0.0,
            max_mark_speed_mm_s: 4000.0,
            max_travel_speed_mm_s: 3000.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RotaryAxisConfig {
    pub enabled: bool,
    pub motor_steps_per_rev: u32,
    pub microsteps: u32,
    /// Motor revolutions per workpiece revolution (3.0 for a 3:1 belt reduction).
    pub gear_ratio: f64,
    pub direction_inverted: bool,
    pub home_offset_deg: f64,
    pub max_velocity_deg_s: f64,
    pub max_accel_deg_s2: f64,
    pub backlash_deg: f64,
    pub encoder_counts_per_rev: Option<u32>,
    pub index_input: bool,
}

impl Default for RotaryAxisConfig {
    fn default() -> Self {
        // Spec section 13 example: NEMA 17, 3:1 belt. Velocity/accel are placeholders.
        Self {
            enabled: true,
            motor_steps_per_rev: 200,
            microsteps: 16,
            gear_ratio: 3.0,
            direction_inverted: false,
            home_offset_deg: 0.0,
            max_velocity_deg_s: 180.0,
            max_accel_deg_s2: 720.0,
            backlash_deg: 0.0,
            encoder_counts_per_rev: None,
            index_input: false,
        }
    }
}

impl AxisConfig for RotaryAxisConfig {
    fn steps_per_unit(&self) -> f64 {
        f64::from(self.motor_steps_per_rev) * f64::from(self.microsteps) * self.gear_ratio / 360.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LinearAxisConfig {
    pub enabled: bool,
    pub motor_steps_per_rev: u32,
    pub microsteps: u32,
    /// Leadscrew lead in mm per screw revolution (TR8x2 = 2 mm).
    pub leadscrew_pitch_mm: f64,
    /// Motor revolutions per screw revolution.
    pub gear_ratio: f64,
    pub direction_inverted: bool,
    pub home_offset_mm: f64,
    pub travel_min_mm: f64,
    pub travel_max_mm: f64,
    pub max_velocity_mm_s: f64,
    pub max_accel_mm_s2: f64,
    pub backlash_mm: f64,
    pub limit_switch_active_low: bool,
    pub encoder_counts_per_mm: Option<f64>,
}

impl Default for LinearAxisConfig {
    fn default() -> Self {
        // Spec section 13 example: NEMA 17, TR8x2, MGN12H, ~200 mm travel.
        Self {
            enabled: true,
            motor_steps_per_rev: 200,
            microsteps: 16,
            leadscrew_pitch_mm: 2.0,
            gear_ratio: 1.0,
            direction_inverted: false,
            home_offset_mm: 0.0,
            travel_min_mm: 0.0,
            travel_max_mm: 200.0,
            max_velocity_mm_s: 10.0,
            max_accel_mm_s2: 50.0,
            backlash_mm: 0.0,
            limit_switch_active_low: true,
            encoder_counts_per_mm: None,
        }
    }
}

impl AxisConfig for LinearAxisConfig {
    fn steps_per_unit(&self) -> f64 {
        f64::from(self.motor_steps_per_rev) * f64::from(self.microsteps) * self.gear_ratio
            / self.leadscrew_pitch_mm
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MachineProfile {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub device_kind: String,
    /// Host/ports are configuration, never hardcoded in logic.
    pub host: String,
    pub tcp_port: u16,
    pub http_port: u16,
    pub galvo: GalvoConfig,
    pub rotary: RotaryAxisConfig,
    pub linear: LinearAxisConfig,
    /// Settling time after an external move before the F1 section may start.
    pub external_settle_s: f64,
    /// True only once velocity/acceleration limits have been measured on hardware.
    pub limits_validated: bool,
    pub notes: String,
}

impl Default for MachineProfile {
    fn default() -> Self {
        Self {
            schema_version: 1,
            id: "xtool-f1-rotary-linear".into(),
            name: "xTool F1 + rotary/linear attachment".into(),
            device_kind: "composite".into(),
            host: "201.234.3.1".into(),
            tcp_port: 8780,
            http_port: 8080,
            galvo: GalvoConfig::default(),
            rotary: RotaryAxisConfig::default(),
            linear: LinearAxisConfig::default(),
            external_settle_s: 0.25,
            limits_validated: false,
            notes: "Example values from the project specification. Velocity and acceleration \
                    limits are placeholders until measured."
                .into(),
        }
    }
}

impl MachineProfile {
    pub fn validate(&self) -> Result<()> {
        let g = &self.galvo;
        if g.field_width_mm <= 0.0 || g.field_height_mm <= 0.0 {
            return Err(CoreError::InvalidArgument("galvo field must be positive".into()));
        }
        if self.linear.leadscrew_pitch_mm <= 0.0 {
            return Err(CoreError::InvalidArgument("leadscrew pitch must be positive".into()));
        }
        if self.linear.travel_max_mm <= self.linear.travel_min_mm {
            return Err(CoreError::InvalidArgument("linear travel max must exceed min".into()));
        }
        if self.rotary.gear_ratio <= 0.0 || self.linear.gear_ratio <= 0.0 {
            return Err(CoreError::InvalidArgument("gear ratio must be positive".into()));
        }
        for (name, v) in [
            ("rotary max velocity", self.rotary.max_velocity_deg_s),
            ("rotary max accel", self.rotary.max_accel_deg_s2),
            ("linear max velocity", self.linear.max_velocity_mm_s),
            ("linear max accel", self.linear.max_accel_mm_s2),
            ("galvo mark speed", g.max_mark_speed_mm_s),
            ("galvo travel speed", g.max_travel_speed_mm_s),
        ] {
            if v.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
                return Err(CoreError::InvalidArgument(format!("{name} must be positive")));
            }
        }
        Ok(())
    }

    pub fn to_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(self)?)
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let profile: MachineProfile = serde_json::from_str(json)?;
        profile.validate()?;
        Ok(profile)
    }
}

/// Workpiece cylinder. Coordinates: `u` axial (mm), `s` circumferential surface distance (mm).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CylinderSpec {
    pub diameter_mm: f64,
    pub length_mm: f64,
    /// A angle (degrees) at which surface coordinate s = 0 is under the laser (seam position).
    pub angular_zero_deg: f64,
    /// U position (mm) at which surface coordinate u = 0 is under the galvo field center.
    pub axial_zero_mm: f64,
    /// +1: positive A brings increasing s under the laser. -1 reverses.
    pub rotation_sign: f64,
}

impl Default for CylinderSpec {
    fn default() -> Self {
        Self {
            diameter_mm: 30.0,
            length_mm: 200.0,
            angular_zero_deg: 0.0,
            axial_zero_mm: 0.0,
            rotation_sign: 1.0,
        }
    }
}

impl CylinderSpec {
    pub fn radius_mm(&self) -> f64 {
        self.diameter_mm / 2.0
    }

    pub fn circumference_mm(&self) -> f64 {
        std::f64::consts::PI * self.diameter_mm
    }

    pub fn validate(&self) -> Result<()> {
        if !self.diameter_mm.is_finite() || self.diameter_mm <= 0.0 {
            return Err(CoreError::InvalidArgument("cylinder diameter must be positive".into()));
        }
        if !self.length_mm.is_finite() || self.length_mm <= 0.0 {
            return Err(CoreError::InvalidArgument("cylinder length must be positive".into()));
        }
        if self.rotation_sign != 1.0 && self.rotation_sign != -1.0 {
            return Err(CoreError::InvalidArgument("rotation sign must be +1 or -1".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_is_valid_and_roundtrips() {
        let p = MachineProfile::default();
        p.validate().unwrap();
        let back = MachineProfile::from_json(&p.to_json().unwrap()).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn steps_per_unit_matches_mechanics() {
        let r = RotaryAxisConfig::default();
        // 200 * 16 * 3 / 360 = 26.666...
        assert!((r.steps_per_unit() - 26.666_666_666).abs() < 1e-6);
        let l = LinearAxisConfig::default();
        // 200 * 16 / 2 = 1600 steps/mm
        assert!((l.steps_per_unit() - 1600.0).abs() < 1e-9);
    }

    #[test]
    fn invalid_profile_rejected() {
        let mut p = MachineProfile::default();
        p.linear.travel_max_mm = -1.0;
        assert!(p.validate().is_err());
        let mut p = MachineProfile::default();
        p.rotary.max_accel_deg_s2 = 0.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn partial_json_uses_defaults() {
        let p = MachineProfile::from_json(r#"{"name":"x"}"#).unwrap();
        assert_eq!(p.name, "x");
        assert_eq!(p.linear.leadscrew_pitch_mm, 2.0);
    }
}
