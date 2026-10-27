// ESP32-S3 board layer: pins, step generation, inputs, host serial link.
//
// UNVALIDATED: pin numbers and polarities are placeholders for a generic ESP32-S3 DevKitC-1 +
// two STEP/DIR drivers (e.g. TMC2209 in standalone mode). Check docs/WIRING.md and your actual
// board before powering anything. Nothing here drives a laser.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "driver/gpio.h"

#ifdef __cplusplus
extern "C" {
#endif

// ---- pins (placeholders) ----
#define OLS_PIN_A_STEP GPIO_NUM_4
#define OLS_PIN_A_DIR GPIO_NUM_5
#define OLS_PIN_U_STEP GPIO_NUM_6
#define OLS_PIN_U_DIR GPIO_NUM_7
#define OLS_PIN_DRV_EN_N GPIO_NUM_15   // active low, shared by both drivers
#define OLS_PIN_ESTOP_NC GPIO_NUM_16   // NC contact to GND; open (high) = E-stop active
#define OLS_PIN_LIMIT_U_NC GPIO_NUM_17 // NC switch to GND; open (high) = triggered
#define OLS_PIN_DRV_FAULT_N GPIO_NUM_18 // optional driver DIAG/ALARM, active low

// ---- mechanics (placeholders; host sends calibrated values in a later protocol revision) ----
#define OLS_STEPS_PER_DEG (200.0 * 16.0 * 3.0 / 360.0) // 1.8° motor, 1/16 µstep, 3:1 belt
#define OLS_STEPS_PER_MM (200.0 * 16.0 / 8.0)          // T8 lead screw, 8 mm/rev
#define OLS_STEP_TIMER_HZ 40000

typedef struct {
    bool estop;
    bool limit_u;
    bool driver_fault;
} ols_inputs_t;

void ols_board_init(void);
/// Enable/disable motor drivers. Always disabled at boot and on E-stop.
void ols_board_drivers_enable(bool on);
/// Set step-generator targets in steps (ISR follows at <= one step per axis per timer tick).
void ols_board_set_targets(int32_t a_steps, int32_t u_steps);
void ols_board_get_positions(int32_t *a_steps, int32_t *u_steps);
/// Debounced input snapshot.
ols_inputs_t ols_board_read_inputs(void);

/// Host link (USB-Serial-JTAG CDC). Non-blocking read; returns bytes copied.
int ols_board_link_read(char *buf, int cap);
void ols_board_link_write(const char *data, int len);

#ifdef __cplusplus
}
#endif
