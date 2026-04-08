#!/usr/bin/env bash
# После reboot (если есть флаг) — проверяет VPN+monitoring сервисы и шлёт Telegram.
set -euo pipefail

MONITOR_ROOT="${MONITOR_ROOT:-/opt/hysteria-monitor}"
ENV_FILE="${ENV_FILE:-$MONITOR_ROOT/config/hysteria-monitor.env}"
STATE_DIR="${STATE_DIR:-$MONITOR_ROOT/state}"
FLAG_FILE="${FLAG_FILE:-$STATE_DIR/pending_reboot_check}"

if [[ ! -f "$FLAG_FILE" ]]; then
  exit 0
fi

if [[ ! -r "$ENV_FILE" ]]; then
  echo "post-reboot-check: нет $ENV_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "post-reboot-check: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID" >&2
  exit 1
fi

send_tg() {
  local text="$1"
  curl -sS -m 25 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg chat_id "$TELEGRAM_CHAT_ID" --arg text "$text" \
      '{chat_id: $chat_id, text: $text, disable_web_page_preview: true}')" >/dev/null
}

SERVICES=(
  hysteria-auth.service
  hysteria-caddy.service
  hysteria-scheduler.service
  hysteria-server.service
  hysteria-webpanel.service
  telegram-poller.service
  hysteria-monitor.timer
  load-alert.timer
)

bad=()
for svc in "${SERVICES[@]}"; do
  st="$(systemctl is-active "$svc" 2>/dev/null || true)"
  if [[ "$st" != "active" ]]; then
    bad+=("$svc=$st")
  fi
done

host="$(hostname -f 2>/dev/null || hostname)"
ts="$(date -Is)"

if ((${#bad[@]})); then
  send_tg "🟥 Перезапуск сервера завершён, но часть сервисов НЕ поднялась (${host})
$(printf '%s\n' "${bad[@]}")
Время: ${ts}"
else
  send_tg "✅ Сервер перезапущен, сервисы VPN+Monitoring поднялись (${host})
Время: ${ts}"
fi

rm -f "$FLAG_FILE" || true

