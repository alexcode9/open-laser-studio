# Reference Projects

Reviewed 2026-10-27. Repositories were shallow-cloned into a scratch directory outside this repo; no code was copied into Open Laser Studio.

| Project | License | Protocol family | Relevance |
|---|---|---|---|
| [sfn-tools/BeamInk](https://github.com/sfn-tools/BeamInk) | MIT | xTool F1 legacy: G-code over TCP 8780 + HTTP 8080 | **Highest.** Only known open-source direct F1 streaming client. |
| [thecodingdad/ha-xtool](https://github.com/thecodingdad/ha-xtool) | see repo | All xTool families (S1, D-series REST, V1 REST, WS-V2) | Firmware-family map, F1 V2 firmware threshold, HTTP endpoint catalog. |
| [1RandomDev/xTool-Connect](https://github.com/1RandomDev/xTool-Connect) | see repo | D1 / D1 Pro HTTP API | **Different device family.** Useful only for concepts (job progress, `/cnc/data` pause/resume/stop). Do not transfer commands to the F1. |
| [meerk40t/galvoplotter](https://github.com/meerk40t/galvoplotter) | MIT | BJJCZ LMC (EZCAD2) USB galvo | Architecture reference only: realtime vs sequential command split, spooler thread, `wait_for_machine_idle`. Not an F1 backend. |
| MeerK40t | GPL-3.0 | Many | Architectural reference only (driver/spooler/device separation). Not reviewed for code reuse because of GPL. |
| [LightBurn forum: TCP interception](https://forum.lightburnsoftware.com/t/connection-to-custom-linear-axis-via-tcp-interception-is-possible/163546) | n/a | F1 legacy TCP via LightBurn | Proof of concept of a transparent proxy that forwards selected G-code to an Arduino. |

## BeamInk — findings

Files read: `transport/xtool.py`, `transport/base.py`, `transport/sim.py`, `core/controller.py`, `core/mapping.py`, `config.py`, `README.md`.

- **Connection:** plain `socket.create_connection((host, 8780))`, connect timeout 1.0 s, read timeout 0.2 s. Default host `201.234.3.1` (the F1 USB-Ethernet gadget address).
- **Framing:** newline-terminated ASCII G-code lines, sent in batches with `sendall("\n".join(lines) + "\n")`. No checksum, no line numbers.
- **Responses:** BeamInk reads whatever is available (non-blocking `select` with ≤10 ms wait) and logs it as raw text. **It does not parse or correlate acknowledgments.** There is no flow control; streaming is rate-limited client side (`send_rate_hz = 120`).
- **Session start** (`xtool_session_start_lines`): `$L`, `G0 F180000`, `M3 S0` (constant) or `M4 S0` (dynamic), `G1 F180000`, `M114 S1` (blue) / `M114 S2` (IR, called "RED"), `G21`, `G90`.
- **Session end:** `G90`, `G0 S0`, `G0 F180000`, `G1 F180000`, `M6 P1`, `$P`.
- **Motion:** laser off → `G0X..Y..` followed by `G0 S0`; laser on → `G1X..Y..S<0-1000>F<feed>`. Power = percent × 10, clamped 0..1000.
- **Stage:** 119.98 × 119.98 mm field, focus center (57.5, 57.5).
- **Stop:** sends `G0 S0`, then `POST /processing/stop` on HTTP 8080 (falls back to `GET`), then closes the socket.
- **Machine info:** `GET /device/machineInfo` on HTTP 8080, JSON.
- **Safety helpers:** starts disarmed, idle auto-stop after 30 s, stop on app close, park at focus point on start/stop.
- **No explicit job-completion signal** is used. BeamInk is a live streaming tool, not a job runner.

## ha-xtool — findings relevant to the F1

- The F1 historically uses the **V1 REST** family (HTTP 8080). xTool's "communication framework upgrade" moves the F1 to **WS-V2** (TLS WebSocket on 28900) at firmware **≥ 40.51.020.04**, with release notes stating it "breaks LightBurn + XCS Mobile".
- Consequence: BeamInk's TCP 8780 path (which is the same path LightBurn uses) is **probably unavailable on F1 firmware ≥ 40.51.020.04**. This is inferred, not verified on hardware.
- V1 REST documents `GET /system?action=get_working_sta` returning `{"working":"0|1|2"}` (idle / API job / button job). This is documented for the V1 family generally; whether the F1 answers it is unverified.
- V1 discovery: UDP 20000 JSON probe (multicast `224.0.1.77`).
- The WS-V2 surface includes `/v1/device/machineInfo`, `/v1/device/runtime-infos`, `/v1/processing/state`, `/v1/processing/progress`, and job upload via `file_stream`. A future `XToolF1V2Transport` could target this.

## xTool-Connect — findings

D1-family only. Exposes `/progress`, `/system?action=...`, `/cmd`, `/cnc/data?action=pause|resume|stop`, upload. **Not applicable to the F1** unless proven otherwise; recorded only so contributors don't mistake it for F1 documentation.

## galvoplotter — concepts reused (no code)

- Separate realtime commands (status, abort, pause) from sequential job data.
- A spooler executes jobs; the controller exposes `wait_for_machine_idle()`. Open Laser Studio mirrors this through `Device::status()` polling plus explicit completion stages in `laser-devices`.

## LightBurn TCP interception — evaluation

**Reported by the author (unverified by us):**
- A Python proxy sits between LightBurn and the F1 TCP port; LightBurn's `.lbdev` was pointed at the proxy.
- Messages are forwarded both ways; selected commands (`G91 G1 Z10 F600 S0`) are additionally sent to an Arduino over serial. The F1 ignores the Z command.
- The proxy can inject `M114 S2` to switch to IR.
- The author states there is **no way to make the laser wait** for external motion, so rotation control is not considered workable; repeat marking is.

**Assessment for Open Laser Studio:**
- Proves a transparent proxy is feasible on legacy firmware. It does **not** prove synchronization.
- Expansion options (separate queues, barriers, buffering next commands until external completion) depend on knowing whether the F1 acknowledges per line and whether LightBurn tolerates delayed `ok`s. Both are **UNKNOWN**.
- Our design therefore puts barriers in our own job engine (indexed engraving) rather than in a proxy. The proxy is kept as a passive diagnostic tool (roadmap).
