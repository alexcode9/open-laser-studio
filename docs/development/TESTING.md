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
| Rust unit + integration | 105 | units, safety FSM (every transition class), cylinder transform, flattening, hatch/raster/indexed/coupled planning, timing, G-code parse/validate/emit, F1 + axis framing, write gate, simulator faults, job runner, `.ols` roundtrip/migration |
| Vitest | 41 | geometry adapters vs. the Rust fixtures, IPC schemas + channel whitelist, settings safety flags, project store history, shape math, timeline sampling, **native contract** (Rust sample project passes the zod schema; full simulated job; E-stop latch) |
| Firmware host | 72 checks | CRC check value, golden frames shared with Rust, framer overflow, controller handshake/homing/limits/BUSY, E-stop latch, home timeout, link watchdog |
| Playwright | 6 + 1 opt-in | startup in simulation mode, drawing + undo/redo, flat/cylinder switch, full simulated job, E-stop latch + reset gating, no renderer errors; packaged-exe launch (`OLS_PACKAGED_EXE`) |

## Cross-language fixtures

- `tests/fixtures/coordinates.json`: surface ↔ machine, galvo projection, focus error and seam
  wrapping. Checked by `crates/laser-geometry/tests/fixtures.rs` and `packages/geometry-adapters`.
- `tests/fixtures/axis_frames.json`: axis protocol golden frames. Checked by
  `crates/laser-protocol/tests/axis_fixtures.rs`; the firmware host tests hold the same values as C
  literals.

## Notes

- The native contract tests skip themselves when `apps/desktop/native/laser_node.node` is missing.
- Playwright runs with one worker and a temporary `userData` directory, and it writes screenshots to
  `apps/desktop/test-results/`.
- No test talks to real hardware. The F1 transport tests use in-memory transports.
