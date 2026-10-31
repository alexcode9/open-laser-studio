# Protocol Evidence Log

Each entry: source, exact command/response, device model, firmware, confidence, validation steps.

No entries in this file are VERIFIED. Open Laser Studio has not yet been connected to an F1.

---

### E-001 TCP G-code port 8780
- **Source:** BeamInk `beamink/transport/xtool.py`, `config.py` (`tcp_port = 8780`)
- **Exact:** `socket.create_connection(("201.234.3.1", 8780))`, lines joined with `\n`
- **Device:** xTool F1 (original), Linux host, USB Ethernet
- **Firmware:** not stated
- **Confidence:** DOCUMENTED
- **Validate:** connect with protocol inspector, send nothing, record banner; send `G90\n`, record reply bytes and timing.

### E-002 HTTP port 8080 machine info
- **Source:** BeamInk `query_machine_info()`
- **Exact:** `GET /device/machineInfo` → JSON
- **Device/Firmware:** F1 / not stated
- **Confidence:** DOCUMENTED
- **Validate:** GET with curl; store the response as a fixture in `tests/protocol/fixtures/`.

### E-003 Processing stop
- **Source:** BeamInk `stop_processing()`
- **Exact:** `G0 S0` on TCP, then `POST /processing/stop` (empty body), fallback `GET`
- **Confidence:** DOCUMENTED
- **Validate:** start a laser-off framing job, call stop, confirm motion halts; record HTTP status and body.

### E-004 Session start/end sequence
- **Source:** BeamInk `xtool_session_start_lines`, `xtool_session_end_lines`
- **Exact start:** `$L`, `G0 F180000`, `M3 S0`, `G1 F180000`, `M114 S1`, `G21`, `G90`
- **Exact end:** `G90`, `G0 S0`, `G0 F180000`, `G1 F180000`, `M6 P1`, `$P`
- **Confidence:** DOCUMENTED (sequence); semantics of `$L`, `$P`, `M6 P1` INFERRED/UNKNOWN
- **Validate:** send the start sequence with no motion; record responses; then the end sequence.

### E-005 Power scale
- **Source:** BeamInk `power_to_xtool_s_value` (`round(pct * 10)`, clamp 0..1000)
- **Confidence:** DOCUMENTED (as used); whether 1000 = 100 % for both sources is UNKNOWN
- **Validate:** not before emission is allowed. Requires a dedicated, supervised experiment.

### E-006 Laser source select
- **Source:** xTool article 496 ("click RED_LASER or enter `M114S2`"); BeamInk (`M114 S1` blue, `M114 S2` IR)
- **Confidence:** DOCUMENTED
- **Validate:** send `M114 S2` with laser off; check machineInfo / indicator change.

### E-007 Rotary axis substitution
- **Source:** xTool article 1263
- **Exact:** start G-code `G100` then `M116A2B-4`; end G-code `G101`. `M116AaBb` replaces axis b with axis a; ±1..±4 = X, Y, Z, U.
- **Device:** F1 / F1 Lite with RA2, via LightBurn
- **Confidence:** DOCUMENTED
- **Validate:** with RA2 connected and laser off, send `G100`, `M116A2B-4`, `G0 Y10`; observe U motion. Then `G101`.

### E-008 Buffered transfer mode required for LightBurn
- **Source:** xTool article 496 "Cautions"
- **Confidence:** DOCUMENTED
- **Validate:** proxy capture of LightBurn buffered vs streamed transfer.

### E-009 V2 firmware framework (port 28900)
- **Source:** ha-xtool `docs/PROTOCOL.md` "WS-V2 firmware activation thresholds", citing xTool release notes
- **Exact:** F1 min V2 firmware `40.51.020.04`, "Breaks LightBurn + XCS Mobile"
- **Confidence:** DOCUMENTED (secondary source)
- **Validate:** read firmware version via machineInfo; probe TCP 8780 and TLS 28900.

### E-010 Working-state query
- **Source:** ha-xtool / xTool-Connect, V1 REST family: `GET /system?action=get_working_sta` → `{"working":"0"}`
- **Device:** documented for D-series / V1; **not shown for F1**
- **Confidence:** INFERRED for F1
- **Validate:** GET on F1 while idle and during a laser-off frame.

### E-011 F1 ignores Z commands
- **Source:** LightBurn forum (FooTheBar, 2025-01-26)
- **Exact:** `G91 G1 Z10 F600 S0` forwarded; "The F1 simply ignores that command"
- **Confidence:** DOCUMENTED (single user report)
- **Validate:** send with laser off, confirm reply and no motion.

### E-012 V1 UDP discovery (port 20000)
- **Source:** ha-xtool v2.5.6 release notes / discover-worker (Studio-compatible wire shape)
- **Exact:** UDP probe JSON `{"ip":"<local>","port":20000,"requestId":"..."}` to `255.255.255.255:20000` and multicast `224.0.1.77:20000`. Replies may be JSON or a bare IP string.
- **Device/Firmware:** V1 REST family generally; F1-specific reply shape not captured by OLS
- **Confidence:** DOCUMENTED (secondary)
- **Validate:** run OLS Find device → Wi-Fi on a LAN with a V1 F1; capture request/response with Wireshark.

### E-013 USB gadget IP on macOS
- **Source:** xTool support article 2438 (Wi-Fi connection failure troubleshooting)
- **Exact:** macOS example URL `http://201.234.4.1:8080/net?action=getssid` (Windows uses `201.234.3.1`)
- **Confidence:** DOCUMENTED (secondary)
- **Validate:** plug F1 into a Mac via USB; confirm which of `201.234.3.1` / `201.234.4.1` answers `GET /device/machineInfo`.
