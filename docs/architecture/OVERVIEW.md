# Architecture overview

Status legend: **[implemented]** works and is covered by tests in Milestone 1 · **[sim-only]**
implemented but only exercised against simulated devices · **[planned]** not implemented.

## Processes and layers

```mermaid
flowchart LR
  subgraph Renderer["Renderer (sandboxed, React)"]
    UI[Panels / Toolbar] --> Stores[Zustand stores<br/>project · plan · machine · playback]
    Editor[Konva 2D editor] --> Stores
    View3D[R3F cylinder view] --> Stores
    Stores --> IPCc[lib/ipc.ts]
  end
  subgraph Preload["Preload (CJS, contextBridge)"]
    Bridge["window.ols.invoke / on<br/>channel whitelist"]
  end
  subgraph Main["Electron main (Node)"]
    IPC[ipc.ts<br/>zod validation · sender check · envelope]
    Settings[SettingsStore<br/>simulationOnly / developerMode]
    Host[MachineHost<br/>~30 Hz tick · snapshots]
    Native[laser_node.node]
  end
  subgraph Rust["Rust core (crates/)"]
    Core[laser-core<br/>units · safety FSM · profiles]
    Geo[laser-geometry]
    Motion[laser-motion<br/>planner · strategies]
    GC[laser-gcode]
    Proto[laser-protocol<br/>F1 · axis v1 · WriteGate]
    Dev[laser-devices]
    Sim[laser-simulator]
    Jobs[laser-jobs<br/>SimSession · JobRunner]
    Proj[laser-project<br/>.ols · SVG · images]
  end
  IPCc --> Bridge --> IPC
  IPC --> Settings
  IPC --> Host --> Native
  IPC --> Native
  Native --> Jobs & Motion & Proj & GC & Geo
  Jobs --> Dev --> Sim
  Dev --> Proto
  Motion --> Geo --> Core
```

| Layer | Responsibility | Status |
| --- | --- | --- |
| Renderer | Editing, preview, playback, presenting machine state. Never talks to devices. | [implemented] |
| Preload | Exposes exactly two functions and only whitelisted channels. | [implemented] |
| Main | Validates every request (zod), owns settings and the safety flags, hosts the simulated machine session, and gates file writes to dialog-returned paths. | [implemented] |
| `laser-core` | Units, `MachinePosition`, safety state machine, machine profile with validation. | [implemented] |
| `laser-geometry` | Path flattening, transforms, cylinder transform (surface ↔ machine ↔ 3D), mesh generation. | [implemented] |
| `laser-motion` | Toolpath planning: vector, hatch fill, raster, the indexed cylinder strategy and the coupled (experimental) strategy. Also the kinematic timeline and 3D overlays. | [implemented] |
| `laser-gcode` | Parser, validator, F1 dialect emitter and analyzer. | [implemented] |
| `laser-protocol` | F1 TCP/HTTP framing (inferred), axis protocol v1, `WriteGate`, line framer. | [implemented] (F1 framing **unvalidated**) |
| `laser-devices` | `LaserDevice` / `AxisController` traits; simulated F1; real F1 (connect/probe only); external controller over a transport. | [sim-only] |
| `laser-simulator` | Virtual F1 + virtual axis controller with fault injection and timing. | [implemented] |
| `laser-jobs` | `SimSession`, indexed job runner (barrier-synchronized), logs, outcome. | [implemented] |
| `laser-project` | `.ols` ZIP container, migrations, SVG import, image import, text-to-path. | [implemented] |
| `firmware/esp32-motion-controller` | Axis controller firmware. | skeleton; host-tested logic only |

## Data flow: design → toolpath → preview → simulated job

```mermaid
sequenceDiagram
  participant R as Renderer
  participant M as Main
  participant N as Rust (napi)
  R->>R: edit project (undo/redo history)
  R->>M: toolpath:plan {project} (debounced 250 ms, latest wins)
  M->>N: planToolpath(project, AbortSignal)
  N-->>R: PlanResult (summary, 3D positions, 2D segments, G-code)
  R->>M: toolpath:preview {project, sampleDt}
  N-->>R: TimelineBuffers (typed arrays)
  R->>M: machine:setProject (300 ms debounce, not while armed/running)
  R->>M: machine:command connect/home/prepare/arm/start
  loop every ~33 ms
    M->>N: session.tick(dt × speed)
    M-->>R: machine:snapshot event
  end
  R->>M: machine:timeline {fromSample} (incremental)
```

## Coordinate frames

The four coordinate frames are described in [MOTION_MODEL.md](MOTION_MODEL.md):
design (u, s), galvo (x, y), machine (A, U) and 3D (the cylinder's local frame). One Rust
implementation of each conversion is mirrored by `packages/geometry-adapters` for UI-only use. The two
implementations are kept in sync by `tests/fixtures/coordinates.json`, which both test suites check.

## Key decisions

See `docs/adr/`:

- [0001](../adr/0001-electron-over-tauri.md): Electron instead of Tauri.
- [0002](../adr/0002-editor-library.md): Konva for the editor.
- [0003](../adr/0003-rust-owns-geometry.md): Rust owns geometry and motion.
- [0004](../adr/0004-dependency-versions.md): pinned dependency versions.
