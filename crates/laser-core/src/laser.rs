use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LaserSource {
    /// 455 nm blue diode.
    Blue,
    /// 1064 nm infrared.
    Ir,
}

/// Static description of a laser source. Values describe what is *known*, not what is safe.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaserSourceInfo {
    pub id: LaserSource,
    pub label: String,
    pub wavelength_nm: u32,
    pub nominal_power_w: f64,
    pub available: bool,
    /// Device power command range (F1: S0..S1000, DOCUMENTED by BeamInk usage).
    pub power_command_max: u32,
    pub capabilities: Vec<String>,
    pub known_limitations: Vec<String>,
    /// Whether the source-select command has been validated on hardware by this project.
    pub select_command_verified: bool,
}

impl LaserSourceInfo {
    pub fn f1_defaults() -> Vec<LaserSourceInfo> {
        vec![
            LaserSourceInfo {
                id: LaserSource::Blue,
                label: "Blue diode (455 nm)".into(),
                wavelength_nm: 455,
                nominal_power_w: 10.0,
                available: true,
                power_command_max: 1000,
                capabilities: vec!["vector".into(), "fill".into(), "raster".into()],
                known_limitations: vec![
                    "Poor absorption on bare metals and clear materials".into(),
                ],
                select_command_verified: false,
            },
            LaserSourceInfo {
                id: LaserSource::Ir,
                label: "Infrared (1064 nm)".into(),
                wavelength_nm: 1064,
                nominal_power_w: 2.0,
                available: true,
                power_command_max: 1000,
                capabilities: vec!["vector".into(), "fill".into(), "raster".into()],
                known_limitations: vec![
                    "xTool documents preheating below 25 C".into(),
                    "Invisible beam".into(),
                ],
                select_command_verified: false,
            },
        ]
    }
}
