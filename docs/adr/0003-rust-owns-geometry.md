# ADR 0003 — Rust owns geometry, motion and simulation

- **Status:** Accepted (2026-10-27)

## Decision
All coordinate transforms that affect machine output live in `crates/laser-geometry` and `crates/laser-motion`:
- design → machine (flat mode)
- surface (u, s) → machine (Gx, Gy, A, U) for indexed and coupled strategies
- surface → 3D world (cylinder mesh, toolpath overlay)

The renderer receives **buffers** (`Float64Array`/`Float32Array`) from Rust for the cylinder mesh, the toolpath overlay and the simulation timeline. It applies only one transform itself: the cylinder group rotation `rotation.x = -A` (radians) and translation `x = U`. A shared fixture (`tests/fixtures/coordinates.json`) is checked by both Rust and Vitest tests so this convention cannot drift.

The 2D editor works in document millimetres. In cylindrical mode the document *is* the unwrapped surface (x = u axial, y = s circumferential), so no separate 2D transform exists.

## Consequences
- The UI calls the native module (through IPC) whenever the toolpath or mesh must be regenerated. Calls are async and debounced.
- Rust code can be tested headless (`cargo test`, `tools/simulator-cli`).
