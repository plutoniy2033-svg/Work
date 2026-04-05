#!/usr/bin/env bash
# Long polling: ответ на /status в чате/канале (тот же бот).
# Без set -e в цикле: иначе любой сбой jq/curl рвёт процесс и /status «молчит».
set -uo pipefail

MONITOR_ROOT="${MONITOR_ROOT:-/opt/hysteria-monitor}"
ENV_FILE="${ENV_FILE:-$MONITOR_ROOT/config/hysteria-monitor.env}"
STATE_DIR="${STATE_DIR:-$MONITOR_ROOT/state}"
OFFSET_FILE="${OFFSET_FILE:-$STATE_DIR/telegram_updates_offset}"
METRICS_LIB="${METRICS_LIB:-$MONITOR_ROOT/bin/server-metrics.sh}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "poller: нет $ENV_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "poller: TELEGRAM_BOT_TOKEN" >&2
  exit 1
fi
if [[ ! -r "$METRICS_LIB" ]]; then
  echo "poller: нет $METRICS_LIB" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$METRICS_LIB"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

OFFSET=0
[[ -f "$OFFSET_FILE" ]] && OFFSET="$(tr -dc '0-9' <"$OFFSET_FILE" | head -c 20 || true)"
[[ -z "$OFFSET" ]] && OFFSET=0

API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

json_ok() {
  local j="$1"
  [[ "$(jq -r '.ok // false' <<<"$j" 2>/dev/null)" == "true" ]]
}

send_to_chat() {
  local cid="$1" text="$2"
  local payload out
  ((${#text} > 3900)) && text="${text:0:3900}"$'\n…(обрезано)'
  payload="$(jq -nc --arg chat_id "$cid" --arg text "$text" \
    '{chat_id: $chat_id, text: $text, disable_web_page_preview: true}' 2>/dev/null)" || {
    echo "poller: jq payload failed" >&2
    return 1
  }
  out="$(curl -sS -m 45 -X POST "${API}/sendMessage" -H 'Content-Type: application/json' -d "$payload" 2>&1)" || {
    echo "poller: curl sendMessage failed: $out" >&2
    return 1
  }
  if ! json_ok "$out"; then
    echo "poller: sendMessage API: $out" >&2
    return 1
  fi
  return 0
}

is_status_cmd() {
  local t="${1:-}"
  t="${t#"${t%%[![:space:]]*}"}"
  t="${t%%$'\r'}"
  [[ "${t,,}" =~ ^/status(@[A-Za-z0-9_]+)?([[:space:]].*)?$ ]]
}

curl -sS -m 20 "${API}/deleteWebhook?drop_pending_updates=false" >/dev/null 2>&1 || true

me="$(curl -sS -m 15 "${API}/getMe" 2>&1)" || me=""
if json_ok "$me"; then
  echo "poller: ok, бот @$(jq -r '.result.username // "?"' <<<"$me")" >&2
else
  echo "poller: getMe не ok — проверь токен: ${me:0:200}" >&2
fi

echo "poller: long poll старт, offset=$OFFSET (логи: journalctl -u telegram-poller -f)" >&2

while true; do
  resp=""
  if ! resp="$(curl -sS -m 65 "${API}/getUpdates?offset=${OFFSET}&timeout=55&allowed_updates=%5B%22message%22%2C%22channel_post%22%2C%22edited_message%22%2C%22edited_channel_post%22%5D" 2>&1)"; then
    echo "poller: getUpdates curl error: ${resp:0:300}" >&2
    sleep 5
    continue
  fi
  if ! json_ok "$resp"; then
    echo "poller: getUpdates не ok: ${resp:0:400}" >&2
    sleep 5
    continue
  fi

  new_off="$OFFSET"
  while IFS= read -r item || [[ -n "$item" ]]; do
    [[ -z "${item:-}" || "$item" == "null" ]] && continue
    uid="$(jq -r '.update_id // empty' <<<"$item" 2>/dev/null)"
    [[ "$uid" =~ ^[0-9]+$ ]] || continue
    new_off=$((uid + 1))

    text="$(jq -r '.message.text // .channel_post.text // .edited_message.text // .edited_channel_post.text // empty' <<<"$item" 2>/dev/null)"
    chat_id="$(jq -r '.message.chat.id // .channel_post.chat.id // .edited_message.chat.id // .edited_channel_post.chat.id // empty' <<<"$item" 2>/dev/null)"

    if [[ -n "$text" && -n "$chat_id" ]] && is_status_cmd "$text"; then
      allowed="${STATUS_ALLOWED_CHAT_IDS:-}"
      if [[ -n "$allowed" ]]; then
        [[ ",${allowed}," == *",${chat_id},""* ]] || continue
      fi
      echo "poller: /status от chat_id=$chat_id" >&2
      rep="$(build_status_report)" || rep="ошибка build_status_report"
      send_to_chat "$chat_id" "$rep" || true
    fi
  done < <(jq -c '.result[]?' <<<"$resp" 2>/dev/null)

  if [[ "$new_off" =~ ^[0-9]+$ ]] && ((new_off > OFFSET)); then
    OFFSET=$new_off
    echo "$OFFSET" >"$OFFSET_FILE.tmp"
    mv -f "$OFFSET_FILE.tmp" "$OFFSET_FILE"
  fi
done
