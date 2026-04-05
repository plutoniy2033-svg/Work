#!/usr/bin/env bash
# Проверка systemd-сервисов Hysteria; при падении — автозапуск; Telegram при проблемах.
# Дерево: /opt/hysteria-monitor/{bin,config,state}
# config/hysteria-monitor.env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
# Опционально: AUTO_START_FAILED=1 (по умолчанию), AUTO_START_DELAY_SEC=2

set -euo pipefail

MONITOR_ROOT="${MONITOR_ROOT:-/opt/hysteria-monitor}"
ENV_FILE="${ENV_FILE:-$MONITOR_ROOT/config/hysteria-monitor.env}"
STATE_DIR="${STATE_DIR:-$MONITOR_ROOT/state}"
STATE_FILE="${STATE_FILE:-$STATE_DIR/last_problems}"

SERVICES=(
  hysteria-auth.service
  hysteria-caddy.service
  hysteria-scheduler.service
  hysteria-server.service
  hysteria-webpanel.service
)

if [[ ! -r "$ENV_FILE" ]]; then
  echo "hysteria-monitor: нет или нет чтения $ENV_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "hysteria-monitor: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в $ENV_FILE" >&2
  exit 1
fi

AUTO_START_FAILED="${AUTO_START_FAILED:-1}"
AUTO_START_DELAY_SEC="${AUTO_START_DELAY_SEC:-2}"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

send_tg() {
  local text="$1"
  curl -sS -m 25 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg chat_id "$TELEGRAM_CHAT_ID" --arg text "$text" \
      '{chat_id: $chat_id, text: $text, disable_web_page_preview: true}')" >/dev/null
}

collect_problems() {
  problems=()
  local svc active enabled ok msg_bits
  for svc in "${SERVICES[@]}"; do
    active="$(systemctl is-active "$svc" 2>/dev/null || true)"
    enabled="$(systemctl is-enabled "$svc" 2>/dev/null || true)"
    [[ -z "$active" ]] && active="unknown"
    [[ -z "$enabled" ]] && enabled="unknown"
    ok=true
    msg_bits=()

    if [[ "$active" != "active" ]]; then
      ok=false
      msg_bits+=("active=$active (нужно active)")
    fi
    if [[ "$enabled" == disabled || "$enabled" == masked ]]; then
      ok=false
      msg_bits+=("enabled=$enabled (нужно enabled)")
    fi

    if [[ "$ok" != true ]]; then
      problems+=("$svc: ${msg_bits[*]}")
    fi
  done
}

try_auto_start_inactive() {
  HYS_STARTED_ANY=false
  local svc active enabled
  for svc in "${SERVICES[@]}"; do
    active="$(systemctl is-active "$svc" 2>/dev/null || true)"
    enabled="$(systemctl is-enabled "$svc" 2>/dev/null || true)"
    [[ -z "$active" ]] && active="unknown"
    [[ -z "$enabled" ]] && enabled="unknown"

    [[ "$active" == "active" ]] && continue
    [[ "$enabled" == disabled || "$enabled" == masked ]] && continue

    systemctl reset-failed "$svc" 2>/dev/null || true
    systemctl start "$svc" 2>/dev/null || true
    HYS_STARTED_ANY=true
  done
  if [[ "$HYS_STARTED_ANY" == true ]]; then
    sleep "$AUTO_START_DELAY_SEC"
  fi
}

collect_problems
had_initial_problems=false
((${#problems[@]})) && had_initial_problems=true

HYS_STARTED_ANY=false
auto_note=""
if [[ "$AUTO_START_FAILED" == "1" || "$AUTO_START_FAILED" == "true" || "$AUTO_START_FAILED" == "yes" ]]; then
  if ((${#problems[@]})); then
    try_auto_start_inactive
    collect_problems
    if [[ "$HYS_STARTED_ANY" == true ]]; then
      auto_note="
Был выполнен автозапуск (reset-failed + start); ниже состояние после паузы ${AUTO_START_DELAY_SEC}s."
    fi
  fi
fi

if ((${#problems[@]})); then
  current_sig="$(printf '%s\n' "${problems[@]}" | sha256sum | awk '{print $1}')"
else
  current_sig="ALL_OK"
fi
prev_sig=""
[[ -f "$STATE_FILE" ]] && prev_sig="$(cat "$STATE_FILE" 2>/dev/null | head -1 || true)"

if ((${#problems[@]})); then
  body="⚠️ Hysteria: проблемы со сервисами ($(hostname -f 2>/dev/null || hostname))
$(printf '%s\n' "${problems[@]}")${auto_note}
Время: $(date -Is)"
  if [[ "$current_sig" != "$prev_sig" ]]; then
    send_tg "$body"
    printf '%s\n' "$current_sig" >"$STATE_FILE"
  fi
  exit 1
else
  if [[ -n "$prev_sig" ]]; then
    send_tg "✅ Hysteria: все сервисы в норме ($(hostname -f 2>/dev/null || hostname))
Время: $(date -Is)"
    rm -f "$STATE_FILE"
  elif [[ "$had_initial_problems" == true && "$HYS_STARTED_ANY" == true ]]; then
    send_tg "ℹ️ Hysteria: зафиксирован простой, автозапуск отработал; сейчас все active ($(hostname -f 2>/dev/null || hostname))
Время: $(date -Is)"
  fi
  exit 0
fi
