# Open Laser Studio

Open-source laser design and motion-control studio. The first target is the **xTool F1** galvo laser,
with an external **rotary (A) + linear (U)** axis for cylindrical engraving.

> **Milestone 1 is simulation-only.** The app designs, plans and simulates jobs end to end. It
> cannot make a real laser emit: the emission gate is hard-wired off, and real-device connections
> require developer mode. See [docs/SAFETY.md](docs/SAFETY.md).

## What works today

| Area | Status |
| --- | --- |
| 2D editor (Konva): rect, ellipse, polyline, text→outline, SVG and image import, layers, groups, transforms (45° rotation snaps), undo/redo, marquee selection | implemented |
| Cylindrical workspace: unwrapped surface, seams, wrapped ghosts, A/U readout, section overlay | implemented |
| 3D preview (React Three Fiber): textured cylinder, toolpath, head, beam, live spot, U carriage | implemented |
| Toolpath planning in Rust: vector, hatch fill, raster (threshold, Floyd–Steinberg, grayscale), indexed cylinder strategy, coupled strategy (experimental) | implemented |
| Simulator: virtual F1 + virtual axis controller, fault injection, speed 0–50× | implemented |
| Job engine: connect → home → prepare → arm (checklist) → run → completion, with barrier sync, pause at section boundaries, E-stop latch | simulated |
| Timeline (Gx, Gy, A, U, laser, state), G-code inspector and analyzer, protocol/job/safety logs | implemented |
| `.ols` project files (ZIP: JSON + assets + thumbnail), schema migrations | implemented |
| xTool F1 protocol | **inferred, unvalidated**; read-only probe only |
| ESP32-S3 axis controller firmware | skeleton; protocol and motion logic host-tested |

## Quick start

```sh
pnpm install
pnpm build:native
pnpm dev
```

Details, including prerequisites, packaging and the CLI tools, are in
[docs/development/GETTING_STARTED.md](docs/development/GETTING_STARTED.md). Testing is described in
[docs/development/TESTING.md](docs/development/TESTING.md).

## Architecture

Electron (sandboxed React renderer, validated IPC) on top of a Rust core loaded through napi-rs.
The Rust core owns geometry, planning, the simulator, device drivers and the safety state machine.
See [docs/architecture/OVERVIEW.md](docs/architecture/OVERVIEW.md).

```text
apps/desktop      Electron + React app
crates/           laser-core, -geometry, -motion, -gcode, -protocol, -devices, -simulator, -jobs, -project, laser-node
packages/         shared TS types, IPC contracts, geometry adapters, UI kit
tools/            ols-sim, ols-gcode, protocol-inspector (design)
firmware/         ESP32-S3 axis controller (skeleton)
```

## Documentation

- Architecture: [overview](docs/architecture/OVERVIEW.md), [motion model](docs/architecture/MOTION_MODEL.md), [job execution](docs/architecture/JOB_EXECUTION.md)
- Research: [F1 protocol](docs/research/F1_PROTOCOL.md), [evidence](docs/research/PROTOCOL_EVIDENCE.md), [open questions](docs/research/OPEN_QUESTIONS.md), [reference projects](docs/research/REFERENCE_PROJECTS.md)
- Hardware: [ESP32 controller](docs/hardware/ESP32_CONTROLLER.md), [wiring](docs/hardware/WIRING.md), [axis protocol](docs/protocols/AXIS_CONTROLLER_PROTOCOL.md)
- User guide: [cylindrical engraving](docs/user-guide/CYLINDRICAL_ENGRAVING.md)
- [Safety](docs/SAFETY.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).
