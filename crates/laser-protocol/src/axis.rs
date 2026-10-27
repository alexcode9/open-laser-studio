//! OLS external axis controller protocol, version 1 (ESP32-S3 rotary A + linear U).
//!
//! Text frames for debuggability, one per line:
//!
//! ```text
//! @<seq>:<TYPE>[:<payload>]*<CRC16>\n
//! ```
//!
//! - `seq`: decimal u32 chosen by the host; device responses echo it. Unsolicited device
//!   messages (faults, limit events) use `seq` 0.
//! - `CRC16`: CRC-16/CCITT-FALSE over the bytes between `@` and `*`, 4 uppercase hex digits.
//! - Payload: `key=value` pairs separated by `,`.
//!
//! Acceptance and completion are distinct messages: `ACC` (accepted), `STA` (started),
//! `CMP` (completed), `REJ` (rejected), `FLT` (fault). A bare "ok" is never used.
//! Full specification: `docs/protocols/AXIS_CONTROLLER_PROTOCOL.md`.

use crc::{CRC_16_IBM_3740, Crc};
use laser_core::{CoreError, Result};
use serde::Serialize;

pub const PROTOCOL_VERSION: u32 = 1;
const CRC16: Crc<u16> = Crc::<u16>::new(&CRC_16_IBM_3740);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Frame {
    pub seq: u32,
    pub kind: String,
    pub payload: Vec<(String, String)>,
}

impl Frame {
    pub fn new(seq: u32, kind: &str) -> Self {
        Self { seq, kind: kind.into(), payload: Vec::new() }
    }

    pub fn with(mut self, key: &str, value: impl ToString) -> Self {
        self.payload.push((key.into(), value.to_string()));
        self
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.payload.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    pub fn get_f64(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(|v| v.parse().ok())
    }

    fn body(&self) -> String {
        let mut s = format!("{}:{}", self.seq, self.kind);
        if !self.payload.is_empty() {
            s.push(':');
            s.push_str(&self.payload.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(","));
        }
        s
    }

    pub fn encode(&self) -> String {
        let body = self.body();
        format!("@{body}*{:04X}\n", CRC16.checksum(body.as_bytes()))
    }

    pub fn decode(line: &str) -> Result<Frame> {
        let line = line.trim_end_matches(['\r', '\n']);
        let rest = line.strip_prefix('@').ok_or_else(|| CoreError::Protocol(format!("missing '@': {line}")))?;
        let (body, crc) = rest.rsplit_once('*').ok_or_else(|| CoreError::Protocol(format!("missing CRC: {line}")))?;
        let expected = u16::from_str_radix(crc, 16).map_err(|_| CoreError::Protocol(format!("bad CRC field: {line}")))?;
        let actual = CRC16.checksum(body.as_bytes());
        if expected != actual {
            return Err(CoreError::Protocol(format!("CRC mismatch (got {expected:04X}, computed {actual:04X})")));
        }
        let mut parts = body.splitn(3, ':');
        let seq = parts
            .next()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| CoreError::Protocol(format!("bad sequence: {line}")))?;
        let kind = parts.next().filter(|k| !k.is_empty()).ok_or_else(|| CoreError::Protocol("missing type".into()))?;
        let mut frame = Frame::new(seq, kind);
        if let Some(p) = parts.next() {
            for kv in p.split(',').filter(|s| !s.is_empty()) {
                let (k, v) = kv.split_once('=').ok_or_else(|| CoreError::Protocol(format!("bad payload item '{kv}'")))?;
                frame.payload.push((k.into(), v.into()));
            }
        }
        Ok(frame)
    }
}

/// Host → controller requests.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Request {
    Hello,
    Caps,
    Status,
    Enable,
    Disable,
    HomeU,
    /// Absolute move; `None` keeps the axis where it is.
    Move { a_deg: Option<f64>, u_mm: Option<f64> },
    Stop,
    Estop,
    Reset,
}

impl Request {
    pub fn to_frame(&self, seq: u32) -> Frame {
        match self {
            Request::Hello => Frame::new(seq, "HELLO").with("proto", PROTOCOL_VERSION),
            Request::Caps => Frame::new(seq, "CAPS"),
            Request::Status => Frame::new(seq, "STATUS"),
            Request::Enable => Frame::new(seq, "ENABLE"),
            Request::Disable => Frame::new(seq, "DISABLE"),
            Request::HomeU => Frame::new(seq, "HOME").with("axis", "U"),
            Request::Move { a_deg, u_mm } => {
                let mut f = Frame::new(seq, "MOVE");
                if let Some(a) = a_deg {
                    f = f.with("A", format!("{a:.4}"));
                }
                if let Some(u) = u_mm {
                    f = f.with("U", format!("{u:.4}"));
                }
                f
            }
            Request::Stop => Frame::new(seq, "STOP"),
            Request::Estop => Frame::new(seq, "ESTOP"),
            Request::Reset => Frame::new(seq, "RESET"),
        }
    }

    pub fn from_frame(f: &Frame) -> Result<Request> {
        Ok(match f.kind.as_str() {
            "HELLO" => Request::Hello,
            "CAPS" => Request::Caps,
            "STATUS" => Request::Status,
            "ENABLE" => Request::Enable,
            "DISABLE" => Request::Disable,
            "HOME" if f.get("axis") == Some("U") => Request::HomeU,
            "MOVE" => Request::Move { a_deg: f.get_f64("A"), u_mm: f.get_f64("U") },
            "STOP" => Request::Stop,
            "ESTOP" => Request::Estop,
            "RESET" => Request::Reset,
            other => return Err(CoreError::Protocol(format!("unknown request '{other}'"))),
        })
    }

    /// Requests that produce STA/CMP after ACC.
    pub fn is_motion(&self) -> bool {
        matches!(self, Request::HomeU | Request::Move { .. })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ControllerState {
    Disabled,
    Idle,
    Moving,
    Homing,
    Fault,
    Estop,
}

impl ControllerState {
    pub fn as_str(&self) -> &'static str {
        match self {
            ControllerState::Disabled => "DISABLED",
            ControllerState::Idle => "IDLE",
            ControllerState::Moving => "MOVING",
            ControllerState::Homing => "HOMING",
            ControllerState::Fault => "FAULT",
            ControllerState::Estop => "ESTOP",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "DISABLED" => ControllerState::Disabled,
            "IDLE" => ControllerState::Idle,
            "MOVING" => ControllerState::Moving,
            "HOMING" => ControllerState::Homing,
            "FAULT" => ControllerState::Fault,
            "ESTOP" => ControllerState::Estop,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerStatus {
    pub state: ControllerState,
    pub a_deg: f64,
    pub u_mm: f64,
    pub homed: bool,
    pub enabled: bool,
}

/// Controller → host responses.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Response {
    Hello { proto: u32, firmware: String },
    Caps { axes: String, encoder: bool, estop_input: bool },
    Accepted,
    Started,
    Completed { a_deg: f64, u_mm: f64 },
    Rejected { code: String, message: String },
    Fault { code: String, message: String },
    Status(ControllerStatus),
}

impl Response {
    pub fn to_frame(&self, seq: u32) -> Frame {
        match self {
            Response::Hello { proto, firmware } => Frame::new(seq, "HELLO").with("proto", proto).with("fw", firmware),
            Response::Caps { axes, encoder, estop_input } => Frame::new(seq, "CAP")
                .with("axes", axes)
                .with("enc", u8::from(*encoder))
                .with("estop", u8::from(*estop_input)),
            Response::Accepted => Frame::new(seq, "ACC"),
            Response::Started => Frame::new(seq, "STA"),
            Response::Completed { a_deg, u_mm } => {
                Frame::new(seq, "CMP").with("A", format!("{a_deg:.4}")).with("U", format!("{u_mm:.4}"))
            }
            Response::Rejected { code, message } => Frame::new(seq, "REJ").with("code", code).with("msg", message.replace([',', '='], " ")),
            Response::Fault { code, message } => Frame::new(seq, "FLT").with("code", code).with("msg", message.replace([',', '='], " ")),
            Response::Status(s) => Frame::new(seq, "ST")
                .with("state", s.state.as_str())
                .with("A", format!("{:.4}", s.a_deg))
                .with("U", format!("{:.4}", s.u_mm))
                .with("homed", u8::from(s.homed))
                .with("en", u8::from(s.enabled)),
        }
    }

    pub fn from_frame(f: &Frame) -> Result<Response> {
        let s = |k: &str| f.get(k).unwrap_or_default().to_string();
        Ok(match f.kind.as_str() {
            "HELLO" => Response::Hello { proto: f.get("proto").and_then(|v| v.parse().ok()).unwrap_or(0), firmware: s("fw") },
            "CAP" => Response::Caps { axes: s("axes"), encoder: f.get("enc") == Some("1"), estop_input: f.get("estop") == Some("1") },
            "ACC" => Response::Accepted,
            "STA" => Response::Started,
            "CMP" => Response::Completed {
                a_deg: f.get_f64("A").ok_or_else(|| CoreError::Protocol("CMP without A".into()))?,
                u_mm: f.get_f64("U").ok_or_else(|| CoreError::Protocol("CMP without U".into()))?,
            },
            "REJ" => Response::Rejected { code: s("code"), message: s("msg") },
            "FLT" => Response::Fault { code: s("code"), message: s("msg") },
            "ST" => Response::Status(ControllerStatus {
                state: f
                    .get("state")
                    .and_then(ControllerState::parse)
                    .ok_or_else(|| CoreError::Protocol("ST without valid state".into()))?,
                a_deg: f.get_f64("A").unwrap_or(f64::NAN),
                u_mm: f.get_f64("U").unwrap_or(f64::NAN),
                homed: f.get("homed") == Some("1"),
                enabled: f.get("en") == Some("1"),
            }),
            other => return Err(CoreError::Protocol(format!("unknown response '{other}'"))),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LineFramer;

    #[test]
    fn encode_decode_roundtrip() {
        let f = Request::Move { a_deg: Some(90.0), u_mm: Some(12.5) }.to_frame(7);
        let line = f.encode();
        assert!(line.starts_with("@7:MOVE:A=90.0000,U=12.5000*"));
        let back = Frame::decode(&line).unwrap();
        assert_eq!(back, f);
        assert_eq!(Request::from_frame(&back).unwrap(), Request::Move { a_deg: Some(90.0), u_mm: Some(12.5) });
    }

    #[test]
    fn corrupted_frame_rejected() {
        let mut line = Response::Completed { a_deg: 1.0, u_mm: 2.0 }.to_frame(3).encode();
        line = line.replace("U=2", "U=3");
        assert!(matches!(Frame::decode(&line), Err(CoreError::Protocol(m)) if m.contains("CRC")));
        assert!(Frame::decode("garbage").is_err());
        assert!(Frame::decode("@1:ACC*ZZZZ").is_err());
    }

    #[test]
    fn responses_roundtrip() {
        let all = [
            Response::Hello { proto: 1, firmware: "0.1.0".into() },
            Response::Caps { axes: "A U".into(), encoder: false, estop_input: true },
            Response::Accepted,
            Response::Started,
            Response::Completed { a_deg: -45.5, u_mm: 100.0 },
            Response::Rejected { code: "LIMIT".into(), message: "U out of range".into() },
            Response::Fault { code: "DRIVER".into(), message: "overtemp".into() },
            Response::Status(ControllerStatus { state: ControllerState::Moving, a_deg: 1.0, u_mm: 2.0, homed: true, enabled: true }),
        ];
        for r in all {
            let f = Frame::decode(&r.to_frame(9).encode()).unwrap();
            assert_eq!(f.seq, 9);
            assert_eq!(Response::from_frame(&f).unwrap(), r);
        }
    }

    #[test]
    fn framing_partial_reads() {
        let a = Response::Accepted.to_frame(1).encode();
        let b = Response::Started.to_frame(1).encode();
        let stream = format!("{a}{b}");
        let (x, y) = stream.as_bytes().split_at(5);
        let mut fr = LineFramer::new(256);
        let mut lines = fr.push(x);
        assert!(lines.is_empty());
        lines.extend(fr.push(y));
        assert_eq!(lines.len(), 2);
        assert_eq!(Response::from_frame(&Frame::decode(&lines[1]).unwrap()).unwrap(), Response::Started);
    }
}
