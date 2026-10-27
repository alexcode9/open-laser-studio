//! Host-side driver for the OLS external axis controller (protocol v1, see
//! `laser_protocol::axis`). Generic over the byte link so the same code drives the simulator,
//! a TCP bridge or (later) a USB serial port.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpStream;

use laser_core::{CoreError, Result};
use laser_protocol::axis::{ControllerStatus, Frame, PROTOCOL_VERSION, Request, Response};
use laser_protocol::{Direction, LineFramer};
use laser_simulator::HostEnd;

use crate::{AxisDevice, Capabilities, Clock, CmdId, CommandStage, DeviceEvent, DeviceEventKind, SharedLog, log_push};

const CH: &str = "axis";

pub trait ByteLink: Send {
    fn write(&mut self, data: &[u8]) -> Result<()>;
    fn read(&mut self) -> Result<Vec<u8>>;
    fn is_up(&self) -> bool;
}

impl ByteLink for HostEnd {
    fn write(&mut self, data: &[u8]) -> Result<()> {
        if HostEnd::write(self, data) { Ok(()) } else { Err(CoreError::Communication("link down".into())) }
    }

    fn read(&mut self) -> Result<Vec<u8>> {
        if !HostEnd::is_up(self) {
            return Err(CoreError::Communication("link down".into()));
        }
        Ok(HostEnd::read(self))
    }

    fn is_up(&self) -> bool {
        HostEnd::is_up(self)
    }
}

/// Non-blocking TCP link (e.g. a Wi-Fi/serial bridge to the controller).
pub struct TcpByteLink {
    stream: Option<TcpStream>,
}

impl TcpByteLink {
    pub fn connect(addr: &str, timeout_ms: u64) -> Result<Self> {
        let sa = std::net::ToSocketAddrs::to_socket_addrs(addr)?
            .next()
            .ok_or_else(|| CoreError::Communication(format!("cannot resolve {addr}")))?;
        let s = TcpStream::connect_timeout(&sa, std::time::Duration::from_millis(timeout_ms))
            .map_err(|e| CoreError::Communication(format!("connect {addr}: {e}")))?;
        s.set_nonblocking(true)?;
        s.set_nodelay(true)?;
        Ok(Self { stream: Some(s) })
    }
}

impl ByteLink for TcpByteLink {
    fn write(&mut self, data: &[u8]) -> Result<()> {
        let s = self.stream.as_mut().ok_or_else(|| CoreError::Communication("link down".into()))?;
        s.write_all(data).map_err(|e| {
            self.stream = None;
            CoreError::Communication(format!("write: {e}"))
        })
    }

    fn read(&mut self) -> Result<Vec<u8>> {
        let s = self.stream.as_mut().ok_or_else(|| CoreError::Communication("link down".into()))?;
        let mut buf = vec![0u8; 4096];
        match s.read(&mut buf) {
            Ok(0) => {
                self.stream = None;
                Err(CoreError::Communication("closed by peer".into()))
            }
            Ok(n) => {
                buf.truncate(n);
                Ok(buf)
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(Vec::new()),
            Err(e) => {
                self.stream = None;
                Err(CoreError::Communication(format!("read: {e}")))
            }
        }
    }

    fn is_up(&self) -> bool {
        self.stream.is_some()
    }
}

#[derive(Debug, Clone)]
struct CmdRecord {
    request: Request,
    stage: CommandStage,
    error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Handshake {
    None,
    Pending(CmdId),
    Done,
}

pub struct ExternalMotionControllerDevice<L: ByteLink, C: Clock> {
    link: L,
    clock: C,
    log: SharedLog,
    framer: LineFramer,
    next_seq: u32,
    cmds: BTreeMap<CmdId, CmdRecord>,
    handshake: Handshake,
    pub firmware: Option<String>,
    status: Option<ControllerStatus>,
    lost_reported: bool,
}

impl<L: ByteLink, C: Clock> ExternalMotionControllerDevice<L, C> {
    pub fn new(link: L, clock: C, log: SharedLog) -> Self {
        Self {
            link,
            clock,
            log,
            framer: LineFramer::new(512),
            next_seq: 1,
            cmds: BTreeMap::new(),
            handshake: Handshake::None,
            firmware: None,
            status: None,
            lost_reported: false,
        }
    }

    fn send(&mut self, req: Request) -> Result<CmdId> {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.wrapping_add(1).max(1);
        let line = req.to_frame(seq).encode();
        let t = self.clock.now();
        self.cmds.insert(seq, CmdRecord { request: req, stage: CommandStage::Prepared, error: None });
        if let Err(e) = self.link.write(line.as_bytes()) {
            log_push(&self.log, t, CH, Direction::Error, format!("write failed: {e}"));
            let r = self.cmds.get_mut(&seq).expect("inserted");
            r.stage = CommandStage::Failed;
            r.error = Some(e.to_string());
            return Err(e);
        }
        log_push(&self.log, t, CH, Direction::Tx, line.trim_end().to_string());
        self.cmds.get_mut(&seq).expect("inserted").stage = CommandStage::Transmitted;
        // Keep the table bounded.
        while self.cmds.len() > 256 {
            let first = *self.cmds.keys().next().expect("non-empty");
            self.cmds.remove(&first);
        }
        Ok(seq)
    }

    fn require_connected(&self) -> Result<()> {
        if self.handshake == Handshake::Done { Ok(()) } else { Err(CoreError::Communication("axis controller not connected".into())) }
    }

    fn on_response(&mut self, seq: u32, r: Response, t: f64, ev: &mut Vec<DeviceEvent>) {
        if let Response::Fault { code, message } = &r {
            for c in self.cmds.values_mut() {
                if matches!(c.stage, CommandStage::Accepted | CommandStage::Executing | CommandStage::Transmitted) {
                    c.stage = CommandStage::Failed;
                    c.error = Some(format!("fault {code}"));
                }
            }
            ev.push(DeviceEvent {
                t_s: t,
                device: "axis".into(),
                kind: DeviceEventKind::Fault { code: code.clone(), message: message.clone() },
            });
            return;
        }
        let Some(cmd) = self.cmds.get_mut(&seq) else {
            log_push(&self.log, t, CH, Direction::Error, format!("response for unknown seq {seq}"));
            return;
        };
        let motion = cmd.request.is_motion();
        match r {
            Response::Hello { proto, firmware } => {
                cmd.stage = CommandStage::Completed;
                if proto == PROTOCOL_VERSION {
                    self.firmware = Some(firmware.clone());
                    self.handshake = Handshake::Done;
                    ev.push(DeviceEvent { t_s: t, device: "axis".into(), kind: DeviceEventKind::Connected });
                } else {
                    cmd.stage = CommandStage::Failed;
                    cmd.error = Some(format!("protocol {proto} unsupported"));
                    self.handshake = Handshake::None;
                    ev.push(DeviceEvent {
                        t_s: t,
                        device: "axis".into(),
                        kind: DeviceEventKind::Fault { code: "PROTO".into(), message: format!("controller speaks protocol {proto}, host {PROTOCOL_VERSION}") },
                    });
                }
            }
            Response::Accepted => cmd.stage = if motion { CommandStage::Accepted } else { CommandStage::Completed },
            Response::Started => cmd.stage = CommandStage::Executing,
            Response::Completed { a_deg, u_mm } => {
                cmd.stage = CommandStage::Completed;
                if let Some(s) = self.status.as_mut() {
                    s.a_deg = a_deg;
                    s.u_mm = u_mm;
                }
            }
            Response::Rejected { code, message } => {
                cmd.stage = CommandStage::Failed;
                cmd.error = Some(format!("{code}: {message}"));
            }
            Response::Status(st) => {
                cmd.stage = CommandStage::Completed;
                self.status = Some(st);
            }
            Response::Caps { .. } => cmd.stage = CommandStage::Completed,
            Response::Fault { .. } => unreachable!("handled above"),
        }
    }
}

impl<L: ByteLink, C: Clock> AxisDevice for ExternalMotionControllerDevice<L, C> {
    fn name(&self) -> &str {
        "OLS external axis controller"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities { rotary: true, linear: true, ..Default::default() }
    }

    fn connect(&mut self) -> Result<()> {
        self.lost_reported = false;
        let id = self.send(Request::Hello)?;
        self.handshake = Handshake::Pending(id);
        self.send(Request::Status)?;
        Ok(())
    }

    fn disconnect(&mut self) {
        self.handshake = Handshake::None;
        log_push(&self.log, self.clock.now(), CH, Direction::Info, "disconnected");
    }

    fn is_connected(&self) -> bool {
        self.handshake == Handshake::Done && self.link.is_up()
    }

    fn enable(&mut self) -> Result<CmdId> {
        self.require_connected()?;
        self.send(Request::Enable)
    }

    fn disable(&mut self) -> Result<CmdId> {
        self.require_connected()?;
        self.send(Request::Disable)
    }

    fn home_u(&mut self) -> Result<CmdId> {
        self.require_connected()?;
        self.send(Request::HomeU)
    }

    fn move_to(&mut self, a_deg: f64, u_mm: f64) -> Result<CmdId> {
        self.require_connected()?;
        if !a_deg.is_finite() || !u_mm.is_finite() {
            return Err(CoreError::InvalidArgument("non-finite axis target".into()));
        }
        self.send(Request::Move { a_deg: Some(a_deg), u_mm: Some(u_mm) })
    }

    fn request_status(&mut self) -> Result<CmdId> {
        self.require_connected()?;
        self.send(Request::Status)
    }

    fn stop(&mut self) -> Result<CmdId> {
        self.send(Request::Stop)
    }

    fn emergency_stop(&mut self) -> Result<CmdId> {
        self.send(Request::Estop)
    }

    fn reset(&mut self) -> Result<CmdId> {
        self.send(Request::Reset)
    }

    fn stage(&self, id: CmdId) -> Option<CommandStage> {
        self.cmds.get(&id).map(|c| c.stage)
    }

    fn command_error(&self, id: CmdId) -> Option<String> {
        self.cmds.get(&id).and_then(|c| c.error.clone())
    }

    fn last_status(&self) -> Option<ControllerStatus> {
        self.status.clone()
    }

    fn poll(&mut self) -> Vec<DeviceEvent> {
        let t = self.clock.now();
        let mut ev = Vec::new();
        let bytes = match self.link.read() {
            Ok(b) => b,
            Err(e) => {
                if self.handshake != Handshake::None && !self.lost_reported {
                    self.lost_reported = true;
                    self.handshake = Handshake::None;
                    log_push(&self.log, t, CH, Direction::Error, format!("connection lost: {e}"));
                    ev.push(DeviceEvent {
                        t_s: t,
                        device: "axis".into(),
                        kind: DeviceEventKind::Disconnected { reason: format!("axis controller link lost: {e}") },
                    });
                }
                return ev;
            }
        };
        for line in self.framer.push(&bytes) {
            log_push(&self.log, t, CH, Direction::Rx, line.clone());
            let decoded = Frame::decode(&line).and_then(|f| Response::from_frame(&f).map(|r| (f.seq, r)));
            match decoded {
                Ok((seq, r)) => self.on_response(seq, r, t, &mut ev),
                Err(e) => log_push(&self.log, t, CH, Direction::Error, format!("bad frame: {e}")),
            }
        }
        ev
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_log;
    use laser_core::MachineProfile;
    use laser_simulator::{SimConfig, SimWorld};

    fn wait<F: FnMut(&mut dyn AxisDevice) -> bool>(w: &mut SimWorld, d: &mut dyn AxisDevice, mut f: F, max_s: f64) -> bool {
        let t0 = w.now();
        while w.now() - t0 < max_s {
            w.step(0.005);
            d.poll();
            if f(d) {
                return true;
            }
        }
        false
    }

    #[test]
    fn handshake_home_move_through_sim_link() {
        let mut w = SimWorld::new(&MachineProfile::default(), SimConfig::default());
        let h = w.handles();
        let mut d = ExternalMotionControllerDevice::new(h.axis_link.clone(), h.clock.clone(), shared_log());
        assert!(d.move_to(1.0, 1.0).is_err());
        d.connect().unwrap();
        assert!(wait(&mut w, &mut d, |d| d.is_connected(), 1.0));
        let id = d.enable().unwrap();
        assert!(wait(&mut w, &mut d, |d| d.stage(id) == Some(CommandStage::Completed), 1.0));
        let id = d.home_u().unwrap();
        assert!(wait(&mut w, &mut d, |d| d.stage(id) == Some(CommandStage::Executing), 1.0));
        assert!(wait(&mut w, &mut d, |d| d.stage(id) == Some(CommandStage::Completed), 20.0));
        let id = d.move_to(90.0, 25.0).unwrap();
        assert!(wait(&mut w, &mut d, |d| d.stage(id) == Some(CommandStage::Completed), 20.0));
        let s = d.request_status().unwrap();
        assert!(wait(&mut w, &mut d, |d| d.stage(s) == Some(CommandStage::Completed), 1.0));
        let st = d.last_status().unwrap();
        assert!((st.a_deg - 90.0).abs() < 1e-6 && (st.u_mm - 25.0).abs() < 1e-6 && st.homed);
    }
}
