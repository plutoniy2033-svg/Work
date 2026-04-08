#!/usr/bin/env bash
# Метрики для /status и алертов. source-only.

fmt_bytes() {
  local b="${1:-0}"
  awk -v b="$b" 'BEGIN{split("B KB MB GB TB",u," "); i=1; while(b>=1024 && i<5){b/=1024;i++} printf "%.1f %s", b, u[i]}'
}

cpu_usage_1s() {
  local ua na sa ia wa hi si st a_idle a_total ub nb sb ib wb hb sb2 stb b_idle b_total dt di
  read -r _ ua na sa ia wa hi si st _ < /proc/stat
  a_idle=$((ia+wa)); a_total=$((ua+na+sa+ia+wa+hi+si+st))
  sleep 1
  read -r _ ub nb sb ib wb hb sb2 stb _ < /proc/stat
  b_idle=$((ib+wb)); b_total=$((ub+nb+sb+ib+wb+hb+sb2+stb))
  dt=$((b_total-a_total)); di=$((b_idle-a_idle))
  awk -v dt="$dt" -v di="$di" 'BEGIN{ if(dt<=0){print "?"} else {printf "%.0f%%", (dt-di)*100/dt} }'
}

mem_human() {
  local mt ma used
  mt=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  ma=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  [[ -z "${ma:-}" || "$ma" -eq 0 ]] 2>/dev/null && ma=$(awk '/^MemFree:/ {print $2}' /proc/meminfo)
  used=$((mt - ma)) # kB
  awk -v mt="$mt" -v used="$used" 'BEGIN{printf "%.0fMB / %.0fMB (%.0f%%)", (used/1024),(mt/1024),(used/mt)*100}'
}

net_speed_1s() {
  local rx1 tx1 rx2 tx2
  read -r rx1 tx1 < <(awk -F'[: ]+' 'NR>2 && $1!="lo" {rx+=$3; tx+=$11} END{print rx+0, tx+0}' /proc/net/dev)
  sleep 1
  read -r rx2 tx2 < <(awk -F'[: ]+' 'NR>2 && $1!="lo" {rx+=$3; tx+=$11} END{print rx+0, tx+0}' /proc/net/dev)
  echo "↓ $(fmt_bytes $((rx2-rx1)))/s  ↑ $(fmt_bytes $((tx2-tx1)))/s"
}

active_users_now() {
  # Приоритет: API (если задано) → fallback на порт (ss).
  if [[ -n "${SASVPN_API_BASE:-}" && -n "${SASVPN_API_KEY:-}" ]]; then
    resp="$(
      curl -sS -m 10 \
        -H "Authorization: ${SASVPN_API_KEY}" \
        -H "Accept: application/json" \
        "${SASVPN_API_BASE%/}/api/v1/users/" 2>/dev/null || true
    )"
    if [[ -n "$resp" ]]; then
      # Требование: число уникальных username в ответе.
      n="$(jq -r '[.[].username // empty] | unique | length' <<<"$resp" 2>/dev/null || true)"
      [[ "$n" =~ ^[0-9]+$ ]] && { echo "$n"; return; }
    fi
  fi

  # Fallback: считаем уникальные peer IPv4 на входящих сокетах к локальному порту.
  local port="${ACTIVE_USERS_PORT:-}"
  [[ -z "$port" ]] && { echo "?"; return; }
  {
    ss -Hnup 2>/dev/null | awk -v p=":${port}$" '$5 ~ p && $6 !~ /^\*:/ {print $6}'
    ss -Hntp 2>/dev/null | awk -v p=":${port}$" '$4 ~ p && $5 !~ /^\*:/ {print $5}'
  } \
  | sed -E 's/%[^ ]+//; s/^\[//; s/\]$//; s/:[0-9]+$//' \
  | grep -E '^[0-9]+\.' \
  | sort -u | wc -l | tr -dc '0-9'
}

build_status_report() {
  local host l1 l5 l15 disk_use disk_avail up cpu net users
  host=$(hostname -f 2>/dev/null || hostname)
  read -r l1 l5 l15 _ < /proc/loadavg
  disk_use=$(df -P / 2>/dev/null | awk 'NR==2 {print $5}')
  disk_avail=$(df -Ph / 2>/dev/null | awk 'NR==2 {print $4}')
  up=$(uptime -p 2>/dev/null || uptime)
  cpu=$(cpu_usage_1s)
  net=$(net_speed_1s)
  users=$(active_users_now)
  [[ -z "$users" ]] && users="?"

  {
    echo "Сервер: ${host}"
    echo "Время:  $(date -Is)"
    echo ""
    echo "VPN:"
    echo "- Активных пользователей сейчас: ${users}"
    echo ""
    echo "Нагрузка:"
    echo "- CPU usage (≈за 1 секунду): ${cpu}"
    echo "- Load average (1/5/15 мин): ${l1} / ${l5} / ${l15} (ядер: $(nproc 2>/dev/null || echo '?'))"
    echo ""
    echo "Память:"
    echo "- RAM: $(mem_human)"
    echo ""
    echo "Диск:"
    echo "- / : занято ${disk_use}, свободно ${disk_avail}"
    echo ""
    echo "Сеть:"
    echo "- Скорость сейчас (≈за 1 секунду): ${net}"
    echo ""
    echo "Аптайм:"
    echo "- ${up}"
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
