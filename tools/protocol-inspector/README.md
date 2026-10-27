# protocol-inspector (design only — not implemented in Milestone 1)

Purpose: collect **evidence** about the xTool F1 network protocol by observing traffic that the
vendor software (xTool Creative Space / XCS) already sends to a real machine. The output feeds
`docs/research/PROTOCOL_EVIDENCE.md` and the dialect tables in `crates/laser-gcode/src/dialect.rs`.

Nothing in this tool originates commands to a laser. It is a passive observer or a transparent
relay; the vendor application remains the only thing that drives the machine.

## Modes

1. **Offline capture analysis (preferred first step).** Read a `pcap`/`pcapng` file captured with
   Wireshark on the host running XCS (filter `host 201.234.3.1 and (tcp port 8780 or tcp port 8080)`
   for USB-RNDIS, or the machine's Wi-Fi IP). Reassemble TCP streams, split the 8780 stream into
   lines, and parse HTTP requests on 8080. No interaction with the device at all.
2. **Transparent TCP relay (later, opt-in).** Listen on `127.0.0.1:8780`/`8080`, forward byte-for-byte
   to the real machine, and log both directions with timestamps. Requires pointing XCS at the relay,
   which may not be possible; documented as an option only.

## Output

JSON lines, one record per message:

```json
{"t": 12.345, "dir": "host->dev", "chan": "tcp8780", "raw": "G1 X10 Y20 S300", "parsed": {"class": "Mark"}}
{"t": 12.351, "dir": "dev->host", "chan": "tcp8780", "raw": "ok"}
{"t": 13.002, "dir": "host->dev", "chan": "http8080", "method": "GET", "path": "/system?action=get_working_sta"}
```

A summary report lists every distinct command word, every HTTP path, observed reply strings, and
the timing between `$L`/`$P` session markers and `ok` replies — exactly the facts marked
**INFERRED** in `docs/research/F1_PROTOCOL.md`.

## Rules

- Captures are made by the machine owner on their own network.
- Never replay captured traffic to a device from this tool.
- Strip Wi-Fi credentials, serial numbers and cloud tokens before committing any capture excerpt.
- Every new protocol claim must cite a capture (file name + timestamp) in `PROTOCOL_EVIDENCE.md`.

## Implementation sketch

- Rust binary in this directory (`pcap-file` crate for reading, a small TCP reassembler keyed on
  the 4-tuple, `laser_gcode::parse_line` + `classify` for line classification).
- Reuse `laser_protocol::f1::parse_http_response` for HTTP bodies.
- Golden tests against small, scrubbed capture excerpts in `tests/fixtures/captures/`.
