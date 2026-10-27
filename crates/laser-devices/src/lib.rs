//! Device abstraction layer (spec section 10).
//!
//! All drivers are poll-based: methods never block on device responses. A command returns
//! once transmitted; its progress is observed through [`CommandStage`] and [`DeviceEvent`]s
//! so that "accepted" and "completed" are never conflated.

pub mod composite;
pub mod external;
pub mod sim_f1;
pub mod xtool_f1;

use std::sync::{Arc, Mutex};
use std::time::Instant;

use laser_core::{LaserSource, Result};
use laser_protocol::ProtocolLog;
use laser_protocol::axis::ControllerStatus;
use serde::Serialize;

pub use composite::CompositeMachineDevice;
pub use external::{ByteLink, ExternalMotionControllerDevice, TcpByteLink};
pub use sim_f1::SimF1Device;
pub use xtool_f1::XToolF1Device;

pub type SharedLog = Arc<Mutex<ProtocolLog>>;

pub fn shared_log() -> SharedLog {
    Arc::new(Mutex::new(ProtocolLog::default()))
}

pub(crate) fn log_push(log: &SharedLog, t: f64, channel: &str, dir: laser_protocol::Direction, text: impl Into<String>) {
    log.lock().unwrap_or_else(|e| e.into_inner()).push(t, channel, dir, text);
}

pub trait Clock: Send {
    fn now(&self) -> f64;
}

impl Clock for laser_simulator::SimClock {
    fn now(&self) -> f64 {
        laser_simulator::SimClock::now(self)
    }
}

pub struct RealClock(Instant);

impl Default for RealClock {
    fn default() -> Self {
        Self(Instant::now())
    }
}

impl Clock for RealClock {
    fn now(&self) -> f64 {
        self.0.elapsed().as_secs_f64()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub galvo: bool,
    pub rotary: bool,
    pub linear: bool,
    pub pause: bool,
    pub machine_info: bool,
    pub laser_sources: Vec<LaserSource>,
    pub simulated: bool,
    /// Real hardware writes possible at all (still subject to the write gate).
    pub hardware_writes: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandStage {
    Prepared,
    Transmitted,
    Accepted,
    Executing,
    Completed,
    Failed,
}

pub type CmdId = u32;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DeviceEventKind {
    Connected,
    Disconnected { reason: String },
    Fault { code: String, message: String },
    Info { message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEvent {
    pub t_s: f64,
    pub device: String,
    #[serde(flatten)]
    pub kind: DeviceEventKind,
}

/// The galvo laser (xTool F1 or its simulation).
pub trait LaserDevice: Send {
    fn name(&self) -> &str;
    fn capabilities(&self) -> Capabilities;
    fn connect(&mut self) -> Result<()>;
    fn disconnect(&mut self);
    fn is_connected(&self) -> bool;
    fn machine_info(&mut self) -> Result<serde_json::Value>;
    /// Mirror of the safety controller's `laser_permitted`. Programs containing emission are
    /// refused while false.
    fn set_emission_permitted(&mut self, permitted: bool);
    fn set_laser_source(&mut self, source: LaserSource);
    /// Transmit a complete program (one execution unit). Returns once transmitted.
    fn send_program(&mut self, lines: &[String]) -> Result<()>;
    /// All lines acknowledged and the device reports it is no longer working.
    fn program_done(&self) -> bool;
    fn program_failed(&self) -> Option<String>;
    fn pause(&mut self) -> Result<()>;
    fn resume(&mut self) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
    fn emergency_stop(&mut self) -> Result<()>;
    fn reset_estop(&mut self) -> Result<()>;
    fn poll(&mut self) -> Vec<DeviceEvent>;
}

/// The external rotary/linear controller.
pub trait AxisDevice: Send {
    fn name(&self) -> &str;
    fn capabilities(&self) -> Capabilities;
    /// Starts the handshake; completion is reported by `is_connected`.
    fn connect(&mut self) -> Result<()>;
    fn disconnect(&mut self);
    fn is_connected(&self) -> bool;
    fn enable(&mut self) -> Result<CmdId>;
    fn disable(&mut self) -> Result<CmdId>;
    fn home_u(&mut self) -> Result<CmdId>;
    fn move_to(&mut self, a_deg: f64, u_mm: f64) -> Result<CmdId>;
    fn request_status(&mut self) -> Result<CmdId>;
    fn stop(&mut self) -> Result<CmdId>;
    fn emergency_stop(&mut self) -> Result<CmdId>;
    fn reset(&mut self) -> Result<CmdId>;
    fn stage(&self, id: CmdId) -> Option<CommandStage>;
    fn command_error(&self, id: CmdId) -> Option<String>;
    fn last_status(&self) -> Option<ControllerStatus>;
    fn poll(&mut self) -> Vec<DeviceEvent>;
}
