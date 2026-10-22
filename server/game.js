'use strict';
const { EventEmitter } = require('events');
const T = require('./tiles');
const R = require('./rules');
const Bot = require('./bot');

const START_SCORE = 1000;

class Game extends EventEmitter {
  /**
   * players: [{name, isBot}] x4
   * opts: minFaan (0 or 3), rounds (1 = East round only, 4 = full game), botDelay, turnTime, claimTime,
   *       nextHandTime, randInt (test hook), maxHands
   */
  constructor(players, opts = {}) {
    super();
    if (players.length !== 4) throw new Error('need 4 players');
    this.opts = Object.assign({ minFaan: 0, rounds: 1, botDelay: 700, turnTime: 30000, claimTime: 12000, nextHandTime: 20000, randInt: undefined }, opts);
    this.opts.maxHands = this.opts.maxHands || this.opts.rounds * 12;
    this.players = players.map((p) => ({ name: p.name, isBot: !!p.isBot, away: false, score: START_SCORE, hand: [], melds: [], flowers: [], discards: [] }));
    this.dealer = 0; this.roundWind = 0; this.handNo = 0;
    this.phase = 'init'; this.version = 0; this.token = 0;
    this.timers = []; this.deadline = null; this.result = null; this.history = [];
  }

  // ------------------------------------------------------------ helpers
  seatWind(seat) { return (seat - this.dealer + 4) % 4; }
  automated(seat) { const p = this.players[seat]; return p.isBot || p.away; }
  changed() { this.version++; this.emit('update'); }
  event(text, kind = 'info', seat = null, tile = null) { this.emit('event', { text, kind, seat, tile }); }
  later(ms, fn) {
    const tok = this.token;
    const h = setTimeout(() => { if (tok === this.token && !this.destroyed) { try { fn(); } catch (e) { this.emit('error', e); } } }, ms);
    this.timers.push(h);
  }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; this.deadline = null; }
  newPhase(phase) { this.clearTimers(); this.token++; this.phase = phase; }
  destroy() { this.destroyed = true; this.clearTimers(); this.removeAllListeners(); }

  drawTile(seat, fromBack = false) {
    const p = this.players[seat];
    for (;;) {
      if (this.wall.length === 0) return null;
      const t = fromBack ? this.wall.pop() : this.wall.shift();
      if (T.isFlower(t)) { p.flowers.push(t); this.event(`${p.name} reveals flower ${T.tileName(t)}`, 'flower', seat, t); fromBack = true; continue; }
      p.hand.push(t); this.drawn = t; return t;
    }
  }

  // ------------------------------------------------------------ flow
  start() { this.startHand(); }

  startHand() {
    this.newPhase('discard');
    this.handNo++;
    this.wall = T.shuffle(T.buildWall(), this.opts.randInt);
    for (const p of this.players) { p.hand = []; p.melds = []; p.flowers = []; p.discards = []; }
    for (let i = 0; i < 4; i++) { const s = (this.dealer + i) % 4; for (let k = 0; k < 13; k++) this.players[s].hand.push(this.wall.shift()); }
    this.players[this.dealer].hand.push(this.wall.shift());
    this.drawn = this.players[this.dealer].hand[13];
    // flower replacement from the back of the wall, dealer first
    for (let i = 0; i < 4; i++) {
      const s = (this.dealer + i) % 4, p = this.players[s];
      let f;
      while ((f = p.hand.findIndex(T.isFlower)) >= 0) {
        const tile = p.hand.splice(f, 1)[0]; p.flowers.push(tile);
        const r = this.wall.pop(); p.hand.push(r);
        if (s === this.dealer) this.drawn = r;
      }
    }
    this.turn = this.dealer; this.justDrew = true; this.kongRepl = false;
    this.lastDiscard = null; this.claim = null; this.result = null;
    this.event(`Hand ${this.handNo}: ${T.WIND_NAMES[this.roundWind]} round, ${this.players[this.dealer].name} is dealer`, 'hand');
    this.kick();
    this.changed();
  }

  /** Arrange timers/bot moves for the current phase. */
  kick() {
    const o = this.opts;
    if (this.phase === 'discard') {
      const s = this.turn;
      if (this.automated(s)) this.later(o.botDelay, () => this.botTurn(s));
      else { this.deadline = Date.now() + o.turnTime; this.later(o.turnTime, () => { this.event(`${this.players[s].name} ran out of time`, 'info', s); this.botTurn(s); }); }
    } else if (this.phase === 'claim') {
      let humans = false;
      for (const s of Object.keys(this.claim.options).map(Number)) {
        if (this.claim.responses[s]) continue;
        if (this.automated(s)) this.later(Math.min(o.botDelay, 400), () => this.respond(s, Bot.chooseClaim(this, s)));
        else humans = true;
      }
      if (humans) { this.deadline = Date.now() + o.claimTime; this.later(o.claimTime, () => this.resolveClaim()); }
    } else if (this.phase === 'handOver') {
      const anyHuman = this.players.some((p) => !this.automated(this.players.indexOf(p)));
      const wait = anyHuman ? o.nextHandTime : o.botDelay;
      this.deadline = Date.now() + wait;
      this.later(wait, () => this.nextHand());
    }
  }

  botTurn(seat) {
    if (this.phase !== 'discard' || this.turn !== seat) return;
    const mv = Bot.chooseTurn(this, seat);
    const r = this.act(seat, mv);
    if (!r.ok) this.act(seat, { a: 'discard', tile: this.players[seat].hand[this.players[seat].hand.length - 1] });
  }

  /** Main entry for player moves. Returns {ok, error}. */
  act(seat, m) {
    if (!m || typeof m !== 'object') return { ok: false, error: 'bad move' };
    switch (m.a) {
      case 'discard': return this.discard(seat, m.tile);
      case 'selfWin': return this.selfWin(seat);
      case 'kong': return this.selfKong(seat, m.tile);
      case 'claim': return this.respond(seat, { type: m.claim, chow: m.chow });
      case 'next': return this.readyNext(seat);
      default: return { ok: false, error: 'unknown action' };
    }
  }

  ctxFor(seat, extra) {
    const p = this.players[seat];
    return Object.assign({ melds: p.melds, flowers: p.flowers, seatWind: this.seatWind(seat), roundWind: this.roundWind }, extra);
  }

  canSelfWin(seat) {
    if (this.phase !== 'discard' || this.turn !== seat || !this.justDrew) return null;
    const p = this.players[seat];
    const sc = R.scoreHand(this.ctxFor(seat, { concealed: p.hand, selfDrawn: true, lastTile: this.wall.length === 0, kongReplacement: this.kongRepl }));
    return sc && sc.faan >= this.opts.minFaan ? sc : null;
  }

  kongOptions(seat) {
    if (this.phase !== 'discard' || this.turn !== seat || !this.justDrew || this.wall.length === 0) return [];
    const p = this.players[seat], c = R.toCounts(p.hand), out = [];
    for (let t = 0; t < 34; t++) {
      if (c[t] === 4) out.push(t);
      else if (c[t] >= 1 && p.melds.some((m) => m.type === 'pung' && m.tiles[0] === t)) out.push(t);
    }
    return out;
  }

  discard(seat, tile) {
    if (this.phase !== 'discard' || this.turn !== seat) return { ok: false, error: 'not your turn' };
    const p = this.players[seat], idx = p.hand.indexOf(tile);
    if (!T.isValidTile(tile) || idx < 0) return { ok: false, error: 'tile not in hand' };
    p.hand.splice(idx, 1); p.discards.push(tile);
    this.lastDiscard = { tile, seat };
    this.event(`${p.name} discards ${T.tileName(tile)}`, 'discard', seat, tile);
    const options = {};
    for (let i = 1; i < 4; i++) {
      const s = (seat + i) % 4, o = this.claimOptionsFor(s, tile, seat);
      if (o) options[s] = o;
    }
    if (Object.keys(options).length === 0) { this.advance(); return { ok: true }; }
    this.newPhase('claim');
    this.claim = { tile, from: seat, options, responses: {} };
    this.kick(); this.changed();
    return { ok: true };
  }

  claimOptionsFor(s, tile, from) {
    const p = this.players[s], c = R.toCounts(p.hand), o = {};
    const sc = R.scoreHand(this.ctxFor(s, { concealed: p.hand.concat(tile), selfDrawn: false, lastTile: this.wall.length === 0 }));
    if (sc && sc.faan >= this.opts.minFaan) o.win = true;
    if (this.wall.length > 0) {
      if (c[tile] >= 2) o.pung = true;
      if (c[tile] >= 3) o.kong = true;
      if (s === (from + 1) % 4) { const ch = R.chowOptions(p.hand, tile); if (ch.length) o.chows = ch; }
    }
    return Object.keys(o).length ? o : null;
  }

  respond(seat, c) {
    if (this.phase !== 'claim') return { ok: false, error: 'nothing to claim' };
    const opt = this.claim.options[seat];
    if (!opt) return { ok: false, error: 'no claim available' };
    if (this.claim.responses[seat]) return { ok: false, error: 'already answered' };
    const type = c && c.type;
    if (type === 'pass') this.claim.responses[seat] = { seat, type };
    else if (type === 'win' && opt.win) this.claim.responses[seat] = { seat, type };
    else if (type === 'pung' && opt.pung) this.claim.responses[seat] = { seat, type };
    else if (type === 'kong' && opt.kong) this.claim.responses[seat] = { seat, type };
    else if (type === 'chow' && opt.chows && opt.chows.includes(c.chow)) this.claim.responses[seat] = { seat, type, chow: c.chow };
    else return { ok: false, error: 'invalid claim' };
    if (Object.keys(this.claim.options).every((s) => this.claim.responses[s])) this.resolveClaim();
    else this.changed();
    return { ok: true };
  }

  resolveClaim() {
    if (this.phase !== 'claim') return;
    const { tile, from } = this.claim;
    const win = R.resolveClaims(from, Object.values(this.claim.responses));
    if (!win) { this.advance(); return; }
    const p = this.players[win.seat], d = this.players[from];
    d.discards.pop();
    this.lastDiscard = null;
    if (win.type === 'win') {
      p.hand.push(tile);
      return this.finishHand({ winner: win.seat, from, selfDrawn: false, tile });
    }
    this.newPhase('discard');
    const take = (t, n) => { for (let k = 0; k < n; k++) p.hand.splice(p.hand.indexOf(t), 1); };
    if (win.type === 'pung' || win.type === 'kong') {
      const n = win.type === 'pung' ? 2 : 3;
      take(tile, n);
      p.melds.push({ type: win.type, tiles: new Array(n + 1).fill(tile), concealed: false, from });
    } else {
      const seq = [win.chow, win.chow + 1, win.chow + 2];
      seq.filter((t) => t !== tile).forEach((t) => take(t, 1));
      p.melds.push({ type: 'chow', tiles: seq, concealed: false, from });
    }
    this.event(`${p.name} ${win.type === 'kong' ? 'kongs' : win.type + 's'} ${T.tileName(tile)}!`, win.type, win.seat, tile);
    this.turn = win.seat; this.justDrew = false; this.kongRepl = false; this.drawn = null;
    if (win.type === 'kong') {
      if (this.drawTile(win.seat, true) == null) return this.finishHand(null);
      this.justDrew = true; this.kongRepl = true;
    }
    this.kick(); this.changed();
  }

  advance() {
    this.newPhase('discard');
    this.claim = null;
    this.turn = (this.turn + 1) % 4;
    if (this.lastDiscard) this.turn = (this.lastDiscard.seat + 1) % 4;
    if (this.drawTile(this.turn) == null) return this.finishHand(null);
    this.justDrew = true; this.kongRepl = false;
    this.kick(); this.changed();
  }

  selfWin(seat) {
    if (!this.canSelfWin(seat)) return { ok: false, error: 'not a winning hand' };
    this.finishHand({ winner: seat, from: null, selfDrawn: true, tile: this.drawn });
    return { ok: true };
  }

  selfKong(seat, tile) {
    if (!this.kongOptions(seat).includes(tile)) return { ok: false, error: 'cannot kong that' };
    const p = this.players[seat];
    const pung = p.melds.find((m) => m.type === 'pung' && m.tiles[0] === tile);
    if (pung) { p.hand.splice(p.hand.indexOf(tile), 1); pung.type = 'kong'; pung.tiles.push(tile); }
    else { p.hand = p.hand.filter((t) => t !== tile); p.melds.push({ type: 'kong', tiles: [tile, tile, tile, tile], concealed: true }); }
    this.newPhase('discard');
    this.event(`${p.name} declares a kong!`, 'kong', seat, pung ? tile : null);
    if (this.drawTile(seat, true) == null) { this.finishHand(null); return { ok: true }; }
    this.justDrew = true; this.kongRepl = true;
    this.kick(); this.changed();
    return { ok: true };
  }

  finishHand(win) {
    this.newPhase('handOver');
    this.claim = null;
    const res = { handNo: this.handNo, roundWind: this.roundWind, dealer: this.dealer, winner: null, payments: [0, 0, 0, 0] };
    res.hands = this.players.map((p) => ({ hand: T.sortTiles(p.hand), melds: p.melds, flowers: p.flowers }));
    if (win) {
      const p = this.players[win.winner];
      const sc = R.scoreHand(this.ctxFor(win.winner, { concealed: p.hand, selfDrawn: win.selfDrawn, lastTile: this.wall.length === 0, kongReplacement: win.selfDrawn && this.kongRepl }));
      const base = R.basePoints(sc.faan);
      if (win.selfDrawn) { for (let s = 0; s < 4; s++) if (s !== win.winner) { res.payments[s] -= base; res.payments[win.winner] += base; } }
      else { res.payments[win.from] -= base * 2; res.payments[win.winner] += base * 2; }
      Object.assign(res, { winner: win.winner, from: win.from, selfDrawn: win.selfDrawn, tile: win.tile, faan: sc.faan, items: sc.items, form: sc.form });
      this.event(`${p.name} wins${win.selfDrawn ? ' by self-draw' : ` on ${this.players[win.from].name}'s discard`}! ${sc.faan} faan`, 'win', win.winner);
    } else {
      this.event('Wall exhausted: draw game', 'draw');
    }
    this.players.forEach((p, i) => { p.score += res.payments[i]; });
    // dealer rotation: dealer keeps the deal on a dealer win or a draw
    if (win && win.winner !== this.dealer) {
      this.dealer = (this.dealer + 1) % 4;
      if (this.dealer === 0) this.roundWind++;
    }
    res.gameOver = this.roundWind >= this.opts.rounds || this.handNo >= this.opts.maxHands;
    res.scores = this.players.map((p) => p.score);
    this.result = res; this.history.push(res);
    this.readySeats = new Set();
    if (res.gameOver) { this.phase = 'gameOver'; this.event('Game over!', 'gameover'); this.emit('gameOver', res); }
    else this.kick();
    this.changed();
  }

  readyNext(seat) {
    if (this.phase !== 'handOver') return { ok: false, error: 'not now' };
    this.readySeats.add(seat);
    const humans = [0, 1, 2, 3].filter((s) => !this.automated(s));
    if (humans.every((s) => this.readySeats.has(s))) this.nextHand(); else this.changed();
    return { ok: true };
  }

  nextHand() { if (this.phase === 'handOver') this.startHand(); }

  setAway(seat, away) {
    const p = this.players[seat]; if (p.away === away) return;
    p.away = away;
    if (['discard', 'claim', 'handOver'].includes(this.phase)) { this.clearTimers(); this.token++; this.kick(); }
    this.changed();
  }

  // ------------------------------------------------------------ views (each client only sees its own hand)
  hintFor(seat) {
    const p = this.players[seat];
    const ctx = { seatWind: this.seatWind(seat), roundWind: this.roundWind };
    if (this.phase === 'discard' && this.turn === seat) {
      const sug = R.suggestDiscard(p.hand, p.melds, ctx);
      if (!sug) return null;
      return { discard: sug.tile, shanten: sug.shanten, ready: sug.shanten === 0, waits: sug.shanten === 0 ? R.waitingTiles(sug.rest, p.melds) : [] };
    }
    if (p.hand.length % 3 === 1) {
      const s = R.shanten(p.hand, p.melds.length);
      return { discard: null, shanten: s, ready: s === 0, waits: s === 0 ? R.waitingTiles(p.hand, p.melds) : [] };
    }
    return null;
  }

  viewFor(seat) {
    const me = seat != null ? this.players[seat] : null;
    const v = {
      phase: this.phase, turn: this.turn, dealer: this.dealer, roundWind: this.roundWind, handNo: this.handNo,
      wallCount: this.wall ? this.wall.length : 0, minFaan: this.opts.minFaan, rounds: this.opts.rounds,
      remainingMs: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      lastDiscard: this.lastDiscard,
      players: this.players.map((p, i) => ({
        name: p.name, isBot: p.isBot, away: p.away, score: p.score, seatWind: this.seatWind(i), handCount: p.hand.length,
        flowers: p.flowers, discards: p.discards,
        melds: p.melds.map((m) => (m.concealed && i !== seat && this.phase !== 'handOver' && this.phase !== 'gameOver') ? { type: m.type, concealed: true, tiles: [-1, -1, -1, -1] } : m),
      })),
      you: seat,
    };
    if (me) {
      v.hand = T.sortTiles(me.hand);
      v.drawn = this.phase === 'discard' && this.turn === seat && this.justDrew ? this.drawn : null;
      v.actions = {
        discard: this.phase === 'discard' && this.turn === seat,
        selfWin: !!this.canSelfWin(seat),
        kongs: this.kongOptions(seat),
        claim: this.phase === 'claim' && this.claim.options[seat] && !this.claim.responses[seat] ? this.claim.options[seat] : null,
        claimTile: this.phase === 'claim' ? this.claim.tile : null,
        waitingOthers: this.phase === 'claim' && !!this.claim.responses[seat],
        next: this.phase === 'handOver' && !this.readySeats.has(seat),
      };
      if (this.phase === 'discard' || this.phase === 'claim') v.hint = this.hintFor(seat);
    }
    if (this.phase === 'handOver' || this.phase === 'gameOver') v.result = this.result;
    return v;
  }
}

module.exports = { Game, START_SCORE };
