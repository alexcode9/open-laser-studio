// Host unit tests for the portable firmware components (protocol + controller logic).
// Build & run: see README.md (`gcc` or `zig cc`; no ESP-IDF needed).
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "ols_motion.h"
#include "ols_protocol.h"

static int g_failures, g_checks;
#define CHECK(cond)                                                          \
    do {                                                                     \
        g_checks++;                                                          \
        if (!(cond)) {                                                       \
            g_failures++;                                                    \
            fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
        }                                                                    \
    } while (0)

// Copied from tests/fixtures/axis_frames.json.
static const struct {
    const char *line;
    unsigned seq;
    const char *kind;
} GOLDEN[] = {
    {"@7:MOVE:A=90.0000,U=12.5000*F291", 7, "MOVE"},
    {"@1:HELLO:proto=1*99F3", 1, "HELLO"},
    {"@3:ACC*BDD7", 3, "ACC"},
    {"@3:CMP:A=1.0000,U=2.0000*95DB", 3, "CMP"},
    {"@0:FLT:code=ESTOP,msg=button*A0C0", 0, "FLT"},
    {"@5:ST:state=IDLE,A=0.0000,U=37.0000,homed=0,en=1*AF94", 5, "ST"},
};

static void test_crc(void) {
    CHECK(ols_crc16((const uint8_t *)"123456789", 9) == 0x29B1);
}

static void test_golden(void) {
    for (size_t i = 0; i < sizeof(GOLDEN) / sizeof(GOLDEN[0]); i++) {
        ols_frame_t f;
        CHECK(ols_frame_decode(GOLDEN[i].line, &f) == OLS_OK);
        CHECK(f.seq == GOLDEN[i].seq);
        CHECK(strcmp(f.kind, GOLDEN[i].kind) == 0);
        char buf[OLS_MAX_LINE + 8];
        int n = ols_frame_encode(&f, buf, sizeof(buf));
        CHECK(n > 0);
        char expect[OLS_MAX_LINE + 8];
        snprintf(expect, sizeof(expect), "%s\n", GOLDEN[i].line);
        CHECK(strcmp(buf, expect) == 0);
    }
    ols_frame_t f;
    ols_frame_init(&f, 7, "MOVE");
    ols_frame_add_f(&f, "A", 90.0, 4);
    ols_frame_add_f(&f, "U", 12.5, 4);
    char buf[OLS_MAX_LINE];
    ols_frame_encode(&f, buf, sizeof(buf));
    CHECK(strcmp(buf, "@7:MOVE:A=90.0000,U=12.5000*F291\n") == 0);
    double a = 0;
    CHECK(ols_frame_get_f(&f, "A", &a) && a == 90.0);
}

static void test_decode_errors(void) {
    ols_frame_t f;
    CHECK(ols_frame_decode("garbage", &f) == OLS_ERR_SYNTAX);
    CHECK(ols_frame_decode("@1:ACC*ZZZZ", &f) == OLS_ERR_SYNTAX);
    CHECK(ols_frame_decode("@3:CMP:A=1.0000,U=3.0000*95DB", &f) == OLS_ERR_CRC);
    CHECK(ols_frame_decode("@3:ACC*BDD7\r\n", &f) == OLS_OK);
    // value with a forbidden character is refused at build time
    ols_frame_init(&f, 1, "REJ");
    CHECK(!ols_frame_add(&f, "msg", "a,b"));
}

static void test_framer(void) {
    ols_framer_t fr;
    ols_framer_reset(&fr);
    const char *stream = "@3:ACC*BDD7\n@1:HELLO:proto=1*99F3\n";
    char out[OLS_MAX_LINE];
    int lines = 0;
    for (const char *p = stream; *p; p++)
        if (ols_framer_push(&fr, *p, out, sizeof(out))) lines++;
    CHECK(lines == 2);
    CHECK(strcmp(out, "@1:HELLO:proto=1*99F3") == 0);
    // overflow: an over-long line is dropped whole, the next one still parses
    for (int i = 0; i < OLS_MAX_LINE + 20; i++) ols_framer_push(&fr, 'x', out, sizeof(out));
    CHECK(!ols_framer_push(&fr, '\n', out, sizeof(out)));
    lines = 0;
    for (const char *p = "@3:ACC*BDD7\n"; *p; p++)
        if (ols_framer_push(&fr, *p, out, sizeof(out))) lines++;
    CHECK(lines == 1);
}

// ---- controller ----
#define MAX_OUT 64
static ols_frame_t g_out[MAX_OUT];
static int g_nout;
static void capture(void *ctx, const ols_frame_t *f) {
    (void)ctx;
    if (g_nout < MAX_OUT) g_out[g_nout++] = *f;
}
static void clear_out(void) { g_nout = 0; }
static const ols_frame_t *last(void) { return g_nout ? &g_out[g_nout - 1] : NULL; }
static bool has(const char *kind, unsigned seq) {
    for (int i = 0; i < g_nout; i++)
        if (strcmp(g_out[i].kind, kind) == 0 && g_out[i].seq == seq) return true;
    return false;
}

static void send_req(mc_t *mc, unsigned seq, const char *kind, const char *k1, const char *v1) {
    ols_frame_t f;
    ols_frame_init(&f, seq, kind);
    if (k1) ols_frame_add(&f, k1, v1);
    char buf[OLS_MAX_LINE];
    ols_frame_encode(&f, buf, sizeof(buf));
    mc_handle_line(mc, buf);
}

static void run(mc_t *mc, double seconds) {
    for (double t = 0; t < seconds; t += 0.001) mc_tick(mc, 0.001);
}

static const mc_config_t CFG = {
    .u_min_mm = 0, .u_max_mm = 300, .vmax_a_deg_s = 180, .amax_a_deg_s2 = 720,
    .vmax_u_mm_s = 20, .amax_u_mm_s2 = 100, .home_speed_mm_s = 5, .home_search_mm = 50, .link_timeout_s = 0,
};

static void test_profile(void) {
    mc_profile_t p = {0, 10, 0, 20, 100};
    // trapezoid: t_acc=0.2 d_acc=2 -> dur=0.4+6/20=0.7
    double dur = 0.4 + 6.0 / 20.0;
    p.dur = dur;
    CHECK(fabs(mc_profile_at(&p, dur / 2) - 5.0) < 1e-9);
    CHECK(mc_profile_at(&p, dur + 1) == 10.0);
    CHECK(mc_profile_at(&p, 0) == 0.0);
}

static void test_controller_flow(void) {
    mc_t mc;
    mc_init(&mc, &CFG, capture, NULL);
    clear_out();

    send_req(&mc, 1, "HELLO", "proto", "1");
    CHECK(has("HELLO", 1));

    send_req(&mc, 2, "MOVE", "A", "90");
    CHECK(strcmp(last()->kind, "REJ") == 0 && strcmp(ols_frame_get(last(), "code"), "DISABLED") == 0);

    send_req(&mc, 3, "ENABLE", NULL, NULL);
    CHECK(has("ACC", 3) && mc.state == MC_IDLE);

    send_req(&mc, 4, "MOVE", "U", "10");
    CHECK(strcmp(ols_frame_get(last(), "code"), "NOT_HOMED") == 0);

    // homing: switch closes after the axis travelled a bit
    mc.u_mm = 20;
    clear_out();
    send_req(&mc, 5, "HOME", "axis", "U");
    CHECK(has("ACC", 5) && has("STA", 5) && mc.state == MC_HOMING);
    run(&mc, 1.0);
    CHECK(mc.u_mm < 20);
    mc_set_limit_u_input(&mc, true);
    run(&mc, 0.01);
    mc_set_limit_u_input(&mc, false);
    CHECK(has("CMP", 5) && mc.homed && mc.u_mm == 0 && mc.state == MC_IDLE);

    send_req(&mc, 6, "MOVE", "U", "400");
    CHECK(strcmp(ols_frame_get(last(), "code"), "LIMIT") == 0);

    clear_out();
    send_req(&mc, 7, "MOVE", "A", "90");
    CHECK(has("ACC", 7) && has("STA", 7) && mc.state == MC_MOVING);
    send_req(&mc, 8, "MOVE", "A", "0");
    CHECK(strcmp(ols_frame_get(last(), "code"), "BUSY") == 0);
    run(&mc, 2.0);
    CHECK(has("CMP", 7) && fabs(mc.a_deg - 90.0) < 1e-9 && mc.state == MC_IDLE);
    // ACC strictly before STA strictly before CMP
    int iacc = -1, ista = -1, icmp = -1;
    for (int i = 0; i < g_nout; i++) {
        if (g_out[i].seq != 7) continue;
        if (!strcmp(g_out[i].kind, "ACC")) iacc = i;
        if (!strcmp(g_out[i].kind, "STA")) ista = i;
        if (!strcmp(g_out[i].kind, "CMP")) icmp = i;
    }
    CHECK(iacc >= 0 && iacc < ista && ista < icmp);

    send_req(&mc, 9, "BOGUS", NULL, NULL);
    CHECK(strcmp(ols_frame_get(last(), "code"), "UNKNOWN") == 0);
    mc_handle_line(&mc, "@9:STATUS*0000");
    CHECK(last()->seq == 0 && strcmp(ols_frame_get(last(), "code"), "FRAME") == 0);
}

static void test_estop_latch(void) {
    mc_t mc;
    mc_init(&mc, &CFG, capture, NULL);
    send_req(&mc, 1, "ENABLE", NULL, NULL);
    clear_out();
    send_req(&mc, 2, "MOVE", "A", "360");
    run(&mc, 0.2);
    mc_set_estop_input(&mc, true);
    CHECK(mc.state == MC_ESTOP && !mc.enabled && !mc.homed && !mc.motion);
    CHECK(has("REJ", 2));  // active move aborted
    CHECK(has("FLT", 0));
    double a_frozen = mc.a_deg;
    run(&mc, 1.0);
    CHECK(mc.a_deg == a_frozen);  // never resumes

    send_req(&mc, 3, "RESET", NULL, NULL);
    CHECK(strcmp(ols_frame_get(last(), "code"), "STATE") == 0);  // input still active
    send_req(&mc, 4, "ENABLE", NULL, NULL);
    CHECK(strcmp(ols_frame_get(last(), "code"), "STATE") == 0);
    mc_set_estop_input(&mc, false);
    CHECK(mc.state == MC_ESTOP);  // releasing the button does not clear the latch
    send_req(&mc, 5, "RESET", NULL, NULL);
    CHECK(has("ACC", 5) && mc.state == MC_DISABLED && !mc.enabled);
}

static void test_faults(void) {
    mc_t mc;
    mc_init(&mc, &CFG, capture, NULL);
    send_req(&mc, 1, "ENABLE", NULL, NULL);
    clear_out();
    send_req(&mc, 2, "HOME", "axis", "U");
    run(&mc, 11.0);  // 50 mm at 5 mm/s without a switch
    CHECK(mc.state == MC_FAULT && !mc.homed);
    CHECK(strcmp(ols_frame_get(last(), "code"), "HOME_TIMEOUT") == 0);

    clear_out();
    mc_hardware_fault(&mc, "DRIVER", "alarm");
    mc_hardware_fault(&mc, "DRIVER", "alarm");
    CHECK(g_nout == 0);  // already latched: no repeated FLT
    send_req(&mc, 3, "RESET", NULL, NULL);
    CHECK(mc.state == MC_DISABLED);

    mc_t link;
    mc_config_t c = CFG;
    c.link_timeout_s = 0.5;
    mc_init(&link, &c, capture, NULL);
    send_req(&link, 1, "ENABLE", NULL, NULL);
    send_req(&link, 2, "MOVE", "A", "3600");
    run(&link, 1.0);
    CHECK(link.state == MC_FAULT && strcmp(ols_frame_get(last(), "code"), "LINK") == 0);
}

int main(void) {
    test_crc();
    test_golden();
    test_decode_errors();
    test_framer();
    test_profile();
    test_controller_flow();
    test_estop_latch();
    test_faults();
    printf("%d checks, %d failures\n", g_checks, g_failures);
    return g_failures ? 1 : 0;
}
