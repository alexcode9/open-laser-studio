# CAD import

Status: **[implemented]** for STEP, STL and 3MF. Geometry inspection does not need a laser.

Open **CAD** in the top bar (or drop a file on the CAD viewer). Supported extensions: `.step`,
`.stp`, `.stl`, `.3mf`. The file is read in the main process (200 MB limit) and parsed in the CAD
kernel utility process. Absolute paths are never stored.

## Formats

| Format | Geometry | Units | Notes |
| --- | --- | --- | --- |
| STEP | Exact B-Rep (solids, faces, edges, vertices) plus a display tessellation | From `FileUnits`; coordinates arrive in millimetres | Assemblies keep instance transforms. External file references are refused. |
| STL | Triangle mesh (binary or ASCII) | Unspecified until the user confirms | Measurements are mesh-derived or fitted. |
| 3MF | Triangle mesh, including multi-part build items | Declared on `<model unit>` | Converted to millimetres. Unknown units are assumed millimetres with a warning. |

A STEP file whose product name is a generic exporter placeholder is renamed from the file name so
the tree does not show “Open CASCADE STEP translator”.

## What is stored

The project records a `CadModelRef` (checksum, declared unit, `sourceToModel`, visibility). The
original bytes go into the `.ols` ZIP as `cad/<sha256>.<ext>` (schema version 2). Derived topology
and meshes are rebuilt on open. A missing file or checksum mismatch is a recoverable warning; the
app does not substitute other geometry.

## Display

The viewer tessellates STEP with a chordal deflection chosen from the bounding-box diagonal (or an
explicit `deflectionMm`). Each triangle maps back to a B-Rep face via `triangleToFace`. Large models
(> 1.5 M triangles) raise a warning; import is refused above 8 M display triangles.

Progress: reading → transferring → meshing → analyzing → features. Cancel kills the kernel process.
