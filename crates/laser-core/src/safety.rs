//! Machine safety state machine.
//!
//! Every transition is listed explicitly in [`SafetyController::next_state`]. Anything not
//! listed is rejected. Laser emission is only permitted in [`SafetyState::Running`].

use serde::{Deserialize, Serialize};

use crate::{CoreError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SafetyState {
    Disconnected,
    Connected,
    Idle,
    Preparing,
    Ready,
    Armed,
    Running,
    Paused,
    Stopping,
    Fault,
    Estop,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SafetyEvent {
    Connect,
    HandshakeOk,
    Disconnect,
    ConnectionLost { reason: String },
    PrepareJob,
    JobValidated,
    JobRejected { reason: String },
    /// Arming always requires an explicit user action.
    Arm { user_confirmed: bool },
    Disarm,
    Start,
    Pause,
    Resume,
    Stop,
    Stopped,
    Completed,
    Fault { reason: String },
    EmergencyStop { source: String },
    /// Explicit user acknowledgement required after a fault.
    ResetFault { user_confirmed: bool },
    /// After an e-stop the user must confirm the physical stop has been released.
    ResetEstop { user_confirmed: bool, hardware_released: bool },
}

impl SafetyEvent {
    pub fn name(&self) -> &'static str {
        match self {
            SafetyEvent::Connect => "connect",
            SafetyEvent::HandshakeOk => "handshakeOk",
            SafetyEvent::Disconnect => "disconnect",
            SafetyEvent::ConnectionLost { .. } => "connectionLost",
            SafetyEvent::PrepareJob => "prepareJob",
            SafetyEvent::JobValidated => "jobValidated",
            SafetyEvent::JobRejected { .. } => "jobRejected",
            SafetyEvent::Arm { .. } => "arm",
            SafetyEvent::Disarm => "disarm",
            SafetyEvent::Start => "start",
            SafetyEvent::Pause => "pause",
            SafetyEvent::Resume => "resume",
            SafetyEvent::Stop => "stop",
            SafetyEvent::Stopped => "stopped",
            SafetyEvent::Completed => "completed",
            SafetyEvent::Fault { .. } => "fault",
            SafetyEvent::EmergencyStop { .. } => "emergencyStop",
            SafetyEvent::ResetFault { .. } => "resetFault",
            SafetyEvent::ResetEstop { .. } => "resetEstop",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyTransition {
    pub from: SafetyState,
    pub to: SafetyState,
    pub event: String,
    pub detail: Option<String>,
    pub t_s: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyController {
    state: SafetyState,
    last_fault: Option<String>,
    history: Vec<SafetyTransition>,
}

impl Default for SafetyController {
    fn default() -> Self {
        Self::new()
    }
}

impl SafetyController {
    /// Always starts disconnected and disarmed.
    pub fn new() -> Self {
        Self { state: SafetyState::Disconnected, last_fault: None, history: Vec::new() }
    }

    pub fn state(&self) -> SafetyState {
        self.state
    }

    pub fn last_fault(&self) -> Option<&str> {
        self.last_fault.as_deref()
    }

    pub fn history(&self) -> &[SafetyTransition] {
        &self.history
    }

    pub fn is_armed(&self) -> bool {
        matches!(self.state, SafetyState::Armed | SafetyState::Running | SafetyState::Paused)
    }

    /// The single gate for laser emission.
    pub fn laser_permitted(&self) -> bool {
        self.state == SafetyState::Running
    }

    /// Motion of external axes is permitted while running, or when idle/ready for manual jogs.
    pub fn motion_permitted(&self) -> bool {
        matches!(
            self.state,
            SafetyState::Idle | SafetyState::Ready | SafetyState::Armed | SafetyState::Running
        )
    }

    /// Pure transition function. `None` means the transition is not allowed.
    pub fn next_state(state: SafetyState, event: &SafetyEvent) -> Option<SafetyState> {
        use SafetyEvent as E;
        use SafetyState as S;
        // Emergency stop is accepted from every state.
        if let E::EmergencyStop { .. } = event {
            return Some(S::Estop);
        }
        match (state, event) {
            (S::Disconnected, E::Connect) => Some(S::Connected),
            (S::Connected, E::HandshakeOk) => Some(S::Idle),

            // Communication loss during anything hazardous is a fault; otherwise just disconnected.
            (S::Armed | S::Running | S::Paused | S::Stopping, E::ConnectionLost { .. }) => {
                Some(S::Fault)
            }
            (S::Connected | S::Idle | S::Preparing | S::Ready, E::ConnectionLost { .. }) => {
                Some(S::Disconnected)
            }
            (S::Fault, E::ConnectionLost { .. }) => Some(S::Fault),

            // User disconnect is refused while armed or moving.
            (S::Connected | S::Idle | S::Preparing | S::Ready | S::Fault, E::Disconnect) => {
                Some(S::Disconnected)
            }

            (S::Idle, E::PrepareJob) => Some(S::Preparing),
            (S::Ready, E::PrepareJob) => Some(S::Preparing),
            (S::Preparing, E::JobValidated) => Some(S::Ready),
            (S::Preparing, E::JobRejected { .. }) => Some(S::Idle),

            (S::Ready, E::Arm { user_confirmed: true }) => Some(S::Armed),
            (S::Ready, E::Disarm) => Some(S::Idle),
            (S::Armed, E::Disarm) => Some(S::Ready),
            (S::Armed, E::Start) => Some(S::Running),

            (S::Running, E::Pause) => Some(S::Paused),
            (S::Paused, E::Resume) => Some(S::Running),
            (S::Running | S::Paused | S::Armed, E::Stop) => Some(S::Stopping),
            (S::Stopping, E::Stopped) => Some(S::Idle),
            // Completing a job always disarms.
            (S::Running, E::Completed) => Some(S::Idle),

            (
                S::Connected
                | S::Idle
                | S::Preparing
                | S::Ready
                | S::Armed
                | S::Running
                | S::Paused
                | S::Stopping,
                E::Fault { .. },
            ) => Some(S::Fault),
            (S::Fault, E::Fault { .. }) => Some(S::Fault),

            (S::Fault, E::ResetFault { user_confirmed: true }) => Some(S::Idle),
            (S::Estop, E::ResetEstop { user_confirmed: true, hardware_released: true }) => {
                Some(S::Idle)
            }
            _ => None,
        }
    }

    pub fn apply(&mut self, event: SafetyEvent, t_s: f64) -> Result<SafetyTransition> {
        let Some(to) = Self::next_state(self.state, &event) else {
            return Err(CoreError::Safety(format!(
                "transition '{}' not allowed from {:?}",
                event.name(),
                self.state
            )));
        };
        let detail = match &event {
            SafetyEvent::ConnectionLost { reason }
            | SafetyEvent::JobRejected { reason }
            | SafetyEvent::Fault { reason } => Some(reason.clone()),
            SafetyEvent::EmergencyStop { source } => Some(source.clone()),
            _ => None,
        };
        if matches!(to, SafetyState::Fault | SafetyState::Estop) {
            self.last_fault = detail.clone().or_else(|| Some(event.name().to_string()));
        }
        if matches!(event, SafetyEvent::ResetFault { .. } | SafetyEvent::ResetEstop { .. }) {
            self.last_fault = None;
        }
        let transition =
            SafetyTransition { from: self.state, to, event: event.name().into(), detail, t_s };
        tracing::info!(from = ?self.state, to = ?to, event = event.name(), "safety transition");
        self.state = to;
        self.history.push(transition.clone());
        Ok(transition)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use SafetyEvent as E;
    use SafetyState as S;

    fn running() -> SafetyController {
        let mut c = SafetyController::new();
        for e in [
            E::Connect,
            E::HandshakeOk,
            E::PrepareJob,
            E::JobValidated,
            E::Arm { user_confirmed: true },
            E::Start,
        ] {
            c.apply(e, 0.0).unwrap();
        }
        c
    }

    #[test]
    fn starts_disarmed_and_disconnected() {
        let c = SafetyController::new();
        assert_eq!(c.state(), S::Disconnected);
        assert!(!c.is_armed());
        assert!(!c.laser_permitted());
    }

    #[test]
    fn cannot_start_when_disconnected() {
        let mut c = SafetyController::new();
        assert!(c.apply(E::Start, 0.0).is_err());
        assert!(c.apply(E::Arm { user_confirmed: true }, 0.0).is_err());
    }

    #[test]
    fn arm_requires_user_confirmation() {
        let mut c = SafetyController::new();
        for e in [E::Connect, E::HandshakeOk, E::PrepareJob, E::JobValidated] {
            c.apply(e, 0.0).unwrap();
        }
        assert!(c.apply(E::Arm { user_confirmed: false }, 0.0).is_err());
        assert_eq!(c.state(), S::Ready);
    }

    #[test]
    fn laser_only_permitted_while_running() {
        let mut c = running();
        assert!(c.laser_permitted());
        c.apply(E::Pause, 1.0).unwrap();
        assert!(!c.laser_permitted());
    }

    #[test]
    fn connection_loss_while_running_faults() {
        let mut c = running();
        c.apply(E::ConnectionLost { reason: "tcp reset".into() }, 1.0).unwrap();
        assert_eq!(c.state(), S::Fault);
        assert_eq!(c.last_fault(), Some("tcp reset"));
        // Reconnection does not resume anything.
        assert!(c.apply(E::Resume, 2.0).is_err());
        assert!(c.apply(E::Start, 2.0).is_err());
    }

    #[test]
    fn no_automatic_restart_after_estop() {
        let mut c = running();
        c.apply(E::EmergencyStop { source: "ui".into() }, 1.0).unwrap();
        assert_eq!(c.state(), S::Estop);
        for e in [
            E::Resume,
            E::Start,
            E::Arm { user_confirmed: true },
            E::ResetFault { user_confirmed: true },
            E::ResetEstop { user_confirmed: true, hardware_released: false },
        ] {
            assert!(c.apply(e, 2.0).is_err());
        }
        c.apply(E::ResetEstop { user_confirmed: true, hardware_released: true }, 3.0).unwrap();
        assert_eq!(c.state(), S::Idle);
        assert!(!c.is_armed());
    }

    #[test]
    fn completion_disarms() {
        let mut c = running();
        c.apply(E::Completed, 5.0).unwrap();
        assert_eq!(c.state(), S::Idle);
        assert!(!c.is_armed());
    }

    #[test]
    fn disconnect_refused_while_running() {
        let mut c = running();
        assert!(c.apply(E::Disconnect, 1.0).is_err());
    }

    #[test]
    fn estop_accepted_from_every_state() {
        for s in [
            S::Disconnected,
            S::Connected,
            S::Idle,
            S::Preparing,
            S::Ready,
            S::Armed,
            S::Running,
            S::Paused,
            S::Stopping,
            S::Fault,
            S::Estop,
        ] {
            assert_eq!(
                SafetyController::next_state(s, &E::EmergencyStop { source: "t".into() }),
                Some(S::Estop)
            );
        }
    }
}
