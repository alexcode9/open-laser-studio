#include "ols_motion.h"

#include <math.h>
#include <string.h>

const char *mc_state_str(mc_state_t s) {
    switch (s) {
        case MC_DISABLED: return "DISABLED";
        case MC_IDLE: return "IDLE";
        case MC_MOVING: return "MOVING";
        case MC_HOMING: return "HOMING";
        case MC_FAULT: return "FAULT";
        case MC_ESTOP: return "ESTOP";
    }
    return "FAULT";
}

static void send_simple(mc_t *mc, uint32_t seq, const char *kind) {
    ols_frame_t f;
    ols_frame_init(&f, seq, kind);
    mc->send(mc->ctx, &f);
}

static void reject(mc_t *mc, uint32_t seq, const char *code, const char *msg) {
    ols_frame_t f;
    ols_frame_init(&f, seq, "REJ");
    ols_frame_add(&f, "code", code);
    ols_frame_add(&f, "msg", msg);
    mc->send(mc->ctx, &f);
}

static void fault(mc_t *mc, const char *code, const char *msg, bool estop) {
    if (mc->motion) reject(mc, mc->seq, "ABORTED", "fault during motion");
    mc->motion = false;
    mc->homing = false;
    mc->state = estop ? MC_ESTOP : MC_FAULT;
    ols_frame_t f;
    ols_frame_init(&f, 0, "FLT");
    ols_frame_add(&f, "code", code);
    ols_frame_add(&f, "msg", msg);
    mc->send(mc->ctx, &f);
}

static void send_status(mc_t *mc, uint32_t seq) {
    ols_frame_t f;
    ols_frame_init(&f, seq, "ST");
    ols_frame_add(&f, "state", mc_state_str(mc->state));
    ols_frame_add_f(&f, "A", mc->a_deg, 4);
    ols_frame_add_f(&f, "U", mc->u_mm, 4);
    ols_frame_add(&f, "homed", mc->homed ? "1" : "0");
    ols_frame_add(&f, "en", mc->enabled ? "1" : "0");
    mc->send(mc->ctx, &f);
}

static mc_profile_t make_profile(double from, double to, double vmax, double amax) {
    mc_profile_t p = {from, to, 0.0, vmax, amax};
    double d = fabs(to - from);
    if (d < 1e-12 || vmax <= 0 || amax <= 0) return p;
    double t_acc = vmax / amax;
    double d_acc = 0.5 * amax * t_acc * t_acc;
    if (2 * d_acc >= d) {
        p.dur = 2.0 * sqrt(d / amax);  // triangular
    } else {
        p.dur = 2 * t_acc + (d - 2 * d_acc) / vmax;
    }
    return p;
}

double mc_profile_at(const mc_profile_t *p, double t) {
    double d = p->to - p->from;
    double dist = fabs(d);
    if (p->dur <= 0 || t >= p->dur) return p->to;
    if (t <= 0) return p->from;
    double a = p->amax;
    double t_acc = p->vmax / a;
    double s;
    if (2 * 0.5 * a * t_acc * t_acc >= dist) {
        double th = p->dur / 2;
        s = t < th ? 0.5 * a * t * t : dist - 0.5 * a * (p->dur - t) * (p->dur - t);
    } else if (t < t_acc) {
        s = 0.5 * a * t * t;
    } else if (t < p->dur - t_acc) {
        s = 0.5 * a * t_acc * t_acc + p->vmax * (t - t_acc);
    } else {
        double r = p->dur - t;
        s = dist - 0.5 * a * r * r;
    }
    return p->from + (d >= 0 ? s : -s);
}

void mc_init(mc_t *mc, const mc_config_t *cfg, mc_send_fn send, void *ctx) {
    memset(mc, 0, sizeof(*mc));
    mc->cfg = *cfg;
    mc->send = send;
    mc->ctx = ctx;
    mc->state = MC_DISABLED;
    mc->u_mm = cfg->u_min_mm;  // unknown until homed; reported but marked homed=0
}

static void start_motion(mc_t *mc, uint32_t seq, double a, double u, bool homing) {
    mc->motion = true;
    mc->homing = homing;
    mc->seq = seq;
    mc->t0 = mc->now_s;
    mc->pa = make_profile(mc->a_deg, a, mc->cfg.vmax_a_deg_s, mc->cfg.amax_a_deg_s2);
    if (homing) {
        // Search towards the switch at constant (slow) speed; ends when the limit input fires.
        mc->pu = (mc_profile_t){mc->u_mm, mc->u_mm - mc->cfg.home_search_mm, mc->cfg.home_search_mm / mc->cfg.home_speed_mm_s, mc->cfg.home_speed_mm_s, 1e9};
        mc->state = MC_HOMING;
    } else {
        mc->pu = make_profile(mc->u_mm, u, mc->cfg.vmax_u_mm_s, mc->cfg.amax_u_mm_s2);
        mc->state = MC_MOVING;
    }
    send_simple(mc, seq, "ACC");
    send_simple(mc, seq, "STA");
}

void mc_handle_line(mc_t *mc, const char *line) {
    ols_frame_t f;
    if (ols_frame_decode(line, &f) != OLS_OK) {
        reject(mc, 0, "FRAME", "frame rejected");
        return;
    }
    mc->last_rx_s = mc->now_s;
    uint32_t seq = f.seq;
    bool latched = mc->state == MC_FAULT || mc->state == MC_ESTOP;
    const char *k = f.kind;

    if (strcmp(k, "HELLO") == 0) {
        ols_frame_t r;
        ols_frame_init(&r, seq, "HELLO");
        ols_frame_add(&r, "proto", "1");
        ols_frame_add(&r, "fw", OLS_FIRMWARE_VERSION);
        mc->send(mc->ctx, &r);
    } else if (strcmp(k, "CAPS") == 0) {
        ols_frame_t r;
        ols_frame_init(&r, seq, "CAP");
        ols_frame_add(&r, "axes", "A U");
        ols_frame_add(&r, "enc", "0");
        ols_frame_add(&r, "estop", "1");
        mc->send(mc->ctx, &r);
    } else if (strcmp(k, "STATUS") == 0) {
        send_status(mc, seq);
    } else if (strcmp(k, "ENABLE") == 0) {
        if (latched) return reject(mc, seq, "STATE", "reset required");
        mc->enabled = true;
        if (mc->state == MC_DISABLED) mc->state = MC_IDLE;
        send_simple(mc, seq, "ACC");
    } else if (strcmp(k, "DISABLE") == 0) {
        if (mc->motion) return reject(mc, seq, "BUSY", "axis moving");
        mc->enabled = false;
        if (!latched) mc->state = MC_DISABLED;
        send_simple(mc, seq, "ACC");
    } else if (strcmp(k, "HOME") == 0 || strcmp(k, "MOVE") == 0) {
        bool home = k[0] == 'H';
        if (home) {
            const char *axis = ols_frame_get(&f, "axis");
            if (!axis || strcmp(axis, "U") != 0) return reject(mc, seq, "UNKNOWN", "only HOME axis=U is supported");
        }
        if (latched) return reject(mc, seq, "STATE", "fault latched");
        if (!mc->enabled) return reject(mc, seq, "DISABLED", "drivers disabled");
        if (mc->motion) return reject(mc, seq, "BUSY", "axis moving");
        if (home) return start_motion(mc, seq, mc->a_deg, mc->cfg.u_min_mm, true);
        double a = mc->a_deg, u = mc->u_mm;
        bool has_a = ols_frame_get_f(&f, "A", &a);
        bool has_u = ols_frame_get_f(&f, "U", &u);
        if ((ols_frame_get(&f, "A") && !has_a) || (ols_frame_get(&f, "U") && !has_u) || !isfinite(a) || !isfinite(u))
            return reject(mc, seq, "ARG", "non-finite target");
        if (has_u && fabs(u - mc->u_mm) > 1e-9 && !mc->homed) return reject(mc, seq, "NOT_HOMED", "U must be homed first");
        if (u < mc->cfg.u_min_mm - 1e-9 || u > mc->cfg.u_max_mm + 1e-9) return reject(mc, seq, "LIMIT", "U target outside soft limits");
        start_motion(mc, seq, a, u, false);
    } else if (strcmp(k, "STOP") == 0) {
        if (mc->motion) {
            // Decelerating stop is a TODO for real steppers; commanded position freezes here.
            mc->motion = false;
            mc->homing = false;
            mc->state = MC_IDLE;
            reject(mc, mc->seq, "ABORTED", "stopped by host");
        }
        send_simple(mc, seq, "ACC");
    } else if (strcmp(k, "ESTOP") == 0) {
        send_simple(mc, seq, "ACC");
        fault(mc, "ESTOP", "host emergency stop", true);
        mc->homed = false;
    } else if (strcmp(k, "RESET") == 0) {
        if (latched && mc->estop_input) return reject(mc, seq, "STATE", "E-stop input still active");
        if (latched) {
            mc->state = MC_DISABLED;
            mc->enabled = false;
        }
        send_simple(mc, seq, "ACC");
    } else {
        reject(mc, seq, "UNKNOWN", "unknown request");
    }
}

void mc_tick(mc_t *mc, double dt) {
    mc->now_s += dt;
    if (!mc->motion) return;
    if (mc->cfg.link_timeout_s > 0 && mc->now_s - mc->last_rx_s > mc->cfg.link_timeout_s) {
        fault(mc, "LINK", "host link timeout during motion", false);
        return;
    }
    double t = mc->now_s - mc->t0;
    mc->a_deg = mc_profile_at(&mc->pa, t);
    mc->u_mm = mc_profile_at(&mc->pu, t);
    if (mc->homing) {
        if (mc->limit_u_input) {
            mc->u_mm = mc->cfg.u_min_mm;  // switch position defines U zero
            mc->homed = true;
            mc->homing = false;
        } else if (t >= mc->pu.dur) {
            mc->homed = false;
            fault(mc, "HOME_TIMEOUT", "limit switch not found", false);
            return;
        } else {
            return;
        }
    } else {
        double dur = mc->pa.dur > mc->pu.dur ? mc->pa.dur : mc->pu.dur;
        if (t < dur) return;
    }
    mc->motion = false;
    mc->state = MC_IDLE;
    ols_frame_t f;
    ols_frame_init(&f, mc->seq, "CMP");
    ols_frame_add_f(&f, "A", mc->a_deg, 4);
    ols_frame_add_f(&f, "U", mc->u_mm, 4);
    mc->send(mc->ctx, &f);
}

void mc_set_estop_input(mc_t *mc, bool active) {
    bool rising = active && !mc->estop_input;
    mc->estop_input = active;
    if (rising) {
        fault(mc, "ESTOP", "hardware E-stop input", true);
        mc->homed = false;
        mc->enabled = false;
    }
}

void mc_set_limit_u_input(mc_t *mc, bool active) {
    bool rising = active && !mc->limit_u_input;
    mc->limit_u_input = active;
    // During homing the switch is the target; any other time it is a fault.
    if (rising && !mc->homing && mc->state != MC_ESTOP) {
        mc->homed = false;
        fault(mc, "LIMIT", "limit switch triggered", false);
    }
}

void mc_hardware_fault(mc_t *mc, const char *code, const char *message) {
    if (mc->state == MC_ESTOP || mc->state == MC_FAULT) return;
    fault(mc, code, message, false);
}
