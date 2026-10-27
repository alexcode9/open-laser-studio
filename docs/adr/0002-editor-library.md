# ADR 0002 — 2D editor rendering library

- **Status:** Accepted (2026-10-27)

## Options evaluated (spec Section 5.2 criteria)

| Criterion | Konva + react-konva | Paper.js | Fabric.js |
|---|---|---|---|
| Vector path editing | Path node, custom handles needed | Best (segments, handles, booleans) | Good |
| Large designs | Layer caching, `listening(false)`, good | Single scene graph, OK | OK |
| Accurate transforms | Explicit matrices, Transformer | Good | Good |
| SVG import | `Path` from `d` strings only | Built-in importer | Built-in importer |
| Boolean operations | None | Built-in | None |
| Layering / hit testing / selection | Good, Transformer built-in | Manual | Built-in |
| Editable text | Text node; editing via overlay | Basic | Built-in IText |
| High-DPI | Automatic pixelRatio | Manual | Automatic |
| React integration | First-class (react-konva) | None | None |
| Maintenance | Active (konva 10, react-konva 19) | Slow | Active |

## Decision
Konva + react-konva, as required by spec Section 3.4, rendering an **independent document model** held in Zustand.

- SVG import, booleans and text-to-outline are performed in Rust (`usvg`), not by the rendering library. This removes Paper.js's main advantage.
- Konva nodes are created from document objects by adapters (`packages/geometry-adapters`). Konva is never the source of truth.

## Consequences
- Path node editing (bezier handles) must be built on top of Konva; deferred beyond Milestone 1 (pen tool creates polylines/paths, editing is via transforms).
