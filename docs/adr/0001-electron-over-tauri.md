# ADR 0001 — Electron desktop runtime

- **Status:** Accepted (2026-10-27)

## Context
The master specification originally named Tauri 2. Section 3 ("Required technology stack") replaced it with Electron + React + Three.js and Section 3.12 explicitly excludes Tauri, stating that all other sections are to be interpreted through the revised stack. Sections 4, 22 and 27 still mention Tauri / `src-tauri`.

## Decision
Use Electron with electron-vite. All remaining Tauri references map to Electron:
- `src-tauri/` → `apps/desktop/electron/{main,preload,ipc}`
- Tauri commands → typed Electron IPC validated with zod
- Rust backend → N-API native module (`crates/laser-node`) loaded only in the main process

## Consequences
- The renderer is sandboxed with `contextIsolation`; it never touches sockets, serial ports or native code.
- Larger installer than Tauri; acceptable for a desktop engineering tool.
