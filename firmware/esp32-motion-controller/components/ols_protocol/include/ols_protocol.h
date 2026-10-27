// OLS external axis controller protocol v1 — framing (portable C, no ESP-IDF dependencies).
//
//   @<seq>:<TYPE>[:k=v,k=v...]*<CRC16>\n
//
// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the bytes between '@' and '*', printed as
// 4 uppercase hex digits. Must stay byte-compatible with crates/laser-protocol/src/axis.rs;
// both sides are tested against tests/fixtures/axis_frames.json.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define OLS_PROTO_VERSION 1
#define OLS_MAX_LINE 192
#define OLS_MAX_PAIRS 8
#define OLS_MAX_KEY 12
#define OLS_MAX_VAL 48
#define OLS_MAX_KIND 12

typedef struct {
    char key[OLS_MAX_KEY];
    char val[OLS_MAX_VAL];
} ols_kv_t;

typedef struct {
    uint32_t seq;
    char kind[OLS_MAX_KIND];
    ols_kv_t kv[OLS_MAX_PAIRS];
    uint8_t n;
} ols_frame_t;

typedef enum {
    OLS_OK = 0,
    OLS_ERR_SYNTAX,
    OLS_ERR_CRC,
    OLS_ERR_OVERFLOW,
} ols_err_t;

uint16_t ols_crc16(const uint8_t *data, size_t len);

void ols_frame_init(ols_frame_t *f, uint32_t seq, const char *kind);
bool ols_frame_add(ols_frame_t *f, const char *key, const char *val);
bool ols_frame_add_f(ols_frame_t *f, const char *key, double val, int decimals);
const char *ols_frame_get(const ols_frame_t *f, const char *key);
bool ols_frame_get_f(const ols_frame_t *f, const char *key, double *out);

/// Encode including the trailing '\n'. Returns the length, or -1 if `cap` is too small.
int ols_frame_encode(const ols_frame_t *f, char *buf, size_t cap);
/// Decode one line (trailing "\r\n" tolerated). Validates the CRC before parsing.
ols_err_t ols_frame_decode(const char *line, ols_frame_t *out);

/// Byte-at-a-time line assembler with an overflow guard (an over-long line is discarded whole).
typedef struct {
    char buf[OLS_MAX_LINE];
    size_t len;
    bool overflow;
} ols_framer_t;

void ols_framer_reset(ols_framer_t *fr);
/// Returns true when `c` completed a line; the NUL-terminated line is copied to `out`.
bool ols_framer_push(ols_framer_t *fr, char c, char *out, size_t cap);

#ifdef __cplusplus
}
#endif
