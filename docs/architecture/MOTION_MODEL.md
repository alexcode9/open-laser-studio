# Motion model

The machine has four coordinates:

| Axis | Meaning | Unit | Driven by |
| --- | --- | --- | --- |
| X, Y | Galvo field position (F1 field ~115 × 115 mm, centered at 0,0) | mm | xTool F1 |
| A | Rotary axis: workpiece rotation | deg | external ESP32-S3 controller |
| U | Linear carriage: workpiece translation along its axis | mm | external ESP32-S3 controller |

`MachinePosition { x, y, a_deg, u_mm }` (`crates/laser-core`) is used everywhere: planner,
simulator, timeline and UI readouts.

## Design space

- **Flat mode**: design (x, y) = galvo (x, y) in mm. **[implemented]**
- **Cylinder mode**: design x = **u** (axial position along the workpiece, mm), and design y = **s**
  (arc length around the circumference, mm, `0 ≤ s < C`, `C = π·D`). The editor shows the unwrapped
  surface with seam lines and wrapped ghost copies. **[implemented]**

## Conversions (`crates/laser-geometry/src/cylinder.rs`)

With radius `R = D/2`, angular zero `A0`, axial zero `U0` and rotation sign `σ = ±1`:

```text
A(s)        = A0 + σ · s / C · 360°
U(u)        = U0 + u
s(A)        = (A − A0) · σ / 360° · C
wrap(s)     = (floor(s / C), s mod C)          revolution index + in-range arc
local3D     = (u, R cos(s/R), R sin(s/R))       cylinder axis = +X, top = +Y
galvo(ds)   = R · sin(ds / R)                   arc offset from the top line → galvo offset
focus(ds)   = R · (1 − cos(ds / R))             drop below the focal plane
halfWindow  = R · acos(1 − maxFocusError / R)   largest arc that stays in focus
helix       U = U0 + P · A / 360°
```

The TypeScript mirror (`packages/geometry-adapters`) implements the same functions. Both are tested
against `tests/fixtures/coordinates.json`.

## Strategies

### A — Indexed (default) **[implemented, sim-only]**

1. Split the artwork into sections: the axial width is limited by the galvo field and
   `sectionWidthMm`, and the circumferential window is limited by `halfWindow` (or by
   `angularWindowMm`).
2. For each section: move A/U so that the section center is under the field center (a **barrier**
   segment; the laser is guaranteed off), wait for the controller's `CMP` and verify the position, settle,
   then run the section's galvo program with the workpiece stationary.
3. Strokes that cross a section boundary are clipped. Pieces shorter than `sectionOverlapMm`
   stay with their neighbour.

The workpiece never moves while the laser is on. This is the only strategy intended for hardware.

### B/C — Coupled / helical **[experimental, simulation only]**

The galvo is held at the field center while A/U follow the artwork. This needs synchronized
motion between the F1 and the external axes. The F1 offers no synchronization mechanism we know of
(see `docs/research/OPEN_QUESTIONS.md`), so the planner marks these plans `simulationOnly`, and
`prepare` refuses them for real devices.

## Segments and timing

`MotionSegment` holds the start/end `MachinePosition`, its kind (`Travel`, `Mark`, `Dwell` or
`Barrier`), its sync type (`None`, `Barrier` or `Coupled`), laser power, speed, duration, layer and
section. Durations use trapezoidal profiles with per-axis velocity/acceleration limits taken from the machine
profile. The galvo jump and mark speeds are profile values. The F1's real acceleration is **unknown**
and is modelled as instantaneous, which is why the time estimates are lower bounds.

The kinematic timeline (`TimelineBuffers`) samples the plan at `sampleDt`. Each sample has t, gx, gy,
a, u, laser, power, state, section, segment, the pose (rotX, tx) and the 3D spot position. The renderer
plays this back with binary search and linear interpolation.
