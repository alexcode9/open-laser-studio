# CAD workpiece setup

Status: **[implemented]** for cylindrical features.

**Use as workpiece** aligns a ranked outer cylinder to the rotary axis and writes the cylinder
workpiece in one undo step. Inspection still works without a laser connected.

## Candidates

Cylinders are grouped when they are coaxial and of equal radius (explicit tolerances in
`packages/cad-kernel/src/features.ts`). Faces are classified inner (bore) vs outer only when
orientation and sampled normals agree. Ranking uses coaxiality, area and axial extent — never “the
longest bounding-box side”.

Each candidate shows diameter, axis, axial extent and circumference (π × D). Inner cylinders are
not offered as the rotary workpiece. Fitted mesh cylinders carry a residual; they can be used, but
the quality badge is Fitted, not Exact.

## Alignment

Rust computes `modelToWorkpiece` (`align_axis_to_rotary`):

- CAD axis → cylinder local +X (axial)
- `u = 0` at the chosen axial start
- seam `s = 0` along +Y

The user picks the seam angle and an optional reverse. Machine calibration (`angularZeroDeg`,
`axialZeroMm`) does **not** change unless the dialog’s explicit option is ticked.

On apply, the project sets `mode: cylinder`, `workpiece.diameterMm` / `lengthMm`, and
`cad.activeWorkpiece` together. The 3D preview draws the CAD mesh inside the same pose group as the
virtual chuck (`modelToWorkpiece`), so it rotates with A and translates with U.

Detach clears the binding and leaves the last numeric workpiece values in place.
