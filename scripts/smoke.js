'use strict';
// Smoke test: two socket clients create/join a room, chat, start a game and rejoin with a session token.
// Usage: node scripts/smoke.js [http://localhost:3000]
const WebSocket = require('ws');
const base = process.argv[2] || 'http://localhost:3000';
const wsUrl = base.replace(/^http/, 'ws') + '/ws';
const origin = base;

function client(label) {
  const ws = new WebSocket(wsUrl, { headers: { Origin: origin } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of waiters.slice()) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const c = {
    ws, inbox, label,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 5000) => {
      const hit = inbox.find(pred); if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`${label}: timeout waiting`)); }, ms);
        waiters.push(w);
      });
    },
  };
  return c;
}

const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('  ✓', msg); };

(async () => {
  console.log(`Smoke test against ${base}`);
  const res = await fetch(base + '/');
  ok(res.status === 200, 'GET / returns 200');
  ok((res.headers.get('content-security-policy') || '').includes("default-src 'self'"), 'CSP header present');
  ok(res.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');

  const A = client('Sam'), B = client('Alice');
  await A.open(); await B.open();
  A.send({ t: 'create', name: 'Sam' });
  const ja = await A.wait((m) => m.t === 'joined');
  ok(/^[A-Z2-9]{6}$/.test(ja.code) && ja.seat === 0, `room created: ${ja.code}, Sam in seat 1`);

  B.send({ t: 'join', code: ja.code.toLowerCase(), name: 'Alice' });
  const jb = await B.wait((m) => m.t === 'joined');
  ok(jb.seat === 1, 'Alice joined seat 2 (code is case-insensitive)');
  const room = await A.wait((m) => m.t === 'room' && m.seats[1].human);
  ok(room.seats[1].label === 'Alice 2', `room lists Alice as "${room.seats[1].label}"`);

  A.send({ t: 'chat', text: 'Hello <b>Alice</b> <script>alert(1)</script>' });
  const cb = await B.wait((m) => m.t === 'chat');
  ok(cb.label === 'Sam 1' && cb.seat === 0, `chat labelled "${cb.label}"`);
  ok(cb.text === 'Hello <b>Alice</b> <script>alert(1)</script>', 'chat text delivered verbatim as data (rendered via textContent)');

  B.send({ t: 'chat', text: 'what the fuck' });
  const pf = await A.wait((m) => m.t === 'chat' && m.seat === 1);
  ok(pf.text === 'what the f***', 'profanity filter on by default');

  B.send({ t: 'chat', text: 'x'.repeat(301) });
  ok(!!(await B.wait((m) => m.t === 'error' && m.msg.includes('300'))), '301-char message rejected');

  for (let i = 0; i < 6; i++) A.send({ t: 'chat', text: `spam ${i}` });
  const rl = await A.wait((m) => m.t === 'error' && /limit/i.test(m.msg));
  ok(!!rl, 'chat rate limit kicks in after 5 messages / 5s');

  A.send({ t: 'chat', text: 'x', seat: 3, extra: 1 });
  ok(!!(await A.wait((m) => m.t === 'error' && m.msg === 'Invalid message')), 'unexpected payload fields rejected');

  B.send({ t: 'mute', seat: 0, muted: true });
  ok(!!(await B.wait((m) => m.t === 'error' && /host can mute/.test(m.msg))), 'non-host cannot mute');
  A.send({ t: 'mute', seat: 1, muted: true });
  await A.wait((m) => m.t === 'room' && m.seats[1].muted);
  B.send({ t: 'chat', text: 'can you hear me' });
  ok(/muted/.test((await B.wait((m) => m.t === 'error' && /muted/.test(m.msg))).msg), 'host muted Alice; her chat is blocked');
  A.send({ t: 'mute', seat: 1, muted: false });

  B.send({ t: 'start' });
  ok(/host/.test((await B.wait((m) => m.t === 'error' && /host/.test(m.msg))).msg), 'only host can start');
  A.send({ t: 'start' });
  const sa = await A.wait((m) => m.t === 'state');
  const sb = await B.wait((m) => m.t === 'state');
  ok(sa.v.players.length === 4 && sa.v.players[2].isBot && sa.v.players[3].isBot, 'game started; seats 3 & 4 auto-filled with bots');
  ok(Array.isArray(sa.v.hand) && sa.v.players.every((p) => p.hand === undefined), 'client sees only its own hand');
  ok(sa.v.you === 0 && sb.v.you === 1, 'each client gets its own seat view');

  // Simulate a page refresh: drop Alice's socket and rejoin with her token
  B.ws.close();
  await new Promise((r) => setTimeout(r, 300));
  const B2 = client('Alice-again'); await B2.open();
  B2.send({ t: 'rejoin', code: ja.code, token: jb.token });
  const rj = await B2.wait((m) => m.t === 'joined');
  ok(rj.seat === 1, 'Alice rejoined her seat after "refresh" with her session token');
  ok((await B2.wait((m) => m.t === 'state')).v.you === 1, 'rejoined client receives game state');

  const C = client('Mallory'); await C.open();
  C.send({ t: 'rejoin', code: ja.code, token: 'ab'.repeat(24) });
  ok(!!(await C.wait((m) => m.t === 'rejoinFailed')), 'forged token rejected');
  C.send({ t: 'chat', text: 'hi' });
  ok((await C.wait((m) => m.t === 'error')).msg === 'Not in a room', 'chat without a seat token is rejected');

  // cross-site websocket must be refused
  const evil = new WebSocket(wsUrl, { headers: { Origin: 'https://evil.example' } });
  const refused = await new Promise((r) => { evil.on('open', () => r(false)); evil.on('error', () => r(true)); evil.on('unexpected-response', () => r(true)); });
  ok(refused, 'cross-origin WebSocket refused');

  B2.send({ t: 'chat', text: 'back!' });
  const back = await A.wait((m) => m.t === 'chat' && m.text === 'back!');
  ok(back.label === 'Alice 2', 'chat works after rejoin');

  A.send({ t: 'leave' }); B2.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 200));
  [A, B2, C].forEach((c) => c.ws.close());
  console.log('SMOKE TEST PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
