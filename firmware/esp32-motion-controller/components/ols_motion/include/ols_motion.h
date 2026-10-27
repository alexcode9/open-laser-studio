// Axis controller logic for rotary A + linear U (portable C, no ESP-IDF dependencies).
//
// Mirrors the host simulator's VirtualAxisController
// (crates/laser-simulator/src/axis_ctrl.rs): same states, rejection codes and message order
// (ACC -> STA -> CMP, or REJ / FLT). Hardware I/O lives in components/ols_board; this module
// only computes commanded positions and reacts to inputs, so it can be unit-tested on a PC.
//
// Safety model: the hardware E-stop loop must cut motor/laser power independently of this
// firmware. The firmware only observes the E-stop input, latches ESTOP, and refuses motion
// until an explicit RESET with the input released. It never resumes on its own.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "ols_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

#define OLS_FIRMWARE_VERSION "0.1.0-skeleton"

typedef enum { MC_DISABLED, MC_IDLE, MC_MOVING, MC_HOMING, MC_FAULT, MC_ESTOP } mc_state_t;

typedef struct {
    double u_min_mm, u_max_mm;           // soft limits (U is homed to u_min_mm)
    double vmax_a_deg_s, amax_a_deg_s2;  // placeholders until measured
    double vmax_u_mm_s, amax_u_mm_s2;
    double home_speed_mm_s;
    double home_search_mm;      // fault if the switch is not found within this distance
    double link_timeout_s;      // 0 disables the host-silence watchdog
} mc_config_t;

/// Sink for outgoing frames (the board layer encodes and writes them to the serial port).
typedef void (*mc_send_fn)(void *ctx, const ols_frame_t *frame);

typedef struct {
    double from, to, dur, vmax, amax;
} mc_profile_t;

typedef struct {
    mc_config_t cfg;
    mc_send_fn send;
    void *ctx;
    mc_state_t state;
    bool enabled, homed;
    bool estop_input, limit_u_input;
    double a_deg, u_mm;   // commanded position (what the step generator follows)
    double now_s, last_rx_s;
    // active motion
    bool motion;
    bool homing;
    uint32_t seq;
    double t0;
    mc_profile_t pa, pu;
} mc_t;

void mc_init(mc_t *mc, const mc_config_t *cfg, mc_send_fn send, void *ctx);
/// Handle one received line (CRC-checked). Malformed frames are answered with REJ FRAME (seq 0).
void mc_handle_line(mc_t *mc, const char *line);
/// Advance time by `dt` seconds: updates `a_deg`/`u_mm`, emits CMP/FLT as needed.
void mc_tick(mc_t *mc, double dt);
void mc_set_estop_input(mc_t *mc, bool active);
void mc_set_limit_u_input(mc_t *mc, bool active);
/// Driver alarm or other hardware fault reported by the board layer.
void mc_hardware_fault(mc_t *mc, const char *code, const char *message);
const char *mc_state_str(mc_state_t s);
/// Position along a trapezoidal profile at time `t` (exposed for tests).
double mc_profile_at(const mc_profile_t *p, double t);

#ifdef __cplusplus
}
#endif
