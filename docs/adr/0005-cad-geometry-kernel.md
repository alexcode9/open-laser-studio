# ADR 0005 — CAD geometry kernel in an Electron utility process

- **Status:** Accepted (2026-10-28)

## Context

The CAD Inspection workspace must import STEP with B-Rep preserved, tessellate for display, and
measure analytical surfaces. The renderer is sandboxed: its CSP does not allow wasm, and ADR 0003
requires every transform that affects machine output to live in Rust. Three kernel options were
considered:

| Candidate | Why not (or why) |
| --- | --- |
| occt-import-js | Mesh-only; no B-Rep, no analytical radius/axis. |
| tx-code/occt-js npm | Incomplete measurement API for this milestone. |
| **opencascade.js 2.0.0-beta** (OCCT 7.6) | Full B-Rep: `STEPCAFControl_Reader`, `TopExp`, `BRepAdaptor`, `BRepGProp`, `BRepExtrema`, `BRepMesh`, `BRepAlgoAPI_Section`, `STEPControl_Writer`. |

## Decision

Run **opencascade.js 2.0.0-beta** inside an Electron `utilityProcess` (`packages/cad-kernel`, entry
`apps/desktop/electron/cad/kernel-entry.ts`), hosted by `CadHost` in the main process.

- The renderer never loads wasm. It talks to main over zod-validated `cad:*` IPC.
- A crash, hang or out-of-memory error kills only the kernel process. Cancel and timeout restart it;
  source bytes stay in `CadHost` so models can be reloaded.
- B-Rep stays in the kernel for later queries (measure, section). Display meshes (`triangleToFace`,
  edge polylines) are sent to the renderer.
- STEP coordinates are read with `xstep.cascade.unit=MM`. Mesh formats (STL, 3MF) are scaled to
  millimetres after the file unit is known.
- `modelToWorkpiece` is computed in Rust (`laser-geometry::align_axis_to_rotary`). The kernel never
  writes machine coordinates.

## Consequences

- The packaged app ships `opencascade.full.js` / `.wasm` as extra resources (~60 MB). Init takes
  several seconds; the host warms the process on first CAD use.
- opencascade.js is LGPL-2.1-only (Open CASCADE Technology). Attribution is in `NOTICE`.
- Arbitrary non-cylindrical surfaces remain inspection-only. Rotary workpiece setup requires a
  ranked cylindrical feature.
