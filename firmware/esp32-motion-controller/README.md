# ESP32-S3 axis controller (skeleton)

Drives the external rotary **A** axis and linear **U** carriage for cylindrical engraving with the
xTool F1. It speaks the OLS axis protocol v1 (`docs/protocols/AXIS_CONTROLLER_PROTOCOL.md`) over
USB-CDC. It never controls the laser; the F1 keeps its own interlocks.

> **Status: UNVALIDATED.** This firmware has never been compiled for the ESP32-S3 or run on
> hardware. ESP-IDF is not installed in the development environment used for Milestone 1. Only
> the portable components are compiled and unit-tested on the host (see below). Do **not** flash it to
> hardware connected to a machine until the wiring has been reviewed and the bench procedure in
> `docs/ESP32_CONTROLLER.md` has been followed, starting with the drivers unpowered.

## Layout

| Path | What | Built where |
| --- | --- | --- |
| `components/ols_protocol` | Frame encode/decode, CRC-16/CCITT-FALSE, line framer | host tests + IDF |
| `components/ols_motion` | Controller state machine, trapezoid profiles, homing, E-stop/limit/fault latching | host tests + IDF |
| `components/ols_board` | Pins, GPTimer step generator, debounced inputs, USB-Serial-JTAG link | IDF only |
| `main/main.c` | 1 kHz control task wiring the above together | IDF only |
| `test/host/test_main.c` | 72 host checks incl. golden frames shared with Rust | host |

`ols_motion` mirrors the host simulator's `VirtualAxisController`
(`crates/laser-simulator/src/axis_ctrl.rs`): same states (`DISABLED IDLE MOVING HOMING FAULT ESTOP`),
the same rejection codes (`FRAME UNKNOWN STATE DISABLED BUSY ARG NOT_HOMED LIMIT ABORTED`) and the same
message order (`ACC` → `STA` → `CMP`). The firmware adds a few checks on top of the simulator:

- `RESET` is refused while the hardware E-stop input is still active.
- Homing faults with `HOME_TIMEOUT` if the switch is not found within `home_search_mm`.
- An optional host-link watchdog (`link_timeout_s`, off by default) raises `FLT code=LINK` during motion.
- Faults during motion first send `REJ code=ABORTED` for the active sequence number, then `FLT` with seq 0.

## Safety behaviour

- Drivers are disabled at boot and stay disabled until the host sends `ENABLE`.
- E-stop is wired normally-closed with a pull-up, so a broken wire reads as an active E-stop. The
  hardware E-stop loop must cut motor power on its own; the firmware only observes it.
- E-stop and faults latch. Motion is never resumed automatically, and releasing the button does not
  clear the latch. The host has to send `RESET`, which leaves the controller `DISABLED`, then `ENABLE`
  and `HOME` again. E-stop also clears `homed`.
- The limit switch outside homing raises `FLT LIMIT` and clears `homed`.

## Host tests (no ESP-IDF needed)

```sh
node scripts/test-firmware-host.mjs      # uses gcc, clang or `zig cc`
```

The golden frames in `test/host/test_main.c` are copied from `tests/fixtures/axis_frames.json`. The
Rust side (`crates/laser-protocol/tests/axis_fixtures.rs`) checks the same file, so protocol drift
shows up in both test suites.

## Building for the target (not verified)

```sh
. $IDF_PATH/export.sh          # ESP-IDF v5.2+
idf.py set-target esp32s3
idf.py build
```

## Open items

- Pin map and step/mm values in `ols_board.h` are placeholders.
- Replace the GPTimer bit-bang step generator with RMT or MCPWM, add a decelerating STOP, and
  add StallGuard/encoder support.
- Pass calibration (steps/deg, steps/mm, limits) from the host instead of compile-time constants.
- A bench test plan with logic-analyzer captures of the step timing.
