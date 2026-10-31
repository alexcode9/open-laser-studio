//! Wire protocols and transports. Business logic (jobs, safety decisions) lives elsewhere.

pub mod axis;
pub mod discovery;
pub mod f1;
pub mod framing;
pub mod gate;
pub mod log;

pub use discovery::{
    DeviceIdentity, DeviceSource, DiscoverConfig, DiscoveryReply, FirmwareFamily, IdentifyConfig, PortProbe,
    USB_GADGET_LINUX, USB_GADGET_MACOS, V1_DISCOVERY_PORT, V1_MULTICAST, classify_family, discover_and_identify,
    discover_v1, identify, identify_usb, parse_discovery_reply, parse_firmware_version, source_for_host,
    usb_gadget_hosts,
};
pub use framing::LineFramer;
pub use gate::{WriteGate, check_lines};
pub use log::{Direction, ProtocolLog, ProtocolLogEntry};
