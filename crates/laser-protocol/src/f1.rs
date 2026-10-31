//! xTool F1 transport for V1 firmware (TCP G-code stream + HTTP REST).
//! See `docs/research/F1_PROTOCOL.md`. Nothing here has been VERIFIED on hardware.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use laser_core::{CoreError, Result};
use serde::{Deserialize, Serialize};

use crate::framing::LineFramer;
use crate::log::{Direction, ProtocolLog};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct F1TransportConfig {
    pub host: String,
    pub tcp_port: u16,
    pub http_port: u16,
    pub connect_timeout_ms: u64,
    pub read_timeout_ms: u64,
}

impl Default for F1TransportConfig {
    fn default() -> Self {
        Self { host: "201.234.3.1".into(), tcp_port: 8780, http_port: 8080, connect_timeout_ms: 1000, read_timeout_ms: 200 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

/// Parse a raw HTTP/1.x response (Content-Length or close-delimited).
pub fn parse_http_response(raw: &[u8]) -> Result<HttpResponse> {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| CoreError::Protocol("incomplete HTTP response".into()))?;
    let mut lines = head.lines();
    let status_line = lines.next().unwrap_or_default();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| CoreError::Protocol(format!("bad status line '{status_line}'")))?;
    let mut len = None;
    for l in lines {
        if let Some((k, v)) = l.split_once(':')
            && k.trim().eq_ignore_ascii_case("content-length")
        {
            len = v.trim().parse::<usize>().ok();
        }
    }
    let body = match len {
        Some(n) if body.len() >= n => body[..n].to_string(),
        Some(_) => return Err(CoreError::Protocol("truncated HTTP body".into())),
        None => body.to_string(),
    };
    Ok(HttpResponse { status, body })
}

pub struct F1Transport {
    pub config: F1TransportConfig,
    stream: Option<TcpStream>,
    framer: LineFramer,
    pub log: ProtocolLog,
    epoch: Instant,
}

impl F1Transport {
    pub fn new(config: F1TransportConfig) -> Self {
        Self { config, stream: None, framer: LineFramer::new(4096), log: ProtocolLog::default(), epoch: Instant::now() }
    }

    fn t(&self) -> f64 {
        self.epoch.elapsed().as_secs_f64()
    }

    fn addr(&self, port: u16) -> Result<SocketAddr> {
        (self.config.host.as_str(), port)
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| CoreError::Communication(format!("cannot resolve {}", self.config.host)))
    }

    pub fn is_connected(&self) -> bool {
        self.stream.is_some()
    }

    pub fn connect(&mut self) -> Result<()> {
        if self.stream.is_some() {
            return Ok(());
        }
        let addr = self.addr(self.config.tcp_port)?;
        let stream = TcpStream::connect_timeout(&addr, Duration::from_millis(self.config.connect_timeout_ms))
            .map_err(|e| CoreError::Communication(format!("connect {addr}: {e}")))?;
        stream.set_read_timeout(Some(Duration::from_millis(self.config.read_timeout_ms)))?;
        stream.set_nodelay(true)?;
        let t = self.t();
        self.log.push(t, "f1-tcp", Direction::Info, format!("connected to {addr}"));
        self.stream = Some(stream);
        Ok(())
    }

    pub fn disconnect(&mut self) {
        if self.stream.take().is_some() {
            let t = self.t();
            self.log.push(t, "f1-tcp", Direction::Info, "disconnected");
        }
    }

    /// Send pre-validated lines. Callers must pass lines through `gate::check_lines` first.
    pub fn send_lines(&mut self, lines: &[String]) -> Result<()> {
        let t = self.t();
        let stream = self.stream.as_mut().ok_or_else(|| CoreError::Communication("not connected".into()))?;
        let payload = lines.join("\n") + "\n";
        if let Err(e) = stream.write_all(payload.as_bytes()) {
            self.stream = None;
            self.log.push(t, "f1-tcp", Direction::Error, format!("send failed: {e}"));
            return Err(CoreError::Communication(format!("send failed: {e}")));
        }
        for l in lines {
            self.log.push(t, "f1-tcp", Direction::Tx, l.clone());
        }
        Ok(())
    }

    /// Read whatever replies are available (non-blocking up to the read timeout).
    pub fn poll_replies(&mut self) -> Result<Vec<String>> {
        let t = self.t();
        let Some(stream) = self.stream.as_mut() else {
            return Err(CoreError::Communication("not connected".into()));
        };
        let mut buf = [0u8; 4096];
        match stream.read(&mut buf) {
            Ok(0) => {
                self.stream = None;
                self.log.push(t, "f1-tcp", Direction::Error, "connection closed by device");
                Err(CoreError::Communication("connection closed by device".into()))
            }
            Ok(n) => {
                let lines = self.framer.push(&buf[..n]);
                for l in &lines {
                    self.log.push(t, "f1-tcp", Direction::Rx, l.clone());
                }
                Ok(lines)
            }
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => Ok(Vec::new()),
            Err(e) => {
                self.stream = None;
                Err(CoreError::Communication(format!("read failed: {e}")))
            }
        }
    }

    pub fn http(&mut self, method: &str, path: &str) -> Result<HttpResponse> {
        let addr = self.addr(self.config.http_port)?;
        let timeout = Duration::from_millis(self.config.connect_timeout_ms);
        let mut s = TcpStream::connect_timeout(&addr, timeout)
            .map_err(|e| CoreError::Communication(format!("http connect {addr}: {e}")))?;
        s.set_read_timeout(Some(timeout))?;
        let req = format!(
            "{method} {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
            self.config.host
        );
        s.write_all(req.as_bytes())?;
        let mut raw = Vec::new();
        s.read_to_end(&mut raw).or_else(|e| {
            if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) && !raw.is_empty() {
                Ok(0)
            } else {
                Err(e)
            }
        })?;
        let resp = parse_http_response(&raw)?;
        let t = self.t();
        self.log.push(t, "f1-http", Direction::Tx, format!("{method} {path}"));
        self.log.push(t, "f1-http", Direction::Rx, format!("{} {}", resp.status, resp.body));
        Ok(resp)
    }

    /// `GET /device/machineInfo` (DOCUMENTED, E-002).
    pub fn machine_info(&mut self) -> Result<serde_json::Value> {
        let r = self.http("GET", "/device/machineInfo")?;
        if !(200..300).contains(&r.status) {
            return Err(CoreError::Communication(format!("machineInfo HTTP {}", r.status)));
        }
        Ok(serde_json::from_str(&r.body).unwrap_or(serde_json::json!({ "raw": r.body })))
    }

    /// `GET /system?action=version` (INFERRED for the V1 REST family).
    pub fn firmware_version(&mut self) -> Result<serde_json::Value> {
        let r = self.http("GET", "/system?action=version")?;
        if !(200..300).contains(&r.status) {
            return Err(CoreError::Communication(format!("version HTTP {}", r.status)));
        }
        Ok(serde_json::from_str(&r.body).unwrap_or(serde_json::json!({ "raw": r.body })))
    }

    /// Stop processing: `G0 S0` then `POST /processing/stop`, falling back to GET (E-003).
    /// Stopping is always permitted regardless of the write gate.
    pub fn stop_processing(&mut self) -> Result<()> {
        if self.stream.is_some() {
            let _ = self.send_lines(&["G0 S0".to_string()]);
        }
        let mut last = None;
        for m in ["POST", "GET"] {
            match self.http(m, "/processing/stop") {
                Ok(r) if (200..300).contains(&r.status) => {
                    self.disconnect();
                    return Ok(());
                }
                Ok(r) => last = Some(CoreError::Communication(format!("{m} /processing/stop HTTP {}", r.status))),
                Err(e) => last = Some(e),
            }
        }
        self.disconnect();
        Err(last.unwrap_or_else(|| CoreError::Communication("stop failed".into())))
    }

    /// `GET /system?action=get_working_sta` → `Some(true)` busy. INFERRED for the F1 (E-010).
    pub fn working_state(&mut self) -> Result<Option<bool>> {
        let r = self.http("GET", "/system?action=get_working_sta")?;
        let v: serde_json::Value = serde_json::from_str(&r.body).unwrap_or_default();
        Ok(v.get("working").and_then(|w| w.as_str().map(|s| s != "0").or_else(|| w.as_i64().map(|n| n != 0))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn http_parsing() {
        let r = parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}extra").unwrap();
        assert_eq!(r, HttpResponse { status: 200, body: "{}".into() });
        assert!(parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n{}").is_err());
        assert!(parse_http_response(b"garbage").is_err());
        let r = parse_http_response(b"HTTP/1.0 404 Not Found\r\n\r\nnope").unwrap();
        assert_eq!(r.status, 404);
    }

    #[test]
    fn tcp_roundtrip_against_fake_device() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 64];
            let n = s.read(&mut buf).unwrap();
            assert_eq!(&buf[..n], b"G90\n");
            // Reply split across two writes.
            s.write_all(b"o").unwrap();
            std::thread::sleep(Duration::from_millis(20));
            s.write_all(b"k\n").unwrap();
            std::thread::sleep(Duration::from_millis(50));
        });
        let mut t = F1Transport::new(F1TransportConfig { host: "127.0.0.1".into(), tcp_port: port, ..Default::default() });
        t.connect().unwrap();
        t.send_lines(&["G90".into()]).unwrap();
        let mut got = Vec::new();
        for _ in 0..20 {
            got.extend(t.poll_replies().unwrap_or_default());
            if !got.is_empty() {
                break;
            }
        }
        assert_eq!(got, vec!["ok"]);
        server.join().unwrap();
        // Device closed the socket: the transport must report it.
        let mut closed = false;
        for _ in 0..20 {
            if t.poll_replies().is_err() {
                closed = true;
                break;
            }
        }
        assert!(closed);
        assert!(!t.is_connected());
    }

    #[test]
    fn connect_timeout_reports_communication_error() {
        // TEST-NET-1 address, never routable.
        let mut t = F1Transport::new(F1TransportConfig { host: "192.0.2.1".into(), connect_timeout_ms: 100, ..Default::default() });
        assert!(matches!(t.connect(), Err(CoreError::Communication(_))));
    }
}
