// OLS axis controller firmware — skeleton (UNVALIDATED, never run on hardware).
//
// One control task at 1 kHz:
//   read inputs -> feed protocol lines to the controller -> advance motion -> update step targets.
// The controller (components/ols_motion) is the same logic covered by test/host.
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "ols_board.h"
#include "ols_motion.h"
#include "ols_protocol.h"

static const char *TAG = "ols_main";

static void link_send(void *ctx, const ols_frame_t *frame) {
    (void)ctx;
    char line[OLS_MAX_LINE + 8];
    int n = ols_frame_encode(frame, line, sizeof(line));
    if (n > 0) ols_board_link_write(line, n);
}

static void control_task(void *arg) {
    (void)arg;
    static mc_t mc;
    const mc_config_t cfg = {
        .u_min_mm = 0.0,
        .u_max_mm = 300.0,
        .vmax_a_deg_s = 180.0,
        .amax_a_deg_s2 = 720.0,
        .vmax_u_mm_s = 20.0,
        .amax_u_mm_s2 = 100.0,
        .home_speed_mm_s = 5.0,
        .home_search_mm = 320.0,
        .link_timeout_s = 0.0,
    };
    mc_init(&mc, &cfg, link_send, NULL);

    ols_framer_t framer;
    ols_framer_reset(&framer);
    char rx[64];
    char line[OLS_MAX_LINE];
    bool drivers_on = false;
    TickType_t last = xTaskGetTickCount();

    for (;;) {
        ols_inputs_t in = ols_board_read_inputs();
        mc_set_estop_input(&mc, in.estop);
        mc_set_limit_u_input(&mc, in.limit_u);
        if (in.driver_fault) mc_hardware_fault(&mc, "DRIVER", "driver alarm input");

        int n = ols_board_link_read(rx, sizeof(rx));
        for (int i = 0; i < n; i++)
            if (ols_framer_push(&framer, rx[i], line, sizeof(line))) mc_handle_line(&mc, line);

        mc_tick(&mc, 0.001);

        bool want_on = mc.enabled && mc.state != MC_FAULT && mc.state != MC_ESTOP;
        if (want_on != drivers_on) {
            ols_board_drivers_enable(want_on);
            drivers_on = want_on;
        }
        if (drivers_on)
            ols_board_set_targets((int32_t)(mc.a_deg * OLS_STEPS_PER_DEG), (int32_t)(mc.u_mm * OLS_STEPS_PER_MM));

        vTaskDelayUntil(&last, pdMS_TO_TICKS(1));
    }
}

void app_main(void) {
    ESP_LOGI(TAG, "Open Laser Studio axis controller %s (protocol v%d)", OLS_FIRMWARE_VERSION, OLS_PROTO_VERSION);
    ols_board_init();
    xTaskCreatePinnedToCore(control_task, "ols_ctrl", 6144, NULL, 10, NULL, 1);
}
