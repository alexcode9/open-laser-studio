# xTool F1 Protocol — Working Model

This document is the working model used by `crates/laser-protocol`. Every statement is tagged; see [PROTOCOL_EVIDENCE.md](PROTOCOL_EVIDENCE.md) for sources.

Confidence levels:
- **VERIFIED** — observed by this project on a real device. *(None yet. No F1 has been connected to Open Laser Studio.)*
- **DOCUMENTED** — stated by xTool or demonstrated in working open-source code.
- **INFERRED** — reasoned from indirect evidence.
- **UNKNOWN** — no evidence.

## 1. Firmware families

| Firmware | Transport | Status |
|---|---|---|
| F1 < 40.51.020.04 ("V1") | G-code over TCP 8780, HTTP REST on 8080 | DOCUMENTED (BeamInk, LightBurn) |
| F1 ≥ 40.51.020.04 ("V2") | TLS WebSocket on 28900 | DOCUMENTED (ha-xtool, citing xTool release notes) |

Whether 8780 still answers on V2 firmware: **INFERRED no** (release notes say LightBurn breaks).

Open Laser Studio implements only the V1 transport skeleton. It must query the firmware version and refuse write operations on unrecognized versions.

## 2. Addressing

- USB connection presents as a USB-Ethernet adapter; device IP `201.234.3.1`. **DOCUMENTED** (BeamInk default; tested on Linux).
- Windows behavior of the USB network adapter: **UNKNOWN**.
- Host and ports are configuration values in Open Laser Studio, never hardcoded in logic.

## 3. HTTP (port 8080)

| Request | Purpose | Confidence | OLS usage |
|---|---|---|---|
| `GET /device/machineInfo` | JSON machine info | DOCUMENTED (BeamInk) | Read-only, allowed in dev mode |
| `POST /processing/stop` (fallback `GET`) | Stop processing | DOCUMENTED (BeamInk) | Allowed as a *stop* action (stopping is always permitted) |
| `GET /system?action=version` | Firmware version | INFERRED (V1 family doc) | Read-only probe |
| `GET /system?action=get_working_sta` | `{"working":"0/1/2"}` idle/API job/button job | INFERRED (V1 family doc) | Candidate completion signal, **must be validated** |

## 4. G-code stream (TCP 8780)

- Framing: ASCII lines terminated by `\n`. **DOCUMENTED**.
- Acknowledgment: device sends some text back; format not documented and not parsed by BeamInk. **UNKNOWN** whether one `ok` per line is sent, and whether `ok` means *received* or *executed*.
- Flow control / buffer size: **UNKNOWN**.
- Job completion signal on the stream: **UNKNOWN**.
- Behavior on TCP disconnect mid-stream: **UNKNOWN** (BeamInk sends `G0 S0` and calls `/processing/stop` defensively).

### Commands

| Command | Meaning | Confidence |
|---|---|---|
| `$L` | Session start (enter live / LightBurn-style mode) | DOCUMENTED (BeamInk), semantics INFERRED |
| `$P` | Session end | DOCUMENTED (BeamInk), semantics INFERRED |
| `M114 S1` | Select blue diode | DOCUMENTED (BeamInk; xTool art. 496 says `M114S2` = IR) |
| `M114 S2` | Select infrared | DOCUMENTED (xTool art. 496) |
| `M3 S0` / `M4 S0` | Constant / dynamic power mode | DOCUMENTED (BeamInk), semantics INFERRED from GRBL |
| `G0 X Y` | Laser-off move, galvo mm | DOCUMENTED |
| `G1 X Y S F` | Laser-on move; S = 0..1000 | DOCUMENTED (BeamInk) |
| `G0 S0` | Laser off | DOCUMENTED |
| `G21`, `G90` | mm, absolute | DOCUMENTED |
| `M6 P1` | Part of session end; meaning **UNKNOWN** | DOCUMENTED usage only |
| `G100` | Enter rotary mode | DOCUMENTED (xTool art. 1263/496) |
| `M116AaBb` | Axis substitution: replace axis b with axis a; values ±1..±4 = X, Y, Z, U | DOCUMENTED (xTool art. 1263) |
| `M116A2B-4` | Substitute Y for U (rotary attachment) | DOCUMENTED |
| `G101` | Exit rotary mode | DOCUMENTED |
| `G91 G1 Z.. F.. S0` | Ignored by the F1 | DOCUMENTED by forum author only |

Note: in ha-xtool, `M116` also appears as a *query* for laser module info on other families. Same code, different meaning; treat it as F1-dialect specific.

## 5. Field geometry

- Marking field ~120 × 120 mm (BeamInk `119.98`). **DOCUMENTED**. Kept in the machine profile, not in code.

## 6. Safety-relevant facts

- Physical emergency stop on the device exists. **DOCUMENTED** (xTool support).
- Device-moved / tilt / flame detection exists ("Stop When Moved"). **DOCUMENTED**. Open Laser Studio must never toggle these.
- LightBurn needs "Buffered" transfer mode. **DOCUMENTED**. Implies the device prefers or requires buffered upload for jobs; semantics **UNKNOWN**.

## 7. Implementation policy

1. `XToolF1Device` connects TCP and HTTP, reads machine info, records all traffic.
2. All writes go through `CommandClass` classification (`laser-gcode` allowlist). `G1` with S > 0, `M3`/`M4` with S > 0, and unknown commands are **blocked** unless `simulationOnly = false` **and** developer mode is on **and** the command is on the validated allowlist. In Milestone 1, the validated allowlist for emission is **empty**.
3. Stop is always permitted.
