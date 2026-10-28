# Testing

```sh
pnpm test            # Rust + Vitest + firmware host tests
pnpm test:rust       # cargo test --workspace
pnpm test:js         # vitest run
pnpm test:firmware   # firmware portable C (gcc/clang/zig cc)
pnpm build && pnpm test:e2e     # Playwright against the built Electron app
pnpm lint            # eslint + cargo clippy -D warnings
pnpm typecheck
```

## Suites (Milestone 1 counts)

| Suite | Count | Covers |
| --- | --- | --- |
| Rust unit + integration | 116 | units, safety FSM (every transition class), cylinder transform, CAD `align_axis_to_rotary`, flattening, hatch/raster/indexed/coupled planning, timing, G-code parse/validate/emit, F1 + axis framing, write gate, simulator faults, job runner, `.ols` roundtrip/migration/CAD checksum |
| Vitest | 82 | geometry adapters vs. the Rust fixtures, IPC schemas + channel whitelist, CAD kernel (fixtures A–G, 3MF, section, fit), CadHost, settings safety flags, project store history, shape math, timeline sampling, **native contract** (Rust sample project passes the zod schema; full simulated job; E-stop latch) |
| Firmware host | 72 checks | CRC check value, golden frames shared with Rust, framer overflow, controller handshake/homing/limits/BUSY, E-stop latch, home timeout, link watchdog |
| Playwright | 12 + 1 opt-in | CAD milestone (import Ø30×150, measure, Use as Workpiece, save/reopen); startup in simulation mode, drawing + undo/redo, flat/cylinder switch, full simulated job, E-stop latch + reset gating, no renderer errors; packaged-exe launch (`OLS_PACKAGED_EXE`) |

## Cross-language fixtures

- `tests/fixtures/coordinates.json`: surface ↔ machine, galvo projection, focus error and seam
  wrapping. Checked by `crates/laser-geometry/tests/fixtures.rs` and `packages/geometry-adapters`.
- `tests/fixtures/cad_alignment.json`: CAD axis → rotary workpiece. Checked by
  `crates/laser-geometry` and the CAD milestone Vitest suite.
- `tests/fixtures/cad/`: STEP/STL/3MF fixtures A–G. See [CAD_FIXTURES.md](../testing/CAD_FIXTURES.md).
- `tests/fixtures/axis_frames.json`: axis protocol golden frames. Checked by
  `crates/laser-protocol/tests/axis_fixtures.rs`; the firmware host tests hold the same values as C
  literals.

## Notes

- The native contract tests skip themselves when `apps/desktop/native/laser_node.node` is missing.
- Playwright runs with one worker and a temporary `userData` directory, and it writes screenshots to
  `apps/desktop/test-results/`.
- No test talks to real hardware. The F1 transport tests use in-memory transports.
