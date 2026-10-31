//! xTool V1 LAN discovery (UDP 20000) and read-only device identification.
//!
//! Evidence: ha-xtool v2.5.6 (Studio-compatible probe shape), BeamInk HTTP endpoints.
//! Nothing here has been VERIFIED against a real F1 by Open Laser Studio.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::time::{Duration, Instant};

use laser_core::{CoreError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::f1::{F1Transport, F1TransportConfig};

/// Legacy V1 multicast group used by xTool Studio / ha-xtool.
pub const V1_MULTICAST: Ipv4Addr = Ipv4Addr::new(224, 0, 1, 77);
/// V1 discovery UDP port.
pub const V1_DISCOVERY_PORT: u16 = 20_000;
/// USB Ethernet gadget address documented by BeamInk (Linux).
pub const USB_GADGET_LINUX: &str = "201.234.3.1";
/// USB Ethernet gadget address cited by xTool support art. 2438 for macOS.
pub const USB_GADGET_MACOS: &str = "201.234.4.1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FirmwareFamily {
    V1,
    V2,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceSource {
    Usb,
    Wifi,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryReply {
    pub host: String,
    pub name: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub raw: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortProbe {
    pub http8080: bool,
    pub tcp8780: bool,
    pub tls28900: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub host: String,
    pub name: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub source: DeviceSource,
    pub family: FirmwareFamily,
    pub firmware: Option<String>,
    pub ports: PortProbe,
    pub machine_info: Value,
    pub raw: Value,
}

#[derive(Debug, Clone)]
pub struct DiscoverConfig {
    /// How long to wait for UDP replies after sending the probe.
    pub timeout: Duration,
    /// Destinations to probe. Defaults to broadcast + V1 multicast.
    pub destinations: Vec<SocketAddr>,
    /// Bind address for the probe socket (use `127.0.0.1:0` in tests).
    pub bind: SocketAddr,
}

impl Default for DiscoverConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_millis(1500),
            destinations: vec![
                SocketAddr::from((Ipv4Addr::BROADCAST, V1_DISCOVERY_PORT)),
                SocketAddr::from((V1_MULTICAST, V1_DISCOVERY_PORT)),
            ],
            bind: SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)),
        }
    }
}

#[derive(Debug, Clone)]
pub struct IdentifyConfig {
    pub connect_timeout: Duration,
    pub http_port: u16,
    pub tcp_port: u16,
    pub tls_port: u16,
}

impl Default for IdentifyConfig {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_millis(800),
            http_port: 8080,
            tcp_port: 8780,
            tls_port: 28_900,
        }
    }
}

/// Guess the local IPv4 used for outbound LAN traffic (UDP connect trick).
pub fn local_ipv4() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    match s.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(v) => Some(v),
        _ => None,
    }
}

fn json_str(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
            return Some(s.to_string());
        }
    }
    None
}

/// Parse a discovery reply: Studio-compatible JSON or a bare IP string.
pub fn parse_discovery_reply(bytes: &[u8], src: SocketAddr) -> Option<DiscoveryReply> {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    if text.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        let host = json_str(&v, &["ip", "host", "address"])
            .or_else(|| src.ip().to_string().into())
            .filter(|h| !h.is_empty())?;
        return Some(DiscoveryReply {
            host,
            name: json_str(&v, &["name", "deviceName", "device_name", "nickName"]),
            model: json_str(&v, &["type", "model", "deviceType", "product"]),
            serial: json_str(&v, &["sn", "serial", "serialNumber", "deviceId"]),
            raw: v,
        });
    }
    // Bare IP string (ha-xtool / Studio tolerance).
    let host = if text.parse::<Ipv4Addr>().is_ok() {
        text
    } else {
        src.ip().to_string()
    };
    Some(DiscoveryReply {
        host,
        name: None,
        model: None,
        serial: None,
        raw: Value::String(String::from_utf8_lossy(bytes).into_owned()),
    })
}

fn is_usb_gadget(host: &str) -> bool {
    host == USB_GADGET_LINUX || host == USB_GADGET_MACOS
}

pub fn source_for_host(host: &str) -> DeviceSource {
    if is_usb_gadget(host) {
        DeviceSource::Usb
    } else {
        DeviceSource::Wifi
    }
}

/// Parse xTool dotted firmware versions like `40.51.020.04`. Non-matching strings return `None`.
pub fn parse_firmware_version(s: &str) -> Option<[u32; 4]> {
    let parts: Vec<_> = s.trim().split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut out = [0u32; 4];
    for (i, p) in parts.iter().enumerate() {
        out[i] = p.parse().ok()?;
    }
    Some(out)
}

/// V2 threshold documented by ha-xtool for the F1: `40.51.020.04`.
pub const V2_THRESHOLD: [u32; 4] = [40, 51, 20, 4];

pub fn classify_family(version: Option<&str>, ports: &PortProbe) -> FirmwareFamily {
    if let Some(v) = version.and_then(parse_firmware_version)
        && v >= V2_THRESHOLD
    {
        return FirmwareFamily::V2;
    }
    if ports.tls28900 && !ports.http8080 && !ports.tcp8780 {
        return FirmwareFamily::V2;
    }
    if ports.http8080 || ports.tcp8780 {
        return FirmwareFamily::V1;
    }
    if ports.tls28900 {
        return FirmwareFamily::V2;
    }
    FirmwareFamily::Unknown
}

/// Send a Studio-compatible V1 UDP discovery probe and collect replies (deduped by host).
pub fn discover_v1(cfg: &DiscoverConfig) -> Result<Vec<DiscoveryReply>> {
    let sock = UdpSocket::bind(cfg.bind).map_err(|e| CoreError::Communication(format!("udp bind: {e}")))?;
    sock.set_broadcast(true)
        .map_err(|e| CoreError::Communication(format!("udp broadcast: {e}")))?;
    sock.set_read_timeout(Some(Duration::from_millis(50)))
        .map_err(|e| CoreError::Communication(format!("udp timeout: {e}")))?;

    let local_ip = match cfg.bind.ip() {
        std::net::IpAddr::V4(v) if !v.is_unspecified() => v,
        _ => local_ipv4().unwrap_or(Ipv4Addr::new(127, 0, 0, 1)),
    };
    let request_id = format!("{:x}", Instant::now().elapsed().as_nanos());
    let payload = serde_json::json!({
        "ip": local_ip.to_string(),
        "port": V1_DISCOVERY_PORT,
        "requestId": request_id,
    });
    let bytes = serde_json::to_vec(&payload).map_err(|e| CoreError::Protocol(e.to_string()))?;

    for dest in &cfg.destinations {
        let _ = sock.send_to(&bytes, dest);
    }

    let deadline = Instant::now() + cfg.timeout;
    let mut found: HashMap<String, DiscoveryReply> = HashMap::new();
    let mut buf = [0u8; 4096];
    while Instant::now() < deadline {
        match sock.recv_from(&mut buf) {
            Ok((n, src)) => {
                if let Some(r) = parse_discovery_reply(&buf[..n], src) {
                    found.entry(r.host.clone()).or_insert(r);
                }
            }
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) => return Err(CoreError::Communication(format!("udp recv: {e}"))),
        }
    }
    let mut out: Vec<_> = found.into_values().collect();
    out.sort_by(|a, b| a.host.cmp(&b.host));
    Ok(out)
}

fn port_open(host: &str, port: u16, timeout: Duration) -> bool {
    use std::net::ToSocketAddrs;
    let Ok(addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            return true;
        }
    }
    false
}

fn probe_ports(host: &str, cfg: &IdentifyConfig) -> PortProbe {
    PortProbe {
        http8080: port_open(host, cfg.http_port, cfg.connect_timeout),
        tcp8780: port_open(host, cfg.tcp_port, cfg.connect_timeout),
        tls28900: port_open(host, cfg.tls_port, cfg.connect_timeout),
    }
}

fn extract_version(body: &Value) -> Option<String> {
    json_str(body, &["version", "firmware", "firmwareVersion", "fw", "softVersion"])
        .or_else(|| {
            body.get("data")
                .and_then(|d| json_str(d, &["version", "firmware", "firmwareVersion", "fw"]))
        })
        .or_else(|| body.as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

fn extract_from_machine_info(info: &Value) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let name = json_str(info, &["deviceName", "name", "nickName"]);
    let model = json_str(info, &["deviceType", "type", "model", "product"]);
    let serial = json_str(info, &["sn", "serial", "serialNumber", "deviceId"]);
    let firmware = json_str(info, &["version", "firmware", "firmwareVersion", "softVersion", "fw"]);
    (name, model, serial, firmware)
}

/// Read-only identification: HTTP machineInfo + version probe + TCP port checks (no G-code).
pub fn identify(host: &str, cfg: &IdentifyConfig) -> Result<DeviceIdentity> {
    let host = host.trim();
    if host.is_empty() {
        return Err(CoreError::InvalidArgument("host is empty".into()));
    }
    let transport_cfg = F1TransportConfig {
        host: host.to_string(),
        tcp_port: cfg.tcp_port,
        http_port: cfg.http_port,
        connect_timeout_ms: cfg.connect_timeout.as_millis() as u64,
        read_timeout_ms: cfg.connect_timeout.as_millis() as u64,
    };
    let mut t = F1Transport::new(transport_cfg);
    let machine_info = t.machine_info().unwrap_or(Value::Null);
    let version_body = t.firmware_version().unwrap_or(Value::Null);
    let ports = probe_ports(host, cfg);

    let (mut name, mut model, mut serial, mut firmware) = extract_from_machine_info(&machine_info);
    if firmware.is_none() {
        firmware = extract_version(&version_body);
    }
    if name.is_none() {
        name = json_str(&version_body, &["deviceName", "name"]);
    }
    if model.is_none() {
        model = json_str(&version_body, &["deviceType", "type", "model"]);
    }
    if serial.is_none() {
        serial = json_str(&version_body, &["sn", "serial"]);
    }

    let family = classify_family(firmware.as_deref(), &ports);
    let source = source_for_host(host);

    // If nothing answered HTTP and no ports are open, treat as unreachable.
    if machine_info.is_null() && !ports.http8080 && !ports.tcp8780 && !ports.tls28900 {
        return Err(CoreError::Communication(format!("no response from {host}")));
    }

    Ok(DeviceIdentity {
        host: host.to_string(),
        name,
        model,
        serial,
        source,
        family,
        firmware,
        ports,
        machine_info,
        raw: version_body,
    })
}

/// USB gadget candidates (Linux + macOS).
pub fn usb_gadget_hosts() -> [&'static str; 2] {
    [USB_GADGET_LINUX, USB_GADGET_MACOS]
}

/// Best-effort identify of USB gadget addresses; skips hosts that do not answer.
pub fn identify_usb(cfg: &IdentifyConfig) -> Vec<DeviceIdentity> {
    let mut out = Vec::new();
    for host in usb_gadget_hosts() {
        if let Ok(mut id) = identify(host, cfg) {
            id.source = DeviceSource::Usb;
            out.push(id);
        }
    }
    out
}

/// Discover on Wi-Fi then identify each unique host.
pub fn discover_and_identify(discover: &DiscoverConfig, identify_cfg: &IdentifyConfig) -> Result<Vec<DeviceIdentity>> {
    let replies = discover_v1(discover)?;
    let mut out = Vec::new();
    for r in replies {
        match identify(&r.host, identify_cfg) {
            Ok(mut id) => {
                id.source = DeviceSource::Wifi;
                if id.name.is_none() {
                    id.name = r.name.clone();
                }
                if id.model.is_none() {
                    id.model = r.model.clone();
                }
                if id.serial.is_none() {
                    id.serial = r.serial.clone();
                }
                out.push(id);
            }
            Err(_) => {
                // Still surface an unreachable discovery hit so the UI can show the IP.
                out.push(DeviceIdentity {
                    host: r.host,
                    name: r.name,
                    model: r.model,
                    serial: r.serial,
                    source: DeviceSource::Wifi,
                    family: FirmwareFamily::Unknown,
                    firmware: None,
                    ports: PortProbe { http8080: false, tcp8780: false, tls28900: false },
                    machine_info: Value::Null,
                    raw: r.raw,
                });
            }
        }
    }
    Ok(out)
}

/// Minimal HTTP server helper used by unit tests.
#[cfg(test)]
fn serve_http_once(response: &'static [u8]) -> (std::thread::JoinHandle<()>, u16) {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut buf = [0u8; 1024];
        let _ = s.read(&mut buf);
        let _ = s.write_all(response);
    });
    (handle, port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn parse_json_reply() {
        let src: SocketAddr = "192.168.1.50:20000".parse().unwrap();
        let r = parse_discovery_reply(
            br#"{"ip":"192.168.1.50","name":"My F1","type":"F1","sn":"ABC"}"#,
            src,
        )
        .unwrap();
        assert_eq!(r.host, "192.168.1.50");
        assert_eq!(r.name.as_deref(), Some("My F1"));
        assert_eq!(r.model.as_deref(), Some("F1"));
        assert_eq!(r.serial.as_deref(), Some("ABC"));
    }

    #[test]
    fn parse_bare_ip_reply() {
        let src: SocketAddr = "10.0.0.9:20000".parse().unwrap();
        let r = parse_discovery_reply(b"10.0.0.9", src).unwrap();
        assert_eq!(r.host, "10.0.0.9");
        assert!(r.name.is_none());
    }

    #[test]
    fn parse_garbage_falls_back_to_src() {
        let src: SocketAddr = "10.0.0.3:20000".parse().unwrap();
        let r = parse_discovery_reply(b"not-json-or-ip", src).unwrap();
        assert_eq!(r.host, "10.0.0.3");
    }

    #[test]
    fn parse_empty_is_none() {
        let src: SocketAddr = "10.0.0.3:20000".parse().unwrap();
        assert!(parse_discovery_reply(b"   ", src).is_none());
    }

    #[test]
    fn classify_family_thresholds() {
        let v1_ports = PortProbe { http8080: true, tcp8780: true, tls28900: false };
        let v2_ports = PortProbe { http8080: false, tcp8780: false, tls28900: true };
        let none = PortProbe { http8080: false, tcp8780: false, tls28900: false };
        assert_eq!(classify_family(Some("40.50.999.99"), &v1_ports), FirmwareFamily::V1);
        assert_eq!(classify_family(Some("40.51.020.04"), &v1_ports), FirmwareFamily::V2);
        assert_eq!(classify_family(Some("40.51.020.05"), &none), FirmwareFamily::V2);
        assert_eq!(classify_family(None, &v2_ports), FirmwareFamily::V2);
        assert_eq!(classify_family(None, &v1_ports), FirmwareFamily::V1);
        assert_eq!(classify_family(None, &none), FirmwareFamily::Unknown);
        assert_eq!(classify_family(Some("bogus"), &none), FirmwareFamily::Unknown);
    }

    #[test]
    fn source_for_usb_gadget() {
        assert_eq!(source_for_host(USB_GADGET_LINUX), DeviceSource::Usb);
        assert_eq!(source_for_host(USB_GADGET_MACOS), DeviceSource::Usb);
        assert_eq!(source_for_host("192.168.1.10"), DeviceSource::Wifi);
    }

    #[test]
    fn discover_against_fake_responder() {
        let responder = UdpSocket::bind("127.0.0.1:0").unwrap();
        responder.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let port = responder.local_addr().unwrap().port();
        let reply = br#"{"ip":"127.0.0.1","name":"fake","type":"F1","sn":"T1"}"#.to_vec();
        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 512];
            let (n, src) = responder.recv_from(&mut buf).unwrap();
            assert!(n > 0);
            let _ = responder.send_to(&reply, src);
        });
        let cfg = DiscoverConfig {
            timeout: Duration::from_millis(500),
            destinations: vec![SocketAddr::from((Ipv4Addr::LOCALHOST, port))],
            bind: SocketAddr::from((Ipv4Addr::LOCALHOST, 0)),
        };
        let found = discover_v1(&cfg).unwrap();
        handle.join().unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name.as_deref(), Some("fake"));
        assert_eq!(found[0].serial.as_deref(), Some("T1"));
    }

    #[test]
    fn discover_dedups_by_host() {
        let responder = UdpSocket::bind("127.0.0.1:0").unwrap();
        responder.set_read_timeout(Some(Duration::from_millis(300))).unwrap();
        let port = responder.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 512];
            // Answer the same host twice (two destinations both hit us).
            for _ in 0..2 {
                if let Ok((_, src)) = responder.recv_from(&mut buf) {
                    let _ = responder.send_to(br#"{"ip":"127.0.0.1","name":"dup"}"#, src);
                }
            }
        });
        let cfg = DiscoverConfig {
            timeout: Duration::from_millis(400),
            destinations: vec![
                SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
                SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            ],
            bind: SocketAddr::from((Ipv4Addr::LOCALHOST, 0)),
        };
        let found = discover_v1(&cfg).unwrap();
        handle.join().unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn identify_against_fake_http() {
        // Content-Length must match the JSON length exactly.
        let json = r#"{"deviceName":"F1-test","deviceType":"F1","version":"40.40.001.01"}"#;
        let resp = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}", json.len(), json);
        let resp_static: &'static [u8] = Box::leak(resp.into_bytes().into_boxed_slice());
        let (h1, http_port) = serve_http_once(resp_static);

        // Open a listener on a free port to simulate TCP 8780 answering.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let tcp_port = listener.local_addr().unwrap().port();
        let tcp_h = std::thread::spawn(move || {
            let _ = listener.accept();
        });

        let cfg = IdentifyConfig {
            connect_timeout: Duration::from_millis(500),
            http_port,
            tcp_port,
            tls_port: 1, // closed
        };
        let id = identify("127.0.0.1", &cfg).unwrap();
        h1.join().unwrap();
        let _ = tcp_h.join();
        assert_eq!(id.name.as_deref(), Some("F1-test"));
        assert_eq!(id.family, FirmwareFamily::V1);
        assert!(id.ports.http8080 || id.ports.tcp8780);
        assert!(!id.ports.tls28900);
        assert_eq!(id.firmware.as_deref(), Some("40.40.001.01"));
    }

    #[test]
    fn identify_unreachable_reports_communication_error() {
        // TEST-NET-1, never routable.
        let cfg = IdentifyConfig {
            connect_timeout: Duration::from_millis(80),
            http_port: 8080,
            tcp_port: 8780,
            tls_port: 28900,
        };
        assert!(matches!(identify("192.0.2.1", &cfg), Err(CoreError::Communication(_))));
    }
}
