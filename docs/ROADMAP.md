# Roadmap

Milestones follow the development phases in the design spec (Section 22). Items are in priority
order within each milestone.

## Milestone 1: working desktop studio (simulation) ✅

Editor, cylindrical workspace, CAD inspection (STEP/STL/3MF, measurements, Use as Workpiece),
toolpath planner, simulator, indexed job engine, timeline and G-code inspector; Rust core with
napi bridge; tests, docs and packaging. See `CHANGELOG.md`.

## Milestone 2: F1 protocol evidence (read-only)

1. Implement `tools/protocol-inspector` (pcap → JSON lines) and capture XCS ↔ F1 sessions.
2. Turn every INFERRED item in `docs/research/F1_PROTOCOL.md` into VERIFIED or REFUTED, with citations.
3. Validate the read-only HTTP status endpoints on a real F1 behind developer mode.
4. Record F1 timing: line acknowledgement latency, working-state polling, and behaviour on disconnect.

## Milestone 3: F1 laser-off motion

1. Laser-off framing (`G0`, `S0`) on hardware, enclosure closed, using the existing allowlist.
2. Red-dot framing preview of the section bounds.
3. Measure the galvo field and the speed model; replace the placeholder profile values.

## Milestone 4: external controller bring-up

1. Build the firmware with ESP-IDF; follow the bench checklist in `docs/hardware/ESP32_CONTROLLER.md`.
2. Add a serial transport (`serialport` crate) behind developer mode; reuse `ExternalAxisDevice`.
3. Send calibration from the host (steps/unit, limits, velocities) and add protocol v1.1.
4. RMT/MCPWM step generation and a decelerating STOP.

## Milestone 5: indexed engraving on hardware

1. A per-session emission validation flow (explicit, logged, revocable) that enables
   `WriteGate.emission_validated`.
2. Low-power test patterns, seam alignment and the calibration wizard.
3. Job resume after a fault: an explicit re-plan from the next section, never automatic.

## Later

- Electronic gearing / helical mode research (spec Phase 7) and coordinated engraving (Phase 8).
- Raster improvements (overscan tuning, grayscale power mapping on the F1).
- Camera/framing assistance, material library, macOS/Linux packaging and signing.

## Known gaps carried from Milestone 1

- An AbortSignal that is already aborted does not reject the native planning task immediately (the
  result is discarded by the main process instead).
- F1 acceleration is modelled as instantaneous, so time estimates are lower bounds.
- Text is outlined with system fonts via usvg/fontdb, but new text always uses the generic
  `sans-serif` family. There is no font picker yet. If outlining fails, the UI shows a warning toast
  and keeps the text object without an outline.
