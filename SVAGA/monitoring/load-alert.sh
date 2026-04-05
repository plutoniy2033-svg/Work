#!/usr/bin/env bash
# Алерты в Telegram при высокой нагрузке / RAM / диск.
set -euo pipefail

MONITOR_ROOT="${MONITOR_ROOT:-/opt/hysteria-monitor}"
ENV_FILE="${ENV_FILE:-$MONITOR_ROOT/config/hysteria-monitor.env}"
STATE_DIR="${STATE_DIR:-$MONITOR_ROOT/state}"
STATE_FILE="${STATE_FILE:-$STATE_DIR/load_alert_sig}"
METRICS_LIB="${METRICS_LIB:-$MONITOR_ROOT/bin/server-metrics.sh}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "load-alert: нет $ENV_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "load-alert: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID" >&2
  exit 1
fi
if [[ ! -r "$METRICS_LIB" ]]; then
  echo "load-alert: нет $METRICS_LIB" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$METRICS_LIB"

LOAD_ALERT_ENABLED="${LOAD_ALERT_ENABLED:-1}"
[[ "$LOAD_ALERT_ENABLED" == "0" || "$LOAD_ALERT_ENABLED" == "false" ]] && exit 0

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

send_tg() {
  local text="$1"
  curl -sS -m 25 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg chat_id "$TELEGRAM_CHAT_ID" --arg text "$text" \
      '{chat_id: $chat_id, text: $text, disable_web_page_preview: true}')" >/dev/null
}

trim4096() {
  local s="$1"
  ((${#s} > 3900)) && s="${s:0:3900}"$'\n…(обрезано)'
  printf '%s' "$s"
}

if collect_load_state; then
  body="🔥 Высокая нагрузка / ресурсы ($(hostname -f 2>/dev/null || hostname))
$(printf '%s\n' "${REASONS[@]}")

--- снимок ---
$(trim4096 "$(build_status_report)")"
  sig="$(printf '%s\n' "${REASONS[@]}" | sha256sum | awk '{print $1}')"
else
  sig="OK"
fi

prev=""
[[ -f "$STATE_FILE" ]] && prev="$(head -1 "$STATE_FILE" 2>/dev/null || true)"

if [[ "$sig" != "OK" ]]; then
  if [[ "$sig" != "$prev" ]]; then
    send_tg "$body"
    printf '%s\n' "$sig" >"$STATE_FILE"
  fi
  exit 1
else
  if [[ -n "$prev" && "$prev" != "OK" ]]; then
    send_tg "✅ Нагрузка и ресурсы в норме ($(hostname -f 2>/dev/null || hostname))
Время: $(date -Is)"
    rm -f "$STATE_FILE"
  fi
  exit 0
fi
