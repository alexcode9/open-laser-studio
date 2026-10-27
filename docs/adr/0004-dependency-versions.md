# ADR 0004 — Dependency versions (October 2026)

- **Status:** Accepted (2026-10-27)

Versions were checked against the npm and crates.io registries on 2026-10-27.

| Package | Version | Notes |
|---|---|---|
| electron | 45 | Current stable |
| electron-vite | 6 | Peer: vite ^6 / ^7 / ^8 |
| vite | 8 | |
| @vitejs/plugin-react | 6 | Requires vite ^8 |
| react / react-dom | 19.3 | Required by react-konva 19.3 |
| konva / react-konva | 10 / 19 | |
| three / @react-three/fiber / drei | 0.186 / 9 / 10 | |
| zustand | 5 | |
| tailwindcss + @tailwindcss/vite | 4 | |
| zod | 4 | IPC payload validation |
| react-resizable-panels | 4 | Basis of shadcn "Resizable" |
| Radix UI primitives | latest | shadcn-style components are vendored in `packages/ui` |
| typescript | **5.9.3** | TypeScript 7 exists, but typescript-eslint requires `<6.1` |
| vitest | 5 | |
| @playwright/test | 1.64 | Electron e2e |
| electron-builder | 26 | Packaging |
| napi / napi-derive (Rust) | 3 | N-API 8 |
| @napi-rs/cli | 3 | Builds `laser-node` |
| usvg | 0.49 | SVG import and text-to-path |
| image | 0.25 | PNG/JPEG/BMP decoding for raster |
| zip | 9 | `.ols` container |

## Excluded
- Tauri, Flutter, React Native, Python runtime (spec 3.12).
- `serialport` crate: deferred until real ESP32 hardware exists (avoids libudev on Linux CI).
