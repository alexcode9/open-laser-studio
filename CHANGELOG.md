# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — Milestone 1

### Added
- Find device dialog (USB / Wi-Fi / manual IP): V1 UDP discovery on port 20000, USB gadget probe (`201.234.3.1` / `201.234.4.1`), read-only identify, and saving the chosen host into the machine profile. Jobs remain simulated; access stays gated behind developer mode + simulation-only off. Native API version 3.
- CAD Inspection workspace: STEP/STL/3MF import in an isolated Open CASCADE kernel (`utilityProcess`), B-Rep measurements with quality tags, section planes, mesh cylinder fitting, assembly isolate, measurement report export, and Use as Workpiece (Rust `modelToWorkpiece`). Schema v2 `.ols` files embed CAD sources under `cad/<sha256>.<ext>`.
- Research documents for the xTool F1 protocol with confidence-tagged evidence.
- pnpm + Cargo monorepo: Electron/React desktop app and Rust core crates.
- Rust: units, safety state machine, machine profiles, cylinder transforms, G-code parser/validator/F1 dialect, toolpath planner (vector, fill, raster, indexed, coupled), simulator, device abstraction (simulator, F1, external controller, composite), external-controller serial protocol + emulator, indexed job engine, `.ols` project format.
- N-API bridge (`laser-node`) and typed, validated Electron IPC.
- Desktop UI: Konva 2D editor, R3F cylindrical preview, simulation timeline, G-code inspector, machine configuration, calibration calculators.
- `ols-sim` (simulator CLI with fault injection, CSV/JSON timeline export) and `ols-gcode` (G-code analyzer) tools; protocol-inspector design notes.
- Example projects, G-code and timelines in `examples/` (`scripts/make-examples.mjs`).
- ESP32-S3 firmware skeleton: portable protocol + motion components with 72 host-run checks; ESP-IDF board layer (not compiled in this milestone).
- Cross-language fixtures: `tests/fixtures/coordinates.json` (Rust ↔ TS) and `tests/fixtures/axis_frames.json` (Rust ↔ firmware C).
- Vitest suites for IPC contracts, settings safety flags, stores and a native contract test; Playwright Electron smoke tests and a packaged-app launch test.
- `electron-builder.yml` (Windows NSIS / macOS DMG / Linux AppImage; native module as an extra resource).
- Documentation set from spec Section 23, plus `docs/ROADMAP.md` and the axis controller protocol specification.

### Fixed
- `.ols` files now round-trip floating-point values exactly (`serde_json` `float_roundtrip`).

### Safety
- `simulationOnly` is enabled by default. No laser-emission command can be sent to real hardware in this release.
