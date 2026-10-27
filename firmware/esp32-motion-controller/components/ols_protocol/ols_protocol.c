#include "ols_protocol.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

uint16_t ols_crc16(const uint8_t *data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; b++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
    return crc;
}

static bool copy_bounded(char *dst, size_t cap, const char *src, size_t n) {
    if (n + 1 > cap) return false;
    memcpy(dst, src, n);
    dst[n] = '\0';
    return true;
}

void ols_frame_init(ols_frame_t *f, uint32_t seq, const char *kind) {
    memset(f, 0, sizeof(*f));
    f->seq = seq;
    copy_bounded(f->kind, sizeof(f->kind), kind, strnlen(kind, sizeof(f->kind) - 1));
}

bool ols_frame_add(ols_frame_t *f, const char *key, const char *val) {
    if (f->n >= OLS_MAX_PAIRS) return false;
    // ',' '=' '*' '\n' would break framing; the host sanitizes messages the same way.
    for (const char *p = val; *p; p++)
        if (*p == ',' || *p == '=' || *p == '*' || *p == '\n' || *p == '\r') return false;
    ols_kv_t *kv = &f->kv[f->n];
    if (!copy_bounded(kv->key, sizeof(kv->key), key, strlen(key))) return false;
    if (!copy_bounded(kv->val, sizeof(kv->val), val, strlen(val))) return false;
    f->n++;
    return true;
}

bool ols_frame_add_f(ols_frame_t *f, const char *key, double val, int decimals) {
    char tmp[OLS_MAX_VAL];
    int n = snprintf(tmp, sizeof(tmp), "%.*f", decimals, val);
    if (n <= 0 || (size_t)n >= sizeof(tmp)) return false;
    return ols_frame_add(f, key, tmp);
}

const char *ols_frame_get(const ols_frame_t *f, const char *key) {
    for (uint8_t i = 0; i < f->n; i++)
        if (strcmp(f->kv[i].key, key) == 0) return f->kv[i].val;
    return NULL;
}

bool ols_frame_get_f(const ols_frame_t *f, const char *key, double *out) {
    const char *v = ols_frame_get(f, key);
    if (!v || !*v) return false;
    char *end = NULL;
    double d = strtod(v, &end);
    if (!end || *end != '\0') return false;
    *out = d;
    return true;
}

int ols_frame_encode(const ols_frame_t *f, char *buf, size_t cap) {
    char body[OLS_MAX_LINE];
    int n = snprintf(body, sizeof(body), "%lu:%s", (unsigned long)f->seq, f->kind);
    if (n < 0 || (size_t)n >= sizeof(body)) return -1;
    for (uint8_t i = 0; i < f->n; i++) {
        int m = snprintf(body + n, sizeof(body) - (size_t)n, "%c%s=%s", i == 0 ? ':' : ',', f->kv[i].key, f->kv[i].val);
        if (m < 0 || (size_t)(n + m) >= sizeof(body)) return -1;
        n += m;
    }
    uint16_t crc = ols_crc16((const uint8_t *)body, (size_t)n);
    int total = snprintf(buf, cap, "@%s*%04X\n", body, crc);
    if (total < 0 || (size_t)total >= cap) return -1;
    return total;
}

ols_err_t ols_frame_decode(const char *line, ols_frame_t *out) {
    size_t len = strlen(line);
    while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) len--;
    if (len < 3 || line[0] != '@') return OLS_ERR_SYNTAX;
    const char *star = NULL;
    for (size_t i = len; i-- > 1;)
        if (line[i] == '*') {
            star = line + i;
            break;
        }
    if (!star || (size_t)(line + len - star - 1) != 4) return OLS_ERR_SYNTAX;
    char crc_txt[5];
    memcpy(crc_txt, star + 1, 4);
    crc_txt[4] = '\0';
    char *end = NULL;
    unsigned long expected = strtoul(crc_txt, &end, 16);
    if (!end || *end != '\0') return OLS_ERR_SYNTAX;
    const char *body = line + 1;
    size_t body_len = (size_t)(star - body);
    if (ols_crc16((const uint8_t *)body, body_len) != (uint16_t)expected) return OLS_ERR_CRC;

    char tmp[OLS_MAX_LINE];
    if (body_len >= sizeof(tmp)) return OLS_ERR_OVERFLOW;
    memcpy(tmp, body, body_len);
    tmp[body_len] = '\0';

    char *kind = strchr(tmp, ':');
    if (!kind) return OLS_ERR_SYNTAX;
    *kind++ = '\0';
    unsigned long seq = strtoul(tmp, &end, 10);
    if (!end || *end != '\0' || tmp[0] == '\0') return OLS_ERR_SYNTAX;
    char *payload = strchr(kind, ':');
    if (payload) *payload++ = '\0';
    if (*kind == '\0') return OLS_ERR_SYNTAX;
    ols_frame_init(out, (uint32_t)seq, kind);
    if (strlen(kind) >= OLS_MAX_KIND) return OLS_ERR_OVERFLOW;
    while (payload && *payload) {
        char *next = strchr(payload, ',');
        if (next) *next++ = '\0';
        if (*payload) {
            char *eq = strchr(payload, '=');
            if (!eq) return OLS_ERR_SYNTAX;
            *eq = '\0';
            if (out->n >= OLS_MAX_PAIRS) return OLS_ERR_OVERFLOW;
            ols_kv_t *kv = &out->kv[out->n++];
            if (!copy_bounded(kv->key, sizeof(kv->key), payload, strlen(payload))) return OLS_ERR_OVERFLOW;
            if (!copy_bounded(kv->val, sizeof(kv->val), eq + 1, strlen(eq + 1))) return OLS_ERR_OVERFLOW;
        }
        payload = next;
    }
    return OLS_OK;
}

void ols_framer_reset(ols_framer_t *fr) {
    fr->len = 0;
    fr->overflow = false;
}

bool ols_framer_push(ols_framer_t *fr, char c, char *out, size_t cap) {
    if (c == '\n') {
        bool complete = !fr->overflow && fr->len > 0 && fr->len < cap;
        if (complete) {
            memcpy(out, fr->buf, fr->len);
            out[fr->len] = '\0';
        }
        ols_framer_reset(fr);
        return complete;
    }
    if (fr->overflow) return false;
    if (fr->len >= sizeof(fr->buf) - 1) {
        fr->overflow = true;
        return false;
    }
    fr->buf[fr->len++] = c;
    return false;
}
