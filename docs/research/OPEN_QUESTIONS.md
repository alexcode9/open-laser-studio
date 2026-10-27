# Open Questions (Spec Section 26)

Status as of Milestone 1. "Experiment" refers to the planned procedure; none have been run.

## F1 communication

| # | Question | Current answer | Confidence | Experiment |
|---|---|---|---|---|
| 1 | What protocol does the original F1 expose? | V1: G-code/TCP 8780 + HTTP 8080. V2 firmware (≥ 40.51.020.04): TLS WebSocket 28900. | DOCUMENTED | Read firmware version, probe both ports |
| 2 | Does TCP 8780 work on current firmware? | Probably not on V2 firmware | INFERRED | Probe 8780 on V2 device |
| 3 | Streaming and buffered jobs? | Streaming works (BeamInk). LightBurn requires "Buffered" mode. | DOCUMENTED | Proxy capture of LightBurn buffered job |
| 4 | How are commands acknowledged? | Device returns text; format unknown | UNKNOWN | Inspector: one line at a time, log replies and timing |
| 5 | Completion vs receipt? | Unknown. `/system?action=get_working_sta` is a candidate. | UNKNOWN | Poll working state during a long laser-off frame |
| 6 | Laser source selection? | `M114 S1` blue, `M114 S2` IR | DOCUMENTED | Laser-off source switch |
| 7 | Emission enable/disable? | `M3`/`M4` mode, `S` per move, `G0 S0` off | DOCUMENTED (usage) | Supervised only, after safety review |
| 8 | Does idle guarantee marking finished? | Unknown | UNKNOWN | Compare idle reply time to motion end (camera / photodiode) |
| 9 | TCP disconnect behavior? | Unknown; BeamInk stops defensively | UNKNOWN | Disconnect during laser-off frame |
| 10 | USB networking Windows vs Linux? | Linux documented; Windows unknown | UNKNOWN | Check adapter + IP on Windows |

## Multi-axis capabilities

| # | Question | Current answer | Confidence |
|---|---|---|---|
| 11 | Independent U-axis positioning? | Only via `M116` substitution with RA2 | DOCUMENTED (substitution only) |
| 12 | U motion overlapping galvo motion? | Unknown | UNKNOWN |
| 13 | What does `M116` change internally? | Remaps one logical axis to another | DOCUMENTED (behavior), internals UNKNOWN |
| 14 | Multiple mappings coexist? | Unknown | UNKNOWN |
| 15 | Motion commands queued in order? | Presumably | INFERRED |
| 16 | Does buffering affect completion? | Unknown | UNKNOWN |
| 17 | Reliable segmentation? | Unknown | UNKNOWN |
| 18 | Real-time rotary feedback? | None known | UNKNOWN |

## Synchronization

| # | Question | Answer |
|---|---|---|
| 19-21 | Latency, jitter, deterministic boundaries | UNKNOWN. Requires Phase 7 instrumentation (timestamped inspector + external sensor). |
| 22 | External motion during laser-off segments? | Only with an explicit barrier: wait for F1 idle, then move. This is what indexed mode does. |
| 23 | Physical sync signal without compromising safety? | Not investigated. Must not tap the laser-enable path. |
| 24 | Galvo compensation of small external motion? | Possible in principle (field is ~120 mm); requires measured tracking error. |
| 25 | Max safe synchronized segment? | None justified by evidence. **Zero** until measured. |

## Software

| # | Question | Answer |
|---|---|---|
| 26 | Editor library? | Konva + react-konva over an independent document model. See `docs/adr/0002-editor-library.md`. |
| 27 | Minimize duplication across machine types? | `Device` trait + capability flags + dialect-specific G-code emitters; composite device for multi-controller systems. |
| 28 | Representing synchronized motion in IR? | `MotionSegment` with `sync: SyncKind` (`None`, `Barrier`, `Coupled`) and explicit `Barrier` segments between sections. |
| 29 | Modes without deterministic sync? | Indexed engraving (stop-and-go), repeat marking, manual positioning. |
| 30 | Reusable BeamInk parts? | MIT. Only facts (ports, command sequence, power scale) are reused, re-implemented in Rust with attribution in `NOTICE`. No code copied. |
