//! Jobs: an executable job is a sequence of units. Each unit is "move the external axes,
//! wait for verified completion, settle, then run one F1 program". The runner is poll-based
//! and never assumes a command completed because it was sent.

pub mod job;
pub mod runner;
pub mod session;

pub use job::{Job, JobUnit};
pub use runner::{JobLogEntry, JobOutcome, JobRunner, JobStep, RunnerSignal};
pub use session::{PrepareReport, SessionSnapshot, SimSession};
