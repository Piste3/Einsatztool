#!/bin/sh
# Einsatzplaner stoppen (Linux). Beendet nur den Einsatzplaner und die Schleife in start.sh.
EP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PID_DATEI="$EP_ROOT/schleife.pid"
if [ ! -f "$PID_DATEI" ] || ! kill -0 "$(cat "$PID_DATEI")" 2>/dev/null; then
  echo "Der Einsatzplaner läuft nicht."
  rm -f "$PID_DATEI"
  exit 0
fi
touch "$EP_ROOT/stop.flag"
i=0
while kill -0 "$(cat "$PID_DATEI" 2>/dev/null)" 2>/dev/null && [ $i -lt 20 ]; do
  sleep 1
  i=$((i + 1))
done
if [ -f "$PID_DATEI" ] && kill -0 "$(cat "$PID_DATEI")" 2>/dev/null; then
  # Notfall: nur den Node-Prozess dieser Schleife beenden.
  pkill -TERM -P "$(cat "$PID_DATEI")" node
fi
echo "Einsatzplaner gestoppt."
