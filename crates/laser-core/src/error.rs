use serde::Serialize;

/// Structured error shared across crates. `code()` is stable and is surfaced to the UI.
#[derive(Debug, thiserror::Error, Clone, PartialEq, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum CoreError {
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("out of bounds: {0}")]
    OutOfBounds(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("safety interlock: {0}")]
    Safety(String),
    #[error("communication: {0}")]
    Communication(String),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("device fault: {0}")]
    DeviceFault(String),
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("io: {0}")]
    Io(String),
    #[error("parse: {0}")]
    Parse(String),
}

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            CoreError::InvalidArgument(_) => "INVALID_ARGUMENT",
            CoreError::OutOfBounds(_) => "OUT_OF_BOUNDS",
            CoreError::Unsupported(_) => "UNSUPPORTED",
            CoreError::Safety(_) => "SAFETY",
            CoreError::Communication(_) => "COMMUNICATION",
            CoreError::Timeout(_) => "TIMEOUT",
            CoreError::DeviceFault(_) => "DEVICE_FAULT",
            CoreError::Protocol(_) => "PROTOCOL",
            CoreError::Io(_) => "IO",
            CoreError::Parse(_) => "PARSE",
        }
    }
}

impl From<std::io::Error> for CoreError {
    fn from(value: std::io::Error) -> Self {
        match value.kind() {
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
                CoreError::Timeout(value.to_string())
            }
            _ => CoreError::Io(value.to_string()),
        }
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(value: serde_json::Error) -> Self {
        CoreError::Parse(value.to_string())
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
