//! G-code engine.
//!
//! Layers are kept separate:
//! - [`parser`]: generic syntax (words, comments, `$` specials). No semantics.
//! - [`ir`]: interpretation into commands with modal state; unknown codes are preserved.
//! - [`dialect`]: machine-specific allowlists and classification (F1, external controller).
//! - [`format`]: deterministic text output.
//! - [`analyze`]: bounds / distance / time analysis.

pub mod analyze;
pub mod dialect;
pub mod format;
pub mod ir;
pub mod parser;

pub use analyze::{Analysis, analyze};
pub use dialect::{CommandClass, Diagnostic, Dialect, Severity, classify, validate};
pub use format::{fmt_num, format_block};
pub use ir::{Command, interpret};
pub use parser::{Block, Code, parse, parse_line};
