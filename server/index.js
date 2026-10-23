'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');
const rooms = require('./rooms');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.RENDER ? 1 : 'loopback'); // Render's proxy, or cloudflared on localhost

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'", 'ws:', 'wss:'], 'font-src': ["'self'"], 'object-src': ["'none'"], 'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '5m', index: 'index.html' }));

const server = http.createServer(app);
// Real client IP for per-IP limits. On Render every connection arrives from its proxy,
// so use the leftmost forwarded address; locally, trust cf-connecting-ip only from cloudflared on loopback.
function clientIp(req) {
  const remote = req.socket.remoteAddress;
  if (process.env.RENDER) {
    const first = String(req.headers['true-client-ip'] || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  if ((remote === '127.0.0.1' || remote === '::1') && req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']).slice(0, 64);
  return remote;
}
const MAX_SOCKETS = 2000; // global cap across all IPs
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

// per-IP room creation limit (10 per minute) and connection cap
const creations = new Map(), conns = new Map();
const roomLimiter = (ip) => {
  const now = Date.now(); const arr = (creations.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 10) return false; arr.push(now); creations.set(ip, arr); return true;
};

server.on('upgrade', (req, socket, head) => {
  // Only accept same-origin browsers (prevents cross-site WebSocket hijacking)
  const origin = req.headers.origin;
  try { if (origin && new URL(origin).host !== req.headers.host) throw new Error('origin'); } catch { socket.destroy(); return; }
  if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
  const ip = clientIp(req);
  if ((conns.get(ip) || 0) >= 20 || wss.clients.size >= MAX_SOCKETS) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    conns.set(ip, (conns.get(ip) || 0) + 1);
    ws.on('close', () => { const n = (conns.get(ip) || 1) - 1; if (n) conns.set(ip, n); else conns.delete(ip); });
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    rooms.attach(ws, ip, roomLimiter);
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
  rooms.sweep();
  const now = Date.now(); for (const [ip, a] of creations) if (!a.some((t) => now - t < 60000)) creations.delete(ip);
}, 30000).unref();

if (require.main === module) server.listen(PORT, () => console.log(`Mahjong server on http://localhost:${PORT}`));
module.exports = { app, server };
