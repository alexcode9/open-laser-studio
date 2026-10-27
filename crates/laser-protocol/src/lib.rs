//! Wire protocols and transports. Business logic (jobs, safety decisions) lives elsewhere.

pub mod axis;
pub mod f1;
pub mod framing;
pub mod gate;
pub mod log;

pub use framing::LineFramer;
pub use gate::{WriteGate, check_lines};
pub use log::{Direction, ProtocolLog, ProtocolLogEntry};
