# CAD measurements

Status: **[implemented]** for the core tools. Values are millimetres internally.

Pick faces, edges or vertices in the CAD viewer, or use the toolbar tools. Each result is tagged:

| Quality | Meaning |
| --- | --- |
| **Exact** (`analytical`) | Read from an analytical B-Rep surface or curve (e.g. cylinder radius). |
| **Computed** | Numerical evaluation on exact geometry (extrema, curve length) with a stated tolerance. |
| **Mesh** (`mesh-derived`) | Computed from triangles. Accuracy follows the mesh, not the design intent. |
| **Fitted** | Ideal feature fitted to samples, with an RMS residual. |

The ideal STEP geometry is **not** the manufactured part. A measured Ø30.000 mm is the CAD radius;
it does not include machining tolerance, coating or as-built deviation.

## Tools

| Tool | Picks | Result |
| --- | --- | --- |
| Distance | 2 points / vertices / edges | Straight-line distance; surface picks are projected onto the face when B-Rep is available |
| Edge length | 1 edge | Curve length (closed-form for circles) |
| Radius / diameter | 1 cylindrical/spherical face or circular edge | Radius plus diameter |
| Angle | 2 lines, axes or planar faces | Unsigned degrees |
| Face to face | 2 faces | Normal separation of parallel planes; otherwise shortest distance (`BRepExtrema` or mesh) |
| Area | 1+ faces | Sum of face areas |
| Section plane | 1 face | Intersection polylines and their total length |

Measurements are persisted in `project.cad.measurements`. They become **stale** when the referenced
topology no longer matches after a reimport (geometry revision or signature). Display units (mm, cm,
in) and decimal places affect labels only.

**Export report…** writes a Markdown file of models, measurements, quality tags and the bound
workpiece. It is an inspection document, not a certificate of the physical part.
