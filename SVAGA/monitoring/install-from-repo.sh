#!/usr/bin/env bash
# Копирует скрипты и unit-файлы из клона репозитория в /opt/hysteria-monitor и systemd.
# Не перезаписывает hysteria-monitor.env если уже есть (секреты остаются).
# Запуск: из корня клона или так:  sudo bash SVAGA/monitoring/install-from-repo.sh
set -euo pipefail

MON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOP="$(git -C "$MON_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$TOP" ]]; then
  echo "install-from-repo: каталог $MON_DIR не внутри git-репозитория" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y curl jq iproute2
fi

M="$MON_DIR"
DEST="/opt/hysteria-monitor"

mkdir -p "$DEST/bin" "$DEST/config" "$DEST/state"

install -m 755 "$M/hysteria-service-monitor.sh" "$M/load-alert.sh" "$M/telegram-poller.sh" "$DEST/bin/"
install -m 644 "$M/server-metrics.sh" "$DEST/bin/"

ENV="$DEST/config/hysteria-monitor.env"
if [[ ! -f "$ENV" ]]; then
  echo "install-from-repo: создаю $ENV — ОБЯЗАТЕЛЬНО отредактируй TELEGRAM_*"
  tee "$ENV" >/dev/null <<'EOFENV'
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=-5013050970
AUTO_START_FAILED=1
AUTO_START_DELAY_SEC=2
LOAD_ALERT_ENABLED=1
LOAD_ALERT_1M=0
MEM_ALERT_PCT=90
DISK_ALERT_PCT=90
STATUS_ALLOWED_CHAT_IDS=
EOFENV
  chmod 600 "$ENV"
fi

install -m 644 "$M/hysteria-monitor.service" "$M/hysteria-monitor.timer" \
  "$M/load-alert.service" "$M/load-alert.timer" "$M/telegram-poller.service" \
  /etc/systemd/system/

systemctl daemon-reload
systemctl enable hysteria-monitor.timer load-alert.timer telegram-poller.service
systemctl restart telegram-poller.service
systemctl start hysteria-monitor.service 2>/dev/null || true
systemctl start load-alert.service 2>/dev/null || true

echo "install-from-repo: готово. Проверь: systemctl status telegram-poller.service --no-pager"
