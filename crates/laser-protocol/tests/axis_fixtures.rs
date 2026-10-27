//! The firmware host tests use the same golden frames; a mismatch here means the two
//! implementations of the axis protocol have drifted apart.

use laser_protocol::axis::Frame;
use serde_json::Value;

#[test]
fn golden_frames_roundtrip() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/axis_frames.json");
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let frames = fixture["frames"].as_array().unwrap();
    assert!(!frames.is_empty());
    for f in frames {
        let line = f["line"].as_str().unwrap();
        let frame = Frame::decode(line).unwrap_or_else(|e| panic!("{line}: {e}"));
        assert_eq!(u64::from(frame.seq), f["seq"].as_u64().unwrap());
        assert_eq!(frame.kind, f["kind"].as_str().unwrap());
        assert_eq!(frame.encode(), format!("{line}\n"), "re-encoding must be byte-identical");
    }
}
