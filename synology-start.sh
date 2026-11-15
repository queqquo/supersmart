#!/bin/sh
# Script di avvio leggero per Synology DS215+ (ARMv7, 1 GB RAM, No Docker)
# Configurabile in DSM -> Pannello di controllo -> Utilità di pianificazione (All'avvio)

APP_DIR="/volume1/web/supersmart"
PORT=3000

cd "$APP_DIR" || exit 1

# Termina eventuale istanza precedente
pkill -f "node server.cjs" 2>/dev/null

# Avvia il server pre-compilato con limite RAM ottimizzato per DS215+ (max 96 MB heap)
export NODE_ENV=production
export PORT=$PORT
nohup node --max-old-space-size=96 server.cjs > "$APP_DIR/supersmart.log" 2>&1 &

echo "SuperSmart avviato su porta $PORT (PID $!)"
