//! Software-only machine simulator.
//!
//! Everything advances on a monotonic simulated clock ([`SimWorld::step`]); wall-clock time is
//! never used, so runs are deterministic and repeatable.

pub mod axis_ctrl;
pub mod f1;
pub mod kinematic;
pub mod link;
pub mod timeline;
pub mod world;

pub use axis_ctrl::VirtualAxisController;
pub use f1::{F1State, VirtualF1};
pub use kinematic::kinematic_timeline;
pub use link::{ControlChannel, F1Control, F1StatusCell, F1StatusSnapshot, HostEnd, SimClock};
pub use timeline::{Sample, Timeline, TimelineEvent, TimelineExport};
pub use world::{Injection, InjectionKind, SimConfig, SimHandles, SimWorld};
