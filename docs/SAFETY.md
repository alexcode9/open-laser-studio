# Safety

Open Laser Studio drives a Class 4 laser and motorized axes. Software is **not** a safety device. The
xTool F1's own interlocks, the enclosure and its emergency stop button, eye protection, fume
extraction and a hardware E-stop loop on the external axes are mandatory.

## What Milestone 1 guarantees

| Guarantee | Where it is enforced | Tested by |
| --- | --- | --- |
| No laser-emission command can reach real hardware. `WriteGate.emission_validated` is hard-wired `false`. | `crates/laser-protocol/src/gate.rs` | `developer_mode_allows_laser_off_motion_only`, `developer_mode_still_refuses_emission` |
| `simulationOnly` is on at every launch and is never persisted. | `apps/desktop/electron/main/settings.ts` | `settings.test.ts` |
| Leaving simulation-only requires developer mode, which can only be enabled from a main-process dialog. The renderer cannot enable it. | `settings.ts`, `ipc.ts` | `settings.test.ts`, `contracts.test.ts` |
| Real F1 connections are refused while simulation-only is on. The only real-device actions are read-only discovery (UDP 20000) and identify (HTTP machineInfo / version + port probes). | `crates/laser-protocol/src/discovery.rs`, `crates/laser-node` | discovery unit tests + native contract gating |
| Lines not on the F1 dialect allowlist are refused and logged as `blocked`. | `gate.rs` | unit tests |
| The laser is permitted only in `RUNNING`. Arming requires explicit confirmation. Completing a job disarms. | `crates/laser-core/src/safety.rs` | 13 safety tests + Playwright |
| E-stop is accepted from every state, latches, and requires confirming that the hardware has been released before reset. | `safety.rs`, UI reset dialog | Rust + Vitest native contract + Playwright |
| Faults latch and never auto-resume. | `safety.rs`, `laser-jobs` | Rust tests, `ols-sim --inject` |
| Losing communication while armed or running is a fault. | `safety.rs` | `connection_loss_while_running_faults` |
| External-axis motion between sections happens with the laser off (a barrier segment). | `laser-motion`, `laser-jobs` | planner tests |
| Quitting the app triggers an emergency stop on the session. | `electron/main/index.ts` | manual |
| The renderer is sandboxed. IPC is whitelisted and zod-validated, and the sender is checked. | `preload`, `ipc.ts` | `contracts.test.ts` |
| Firmware: drivers are off at boot, the E-stop input is fail-safe (a broken wire reads as stop), and E-stop/limit/driver faults latch. | `firmware/.../ols_motion.c` | 72 host checks |

## What is not guaranteed

- The F1 protocol framing is **inferred** from public sources and has never been validated against a
  machine (`docs/research/F1_PROTOCOL.md`). The real F1 device path is therefore read-only.
- The F1's internal behaviour on communication loss is unknown.
- The software E-stop sends a stop request. It cannot cut power. Wire a hardware E-stop.
- The firmware has never run on hardware.

## Before any hardware work (future milestones)

1. Capture and document F1 traffic from the vendor software (`tools/protocol-inspector`).
2. Validate laser-off motion commands with the enclosure closed and power set to 0.
3. Only then add an emission validation step behind a separate, explicit, per-session
   confirmation, and document it here.
4. Bench-test the axis controller with the drivers unpowered, then powered with no load, then with
   the E-stop loop wired and tested.
