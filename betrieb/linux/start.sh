#!/bin/sh
# Einsatzplaner starten (Linux). Liegt in /opt/einsatzplaner/start.sh.
# Startet Node in einer Schleife. Nach dem Ende (z. B. Exit-Code 75 nach einem Update) folgt nach 3 Sekunden ein Neustart.
# Die Ausgabe geht nach logs/einsatzplaner-JJJJ-MM-TT.log. stop.sh legt die Datei stop.flag an.
EP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export ENV_FILE="$EP_ROOT/einsatzplaner.env"
export STOP_DATEI="$EP_ROOT/stop.flag"
export NODE_ENV=production
LOG_DIR="$EP_ROOT/logs"
mkdir -p "$LOG_DIR"
rm -f "$STOP_DATEI"
cd "$EP_ROOT/app" || exit 1

if [ -f "$EP_ROOT/schleife.pid" ] && kill -0 "$(cat "$EP_ROOT/schleife.pid")" 2>/dev/null; then
  echo "Der Einsatzplaner läuft schon."
  exit 1
fi
echo $$ > "$EP_ROOT/schleife.pid"

while [ ! -f "$STOP_DATEI" ]; do
  LOG="$LOG_DIR/einsatzplaner-$(date +%F).log"
  echo "[$(date '+%F %T')] Start" >> "$LOG"
  node dist/src/server.js >> "$LOG" 2>&1
  echo "[$(date '+%F %T')] Node beendet, Code $?" >> "$LOG"
  [ -f "$STOP_DATEI" ] && break
  sleep 3
done
rm -f "$STOP_DATEI" "$EP_ROOT/schleife.pid"
echo "[$(date '+%F %T')] Gestoppt" >> "$LOG_DIR/einsatzplaner-$(date +%F).log"
