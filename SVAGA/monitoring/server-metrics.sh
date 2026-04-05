#!/usr/bin/env bash
# Общие метрики для алертов и ответа /status. Источник: source (не запускать напрямую).

build_status_report() {
  local host cores load1 load5 load15 mt ma mf used_pct root_use root_avail
  host=$(hostname -f 2>/dev/null || hostname)
  cores=$(nproc 2>/dev/null || echo "?")
  read -r load1 load5 load15 _ < /proc/loadavg

  mt=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  ma=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  [[ -z "${ma:-}" || "$ma" -eq 0 ]] 2>/dev/null && ma=$(awk '/^MemFree:/ {print $2}' /proc/meminfo)
  mf=$(awk '/^MemFree:/ {print $2}' /proc/meminfo)
  if [[ -n "${mt:-}" && "${mt:-0}" -gt 0 ]]; then
    used_pct=$(( (mt - ma) * 100 / mt ))
  else
    used_pct="?"
  fi

  root_use=$(df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
  root_avail=$(df -Ph / 2>/dev/null | awk 'NR==2 {print $4}')

  {
    echo "🖥 ${host}"
    echo "⏱ $(date -Is)"
    echo ""
    echo "=== Load (1/5/15) ==="
    echo "${load1} ${load5} ${load15}  (ядер CPU: ${cores})"
    echo ""
    echo "=== Memory (kB из /proc/meminfo) ==="
    echo "MemTotal: ${mt:-?}  MemAvailable: ${ma:-?}  MemFree: ${mf:-?}"
    echo "Использование RAM ~${used_pct}%"
    echo ""
    echo "=== Disk / ==="
    echo "Занято: ${root_use:-?}%  Доступно: ${root_avail:-?}"
    df -Ph / 2>/dev/null | tail -n +1
    echo ""
    echo "=== Сеть: интерфейсы ==="
    ip -br link 2>/dev/null || true
    echo ""
    echo "=== Сеть: /proc/net/dev (фрагмент) ==="
    grep -v '^\s*lo:' /proc/net/dev 2>/dev/null | tail -n +3 | head -12 || true
    echo ""
    echo "=== Uptime ==="
    uptime -p 2>/dev/null || uptime
  }
}

# Возвращает 0 если пороги превышены, выставляет переменные REASONS (массив) и LOAD1, MEM_USED_PCT, DISK_USE_PCT
collect_load_state() {
  REASONS=()
  read -r LOAD1 _ < /proc/loadavg
  local cores
  cores="$(nproc 2>/dev/null || echo 1)"
  local thr="${LOAD_ALERT_1M:-}"
  [[ -z "$thr" || "$thr" == "0" ]] && thr="$cores"
  if awk -v l="$LOAD1" -v t="$thr" 'BEGIN{exit !((l+0) >= (t+0))}'; then
    REASONS+=("load1=${LOAD1} >= ${thr} (порог: LOAD_ALERT_1M или по умолчанию ядер=${cores})")
  fi

  local mt ma
  mt=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  ma=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  [[ -z "${ma:-}" ]] && ma=$(awk '/^MemFree:/ {print $2}' /proc/meminfo)
  MEM_USED_PCT=0
  if [[ -n "${mt:-}" && "${mt:-0}" -gt 0 ]]; then
    MEM_USED_PCT=$(( (mt - ma) * 100 / mt ))
  fi
  local memp="${MEM_ALERT_PCT:-90}"
  if [[ "$MEM_USED_PCT" -ge "$memp" ]]; then
    REASONS+=("RAM занято ~${MEM_USED_PCT}% (порог ${memp}%)")
  fi

  DISK_USE_PCT=$(df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5+0}')
  local diskp="${DISK_ALERT_PCT:-90}"
  if [[ "${DISK_USE_PCT:-0}" -ge "$diskp" ]]; then
    REASONS+=("диск / занят ${DISK_USE_PCT}% (порог ${diskp}%)")
  fi

  ((${#REASONS[@]} > 0))
}
