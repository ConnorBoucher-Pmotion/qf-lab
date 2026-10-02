#!/bin/bash
# Keeps the QF lab and its public HTTPS link up.
# A Cloudflare quick tunnel gets a new address if it has to be recreated.
# The current address is written to share-url.txt.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="$ROOT/share-url.txt"
LOG="$ROOT/share.log"
PORT=5190
CF_BIN="${CF_BIN:-$ROOT/.tools/cloudflared}"
TUNNEL_LOG="/tmp/qf-tunnel.log"
PUBLIC=""
CF_PID=""
FAILS=0
GRACE_UNTIL=0

if [[ ! -x "$CF_BIN" && -x /tmp/cloudflared ]]; then
  CF_BIN=/tmp/cloudflared
fi

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"
}

vite_up() {
  curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$PORT"
}

start_vite() {
  if vite_up; then
    return 0
  fi
  log "lab was down, starting it"
  (cd "$ROOT" && npm run dev >>"$LOG" 2>&1) &
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    vite_up && return 0
    sleep 0.5
  done
  log "lab did not come up"
  return 1
}

start_tunnel() {
  if [[ -n "$CF_PID" ]]; then
    kill "$CF_PID" 2>/dev/null || true
    wait "$CF_PID" 2>/dev/null || true
  fi
  # Drop any leftover connector that is still retrying a deleted tunnel.
  pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
  sleep 0.5
  : >"$TUNNEL_LOG"
  # HTTP/2 uses TCP. The previous tunnel died on UDP when the network blipped.
  "$CF_BIN" --protocol http2 --no-autoupdate tunnel --url "http://127.0.0.1:$PORT" >>"$TUNNEL_LOG" 2>&1 &
  CF_PID=$!
  local i url
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    url="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -1 || true)"
    if [[ -n "$url" ]]; then
      PUBLIC="$url"
      echo "$PUBLIC" >"$URL_FILE"
      # DNS for a new quick-tunnel name takes a little while. Checking too
      # early looks like an outage and used to delete a tunnel that was fine.
      GRACE_UNTIL=$(( $(date +%s) + 75 ))
      log "public link $PUBLIC"
      FAILS=0
      return 0
    fi
    if ! kill -0 "$CF_PID" 2>/dev/null; then
      log "tunnel process exited"
      return 1
    fi
    sleep 0.5
  done
  log "tunnel did not publish a link"
  return 1
}

public_up() {
  [[ -n "$PUBLIC" ]] || return 1
  local attempt host ip
  host="${PUBLIC#https://}"
  host="${host%%/*}"
  for attempt in 1 2 3; do
    if curl -sf -o /dev/null --max-time 12 "$PUBLIC"; then
      return 0
    fi
    # A fresh name can be stuck in a negative DNS cache. Ask 1.1.1.1 and pin it.
    ip="$(dig +time=2 +tries=1 +short A "$host" @1.1.1.1 2>/dev/null | head -1 || true)"
    if [[ -n "$ip" ]] && curl -sf -o /dev/null --max-time 12 --resolve "$host:443:$ip" "$PUBLIC"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

adopt_tunnel() {
  local pid url
  url="$(cat "$URL_FILE" 2>/dev/null || true)"
  pid="$(pgrep -n -f "cloudflared --protocol http2 --no-autoupdate tunnel --url http://127.0.0.1:$PORT" || true)"
  [[ -n "$url" && -n "$pid" ]] || return 1
  PUBLIC="$url"
  CF_PID="$pid"
  if public_up; then
    log "keeping existing public link $PUBLIC"
    FAILS=0
    GRACE_UNTIL=$(( $(date +%s) + 30 ))
    return 0
  fi
  PUBLIC=""
  CF_PID=""
  return 1
}

tunnel_dead() {
  grep -q "Tunnel not found" "$TUNNEL_LOG" 2>/dev/null
}

if grep -q 'github.io/' "$URL_FILE" 2>/dev/null; then
  log "stable link already set ($(cat "$URL_FILE")); not opening a temporary tunnel"
  exit 0
fi

log "watch started"
start_vite || exit 1
adopt_tunnel || start_tunnel || exit 1

while true; do
  if ! vite_up; then
    log "lab stopped responding"
    start_vite || true
  fi

  dead=0
  if ! kill -0 "$CF_PID" 2>/dev/null; then
    dead=1
  elif tunnel_dead; then
    dead=1
  elif [[ "$(date +%s)" -lt "$GRACE_UNTIL" ]]; then
    FAILS=0
  elif ! public_up; then
    FAILS=$((FAILS + 1))
    log "public link failed check $FAILS"
    # Six misses, about two minutes, before throwing away a working name.
    if [[ "$FAILS" -ge 6 ]]; then
      dead=1
    fi
  else
    FAILS=0
  fi

  if [[ "$dead" -eq 1 ]]; then
    log "recreating public link"
    start_tunnel || log "recreate failed, will retry"
    FAILS=0
  fi
  sleep 20
done
