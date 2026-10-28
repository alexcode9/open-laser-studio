# Coordinate systems

Machine and design frames are defined in [MOTION_MODEL.md](MOTION_MODEL.md). This page adds the CAD
spaces used by import, alignment and the 3D preview.

## Frames

| Space | Unit | Origin / axes | Who writes it |
| --- | --- | --- | --- |
| **Source** | File unit (mm, inch, …) | As in the CAD file | Kernel (read-only) |
| **Model** | millimetres | Source × `sourceToModel` (uniform scale). Assembly instance transforms applied. | Kernel |
| **Workpiece** (cylinder local) | millimetres | +X axial, `u = 0` at the selected cylinder start; seam `s = 0` on +Y; `s` towards +Z | Rust `align_axis_to_rotary` → `modelToWorkpiece` |
| **Machine** | deg / mm | A, U from the cylinder transform (`CylinderTransform::pose`) | Rust |
| **World / preview** | millimetres | Workpiece pose group: rotate by A, translate by U | Renderer applies only that pose |

`Mat4` is column-major, the same layout as three.js `Matrix4.elements`. `modelToWorkpiece` is rigid
(rotation + translation, never scale) so the inverse is exact.

Cylinder surface mapping (workpiece):

```text
(u, s) → (u, R cos(s/R), R sin(s/R))     s = 0 on +Y
```

Shared numeric cases live in `tests/fixtures/coordinates.json` (surface ↔ machine) and
`tests/fixtures/cad_alignment.json` (CAD axis → workpiece). Both Rust and Vitest check them.

## What the renderer may do

The CAD viewer orbits in **model** millimetres. The design preview multiplies the CAD mesh by
`modelToWorkpiece` and parents it to the chuck pose group. The renderer does not invert axes, swap
handedness or bake scale into the mesh.

Machine calibration (`angularZeroDeg`, `axialZeroMm`) is independent of CAD alignment. Binding a
CAD cylinder sets diameter and length; it does not move the machine zeros unless the user ticks
that option.
