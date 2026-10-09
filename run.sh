#!/bin/sh
set -e

node app/backend/server.js &
BACKEND=$!

# tunggu backend siap sebelum gateway mulai seed index
i=0
while [ "$i" -lt 60 ]; do
  if wget -q -O /dev/null http://127.0.0.1:5000/health 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 0.2
done

ORIGIN=http://127.0.0.1:5000 node app/gateway/gateway.js &
GATEWAY=$!

term() {
  kill "$BACKEND" "$GATEWAY" 2>/dev/null || true
  wait "$BACKEND" "$GATEWAY" 2>/dev/null || true
  exit 0
}
trap term INT TERM

wait "$GATEWAY"