// UNVALIDATED skeleton — written against ESP-IDF v5.x APIs but never compiled in this repo's
// CI (ESP-IDF is not installed). See README.md.
#include "ols_board.h"

#include <stdatomic.h>

#include "driver/gptimer.h"
#include "driver/usb_serial_jtag.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_rom_sys.h"

static const char *TAG = "ols_board";

typedef struct {
    gpio_num_t step, dir;
    atomic_int_fast32_t target;
    volatile int32_t pos;
} axis_t;

static axis_t s_axes[2] = {
    {.step = OLS_PIN_A_STEP, .dir = OLS_PIN_A_DIR},
    {.step = OLS_PIN_U_STEP, .dir = OLS_PIN_U_DIR},
};
static gptimer_handle_t s_timer;
static volatile bool s_enabled;

// One step per axis per tick at most; the motion layer's velocity limits keep the requested
// rate below OLS_STEP_TIMER_HZ. TODO: replace with RMT/MCPWM pulse trains for smoother motion.
static bool IRAM_ATTR on_tick(gptimer_handle_t timer, const gptimer_alarm_event_data_t *ev, void *ctx) {
    (void)timer;
    (void)ev;
    (void)ctx;
    if (!s_enabled) return false;
    for (int i = 0; i < 2; i++) {
        axis_t *ax = &s_axes[i];
        int32_t target = (int32_t)atomic_load(&ax->target);
        if (target == ax->pos) continue;
        int dir = target > ax->pos ? 1 : -1;
        gpio_set_level(ax->dir, dir > 0);
        gpio_set_level(ax->step, 1);
        esp_rom_delay_us(2);  // driver minimum pulse width (TMC2209: 100 ns)
        gpio_set_level(ax->step, 0);
        ax->pos += dir;
    }
    return false;
}

void ols_board_init(void) {
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << OLS_PIN_A_STEP) | (1ULL << OLS_PIN_A_DIR) | (1ULL << OLS_PIN_U_STEP) |
                        (1ULL << OLS_PIN_U_DIR) | (1ULL << OLS_PIN_DRV_EN_N),
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&out));
    gpio_set_level(OLS_PIN_DRV_EN_N, 1);  // drivers off at boot
    s_enabled = false;

    gpio_config_t in = {
        .pin_bit_mask = (1ULL << OLS_PIN_ESTOP_NC) | (1ULL << OLS_PIN_LIMIT_U_NC) | (1ULL << OLS_PIN_DRV_FAULT_N),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,  // broken wire reads as "active" (fail-safe)
    };
    ESP_ERROR_CHECK(gpio_config(&in));

    gptimer_config_t tc = {
        .clk_src = GPTIMER_CLK_SRC_DEFAULT,
        .direction = GPTIMER_COUNT_UP,
        .resolution_hz = 1000000,
    };
    ESP_ERROR_CHECK(gptimer_new_timer(&tc, &s_timer));
    gptimer_event_callbacks_t cbs = {.on_alarm = on_tick};
    ESP_ERROR_CHECK(gptimer_register_event_callbacks(s_timer, &cbs, NULL));
    gptimer_alarm_config_t alarm = {
        .alarm_count = 1000000 / OLS_STEP_TIMER_HZ,
        .reload_count = 0,
        .flags.auto_reload_on_alarm = true,
    };
    ESP_ERROR_CHECK(gptimer_set_alarm_action(s_timer, &alarm));
    ESP_ERROR_CHECK(gptimer_enable(s_timer));
    ESP_ERROR_CHECK(gptimer_start(s_timer));

    usb_serial_jtag_driver_config_t uc = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&uc));
    ESP_LOGI(TAG, "board init done (drivers disabled)");
}

void ols_board_drivers_enable(bool on) {
    if (!on) s_enabled = false;
    gpio_set_level(OLS_PIN_DRV_EN_N, on ? 0 : 1);
    if (on) s_enabled = true;
}

void ols_board_set_targets(int32_t a_steps, int32_t u_steps) {
    atomic_store(&s_axes[0].target, a_steps);
    atomic_store(&s_axes[1].target, u_steps);
}

void ols_board_get_positions(int32_t *a_steps, int32_t *u_steps) {
    *a_steps = s_axes[0].pos;
    *u_steps = s_axes[1].pos;
}

ols_inputs_t ols_board_read_inputs(void) {
    // Simple 3-sample majority; the control loop calls this every 1 ms.
    int e = 0, l = 0, f = 0;
    for (int i = 0; i < 3; i++) {
        e += gpio_get_level(OLS_PIN_ESTOP_NC);
        l += gpio_get_level(OLS_PIN_LIMIT_U_NC);
        f += !gpio_get_level(OLS_PIN_DRV_FAULT_N);
    }
    return (ols_inputs_t){.estop = e >= 2, .limit_u = l >= 2, .driver_fault = f >= 2};
}

int ols_board_link_read(char *buf, int cap) {
    return usb_serial_jtag_read_bytes(buf, cap, 0);
}

void ols_board_link_write(const char *data, int len) {
    usb_serial_jtag_write_bytes(data, len, pdMS_TO_TICKS(20));
}
