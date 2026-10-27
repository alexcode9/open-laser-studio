# OLS axis controller protocol v1

The serial protocol between Open Laser Studio and the external A/U axis controller
(`firmware/esp32-motion-controller`). Reference implementations:

- Host side: `crates/laser-protocol/src/axis.rs`.
- Simulator: `crates/laser-simulator/src/axis_ctrl.rs`.
- Firmware: `components/ols_protocol` and `components/ols_motion`.

All three are tested against `tests/fixtures/axis_frames.json`.

Status: **implemented in host, simulator and firmware logic; never run over a real serial link.**

## Transport

USB-CDC (ESP32-S3 USB-Serial-JTAG), 115200 baud nominal (the baud rate is ignored for CDC), 8N1. Text
frames, one per line, at most 192 bytes.

## Frame

```text
@<seq>:<TYPE>[:<k>=<v>[,<k>=<v>…]]*<CRC16>\n
```

- `seq`: decimal u32 chosen by the host. Responses echo it. Unsolicited messages use `0`.
- `CRC16`: CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0) over the bytes
  between `@` and `*`, written as 4 uppercase hex digits. Check value: `CRC("123456789") = 29B1`.
- Values must not contain `,` `=` `*` or newlines.
- A frame with a bad CRC or bad syntax is answered with `@0:REJ:code=FRAME,...`.

Example: `@7:MOVE:A=90.0000,U=12.5000*F291`

## Requests (host → controller)

| Type | Payload | Response |
| --- | --- | --- |
| `HELLO` | `proto=1` | `HELLO proto=1,fw=<version>` |
| `CAPS` | — | `CAP axes=A U,enc=0|1,estop=0|1` |
| `STATUS` | — | `ST state=…,A=…,U=…,homed=0|1,en=0|1` |
| `ENABLE` / `DISABLE` | — | `ACC` or `REJ` |
| `HOME` | `axis=U` | `ACC`, `STA`, later `CMP A=…,U=…` |
| `MOVE` | `A=<deg>` and/or `U=<mm>` (absolute) | `ACC`, `STA`, later `CMP A=…,U=…` |
| `STOP` | — | `REJ code=ABORTED` for the active move, then `ACC` |
| `ESTOP` | — | `ACC`, then `FLT code=ESTOP` (seq 0) |
| `RESET` | — | `ACC` (latched → `DISABLED`) or `REJ code=STATE` |

## Responses (controller → host)

`ACC` (accepted), `STA` (motion started), `CMP` (completed, with final position), `REJ`
(rejected, with `code` and `msg`), `FLT` (fault, seq 0), `ST` (status), `HELLO`, `CAP`. A bare
"ok" is never used: acceptance and completion are separate messages, so the host can always tell
"command received" apart from "motion finished".

## States

`DISABLED → (ENABLE) → IDLE → (MOVE/HOME) → MOVING/HOMING → IDLE`. `FAULT` and `ESTOP` latch.
`RESET` returns to `DISABLED`. The firmware refuses `RESET` while the hardware E-stop input is
active.

## Rejection codes

| Code | Meaning |
| --- | --- |
| `FRAME` | CRC or syntax error |
| `UNKNOWN` | unknown request type |
| `STATE` | fault/E-stop latched, or reset not possible |
| `DISABLED` | drivers disabled |
| `BUSY` | motion in progress |
| `ARG` | non-finite or malformed target |
| `NOT_HOMED` | U move requested before homing |
| `LIMIT` | target outside soft limits |
| `ABORTED` | active motion stopped by STOP or by a fault |

## Fault codes

`ESTOP`, `LIMIT`, `DRIVER`, `HOME_TIMEOUT`, `LINK` (optional host-silence watchdog). The simulator can
inject arbitrary `[A-Z_]` codes.

## Versioning

A breaking change bumps `proto`. The host refuses controllers whose `HELLO proto` doesn't match.
