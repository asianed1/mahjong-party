#!/usr/bin/env bash
# Expose the local server with a free Cloudflare quick tunnel (needs outbound TCP/UDP 7844).
# Usage: scripts/tunnel.sh [port]   -> prints an https://*.trycloudflare.com URL into logs/tunnel.log
PORT=${1:-3000}
cd "$(dirname "$0")/.." && mkdir -p logs
nohup cloudflared tunnel --no-autoupdate --protocol http2 --url "http://localhost:${PORT}" > logs/tunnel.log 2>&1 &
sleep 10
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | head -1
