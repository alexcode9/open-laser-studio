idf_component_register(
    SRCS "ols_board.c"
    INCLUDE_DIRS "include"
    REQUIRES driver esp_driver_gptimer esp_driver_usb_serial_jtag esp_driver_gpio log
)
