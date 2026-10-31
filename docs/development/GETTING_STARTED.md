# Getting started

## Prerequisites

| Tool | Version used in development | Notes |
| --- | --- | --- |
| Node.js | 22.20 (≥ 22 required) | |
| pnpm | 10.4 | `corepack enable` |
| Rust | 1.99 stable (MSRV 1.88) | edition 2024 |
| C toolchain | MSVC Build Tools on Windows, Xcode CLT on macOS, build-essential on Linux | needed by napi-rs |
| gcc / clang / zig | any | only for `pnpm test:firmware` |
| ESP-IDF | 5.2+ | only for building the firmware; **not** required for the app |

Developed and tested on Windows 11. macOS and Linux targets are configured but untested.

## First run

```sh
pnpm install
pnpm build:native        # builds crates/laser-node → apps/desktop/native/laser_node.node
pnpm dev                 # electron-vite dev server + Electron window
```

The app opens with the sample cylinder project in **Simulation** mode. To try a simulated job, go
to **Machine → Connect → Home → Prepare → Arm**, tick the three checklist items, then press **Start**. Raise the
simulation speed (e.g. 25×) to see the whole job quickly.

To scan for a real xTool laser (read-only), open **Find device** from the top bar or Machine panel. Enable
**Developer mode** and turn off **Simulation only** in Setup first. Selecting a device only stores its IP in the
project profile; jobs still run on the simulator.

If the native module is missing or stale, the window shows an error screen naming the expected path.
In that case, run `pnpm build:native` again.

## Production build and package

```sh
pnpm build               # electron-vite build → apps/desktop/out
pnpm package             # native + build + electron-builder → apps/desktop/release/<version>/
# unpacked only:
cd apps/desktop && npx electron-builder --config electron-builder.yml --dir
```

The native module ships as `resources/native/laser_node.node` (an `extraResources` entry).

## Command-line tools

```sh
cargo run -p simulator-cli -- --sample --csv timeline.csv
cargo run -p simulator-cli -- --project examples/sample-flat.ols --mode flat
cargo run -p simulator-cli -- --sample --inject '{"atS":4,"kind":{"type":"axisFault","code":"DRIVER"}}'
cargo run -p gcode-analyzer -- examples/sample-cylinder-f1.nc --dialect xtool-f1
node scripts/make-examples.mjs     # regenerate examples/ (needs the native module)
```

## Environment variables

| Variable | Effect |
| --- | --- |
| `OLS_USER_DATA_DIR` | override Electron `userData` (tests use a temp dir) |
| `OLS_NATIVE_PATH` | load the native module from an explicit path |
| `OLS_PACKAGED_EXE` | enables the packaged-app Playwright spec |
| `OLS_OCCT_DIR` | directory containing `opencascade.full.js` / `.wasm` (packaged app sets this) |

## Repository layout

```text
apps/desktop/            Electron app (electron/ main+preload, src/ renderer, tests/e2e)
packages/                shared-types, ipc-contracts, geometry-adapters, cad-kernel, ui
crates/                  Rust core (laser-*) and laser-node (napi bridge)
tools/                   simulator-cli (ols-sim), gcode-analyzer (ols-gcode), protocol-inspector (design)
firmware/                esp32-motion-controller (skeleton)
tests/fixtures/          cross-language fixtures (coordinates, axis frames, CAD)
examples/                sample projects, G-code and timelines
docs/                    architecture, research, hardware, protocols, user guide
```
