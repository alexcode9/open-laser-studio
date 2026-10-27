# Contributing

## Ground rules

1. **Safety first.** Read [docs/SAFETY.md](docs/SAFETY.md). Never add code that emits laser light on real hardware without a validated protocol entry in `docs/research/PROTOCOL_EVIDENCE.md` and a review.
2. **Evidence over assumption.** When you change protocol behavior, update `docs/research/F1_PROTOCOL.md` and `PROTOCOL_EVIDENCE.md` with source, exact command, device model, firmware, and confidence level.
3. **One geometry source.** Coordinate transforms belong in `crates/laser-geometry` / `crates/laser-motion`. The UI must not re-implement them (see `docs/adr/0003-rust-owns-geometry.md`).
4. **Explicit units.** Field names carry units (`speed_mm_s`, `a_deg`, `u_mm`).

## Workflow

```bash
pnpm install
pnpm build:native   # builds the Rust N-API module
pnpm dev            # starts the Electron app
pnpm test           # cargo test + vitest
pnpm lint           # eslint + clippy
pnpm format         # prettier + rustfmt
```

See [docs/development/GETTING_STARTED.md](docs/development/GETTING_STARTED.md) and [docs/development/TESTING.md](docs/development/TESTING.md).

## Commits and changelog

Add a line to `CHANGELOG.md` under *Unreleased* for user-visible changes.
