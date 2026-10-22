'use strict';
const crypto = require('crypto');
const { Game } = require('./game');
const { cleanText, filterProfanity, RateLimiter, MAX_LEN } = require('./chat');
const T = require('./tiles');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 500;
const ROOM_IDLE_MS = 30 * 60 * 1000;

const rooms = new Map();

function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 6; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
const newToken = () => crypto.randomBytes(24).toString('hex');
const tokenEq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

class Room {
  constructor(opts = {}) {
    this.code = newCode();
    this.seats = [null, null, null, null]; // {token, name, ws, muted, chat:RateLimiter}
    this.host = 0;
    this.settings = { minFaan: 0, rounds: 1, profanity: true };
    this.game = null; this.lastActive = Date.now();
    this.gameOpts = opts.gameOpts || {};
  }
  label(i) { const s = this.seats[i]; return s ? `${s.name} ${i + 1}` : `Bot ${i + 1}`; }
  humans() { return this.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0); }

  addHuman(name, ws) {
    let seat = this.seats.findIndex((s) => !s);
    if (seat < 0) return { error: 'Room is full' };
    if (this.game && !this.game.players[seat].isBot) return { error: 'Room is full' };
    const token = newToken();
    this.seats[seat] = { token, name, ws, muted: false, chat: new RateLimiter(5, 5000) };
    if (this.game) {
      const p = this.game.players[seat]; p.isBot = false; p.name = name; p.away = false;
      this.game.setAway(seat, false);
      this.system(`${name} takes over seat ${seat + 1}`);
    } else this.system(`${name} joined seat ${seat + 1}`);
    return { seat, token };
  }

  findByToken(token) { return this.seats.findIndex((s) => s && tokenEq(s.token, token)); }

  lobbyState(forSeat) {
    return {
      t: 'room', code: this.code, host: this.host, you: forSeat, started: !!this.game, settings: this.settings,
      seats: this.seats.map((s, i) => (s ? { name: s.name, label: this.label(i), human: true, connected: !!(s.ws && s.ws.readyState === 1), muted: s.muted } : { name: 'Bot', label: `Bot ${i + 1}`, human: false })),
    };
  }
  broadcastRoom() { this.seats.forEach((s, i) => s && send(s.ws, this.lobbyState(i))); }
  broadcastState() { if (this.game) this.seats.forEach((s, i) => s && s.ws && send(s.ws, { t: 'state', v: this.game.viewFor(i) })); }
  broadcast(msg) { this.seats.forEach((s) => s && send(s.ws, msg)); }
  system(text) { this.broadcast({ t: 'system', text }); }

  start() {
    const players = this.seats.map((s, i) => (s ? { name: s.name, isBot: false } : { name: `Bot ${i + 1}`, isBot: true }));
    this.game = new Game(players, Object.assign({ minFaan: this.settings.minFaan, rounds: this.settings.rounds }, this.gameOpts));
    this.game.on('update', () => this.broadcastState());
    this.game.on('event', (e) => this.broadcast({ t: 'event', e }));
    this.game.on('error', (e) => console.error('[game]', this.code, e));
    this.seats.forEach((s, i) => { if (s && !(s.ws && s.ws.readyState === 1)) this.game.players[i].away = true; });
    this.broadcastRoom();
    this.game.start();
  }

  destroy() { if (this.game) this.game.destroy(); }
}

// ------------------------------------------------------------ message handling
const VALID = {
  create: (m) => typeof m.name === 'string',
  join: (m) => typeof m.code === 'string' && typeof m.name === 'string',
  rejoin: (m) => typeof m.code === 'string' && typeof m.token === 'string' && /^[0-9a-f]{48}$/.test(m.token),
  start: () => true,
  settings: (m) => (m.minFaan === undefined || m.minFaan === 0 || m.minFaan === 3) && (m.rounds === undefined || m.rounds === 1 || m.rounds === 4) && (m.profanity === undefined || typeof m.profanity === 'boolean'),
  act: (m) => ['discard', 'selfWin', 'kong', 'claim', 'next'].includes(m.a) && (m.tile === undefined || (Number.isInteger(m.tile) && m.tile >= 0 && m.tile < 34))
    && (m.claim === undefined || ['win', 'pung', 'kong', 'chow', 'pass'].includes(m.claim)) && (m.chow === undefined || (Number.isInteger(m.chow) && m.chow >= 0 && m.chow < 27)),
  chat: (m) => typeof m.text === 'string' && m.text.length <= MAX_LEN * 4,
  mute: (m) => Number.isInteger(m.seat) && m.seat >= 0 && m.seat < 4 && typeof m.muted === 'boolean',
  leave: () => true,
  ping: () => true,
};
const ALLOWED_KEYS = new Set(['t', 'name', 'code', 'token', 'minFaan', 'rounds', 'profanity', 'a', 'tile', 'claim', 'chow', 'text', 'seat', 'muted']);

function parseMessage(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let m; try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string' || !Object.hasOwn(VALID, m.t)) return null;
  for (const k of Object.keys(m)) if (!ALLOWED_KEYS.has(k)) return null;
  return VALID[m.t](m) ? m : null;
}

function cleanName(n) { const s = cleanText(n, 16); return s; }

function attach(ws, ip, roomLimiter) {
  const ctx = { room: null, seat: -1, token: null };
  const limiter = new RateLimiter(30, 3000);
  const err = (msg) => send(ws, { t: 'error', msg });

  const bind = (room, seat, token) => {
    // detach previous socket on that seat (e.g. second tab)
    const s = room.seats[seat];
    if (s.ws && s.ws !== ws) { send(s.ws, { t: 'error', msg: 'You opened this seat in another tab.' }); try { s.ws.close(4000, 'replaced'); } catch {} }
    s.ws = ws; ctx.room = room; ctx.seat = seat; ctx.token = token; room.lastActive = Date.now();
    send(ws, { t: 'joined', code: room.code, token, seat });
    if (room.game) room.game.setAway(seat, false);
    room.broadcastRoom();
    if (room.game) send(ws, { t: 'state', v: room.game.viewFor(seat) });
  };

  // Every in-room message re-validates the seat token bound to this socket.
  const authed = () => {
    const { room, seat, token } = ctx;
    if (!room || !rooms.has(room.code) || seat < 0 || !room.seats[seat] || !tokenEq(room.seats[seat].token, token) || room.seats[seat].ws !== ws) { err('Not in a room'); return false; }
    room.lastActive = Date.now();
    return true;
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return ws.close(1003, 'binary not allowed');
    if (!limiter.allow()) { err('Slow down!'); return; }
    const m = parseMessage(data.toString('utf8'));
    if (!m) return err('Invalid message');
    switch (m.t) {
      case 'ping': return send(ws, { t: 'pong' });
      case 'create': {
        if (ctx.room) return err('Already in a room');
        if (!roomLimiter(ip)) return err('Too many rooms created, try again in a minute');
        if (rooms.size >= MAX_ROOMS) return err('Server is busy, try later');
        const name = cleanName(m.name); if (!name) return err('Please enter a name (1-16 characters)');
        const room = new Room(module.exports.defaults); rooms.set(room.code, room);
        const r = room.addHuman(name, ws); room.host = r.seat;
        return bind(room, r.seat, r.token);
      }
      case 'join': {
        if (ctx.room) return err('Already in a room');
        const room = rooms.get(m.code.trim().toUpperCase());
        if (!room) return err('Room not found. Check the code?');
        const name = cleanName(m.name); if (!name) return err('Please enter a name (1-16 characters)');
        const r = room.addHuman(name, ws); if (r.error) return err(r.error);
        return bind(room, r.seat, r.token);
      }
      case 'rejoin': {
        const room = rooms.get(m.code.trim().toUpperCase());
        if (!room) return send(ws, { t: 'rejoinFailed' });
        const seat = room.findByToken(m.token);
        if (seat < 0) return send(ws, { t: 'rejoinFailed' });
        return bind(room, seat, m.token);
      }
    }
    if (!authed()) return;
    const { room, seat } = ctx;
    switch (m.t) {
      case 'start':
        if (seat !== room.host) return err('Only the host can start');
        if (room.game && room.game.phase !== 'gameOver') return err('Game already running');
        if (room.game) room.game.destroy();
        room.system(`${room.label(seat)} started the game`);
        return room.start();
      case 'settings':
        if (seat !== room.host) return err('Only the host can change settings');
        if (m.profanity !== undefined) room.settings.profanity = m.profanity;
        if (!room.game || room.game.phase === 'gameOver') {
          if (m.minFaan !== undefined) room.settings.minFaan = m.minFaan;
          if (m.rounds !== undefined) room.settings.rounds = m.rounds;
        }
        return room.broadcastRoom();
      case 'act': {
        if (!room.game) return err('Game not started');
        const r = room.game.act(seat, { a: m.a, tile: m.tile, claim: m.claim, chow: m.chow });
        if (!r.ok) err(r.error);
        return;
      }
      case 'chat': {
        const s = room.seats[seat];
        if (s.muted) return err('The host has muted you');
        if (!s.chat.allow()) return err('Chat limit: 5 messages per 5 seconds');
        let text = cleanText(m.text); if (!text) return err(`Message must be 1-${MAX_LEN} characters`);
        if (room.settings.profanity) text = filterProfanity(text);
        return room.broadcast({ t: 'chat', seat, label: room.label(seat), text, ts: Date.now() });
      }
      case 'mute': {
        if (seat !== room.host) return err('Only the host can mute');
        const target = room.seats[m.seat];
        if (!target || m.seat === seat) return err('Cannot mute that seat');
        target.muted = m.muted;
        room.system(`${room.label(m.seat)} was ${m.muted ? 'muted' : 'unmuted'} by the host`);
        return room.broadcastRoom();
      }
      case 'leave': {
        const name = room.label(seat);
        room.seats[seat] = null;
        if (room.game) { const p = room.game.players[seat]; p.isBot = true; p.name = `Bot ${seat + 1}`; room.game.setAway(seat, false); }
        if (room.host === seat) { const h = room.humans(); if (h.length) room.host = h[0]; }
        room.system(`${name} left`);
        ctx.room = null; ctx.seat = -1; ctx.token = null;
        if (!room.humans().length) { room.destroy(); rooms.delete(room.code); }
        else room.broadcastRoom();
        return send(ws, { t: 'left' });
      }
    }
  });

  ws.on('close', () => {
    const { room, seat } = ctx;
    if (!room || !room.seats[seat] || room.seats[seat].ws !== ws) return;
    room.seats[seat].ws = null;
    if (room.game) room.game.setAway(seat, true); // a bot plays for you until you reconnect
    room.broadcastRoom();
  });
}

function sweep() {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = r.seats.some((s) => s && s.ws && s.ws.readyState === 1);
    if (!anyone && now - r.lastActive > ROOM_IDLE_MS) { r.destroy(); rooms.delete(code); }
  }
}

module.exports = { attach, rooms, Room, parseMessage, sweep, defaults: {} };
