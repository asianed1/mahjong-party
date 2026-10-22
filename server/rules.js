'use strict';
const T = require('./tiles');

function toCounts(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) if (t >= 0 && t < 34) c[t]++;
  return c;
}

// ---------------------------------------------------------------- win check
function findSets(c, i, need, acc, out) {
  while (i < 34 && c[i] === 0) i++;
  if (i >= 34) { if (need === 0) out.push(acc.slice()); return; }
  if (need === 0) return;
  if (c[i] >= 3) {
    c[i] -= 3; acc.push({ type: 'pung', tile: i });
    findSets(c, i, need - 1, acc, out);
    acc.pop(); c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--; acc.push({ type: 'chow', tile: i });
    findSets(c, i, need - 1, acc, out);
    acc.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

/** All ways to split concealed tiles into `need` sets + 1 pair. */
function decompose(tiles, need) {
  const c = toCounts(tiles);
  const out = [];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const res = [];
    findSets(c, 0, need, [], res);
    for (const sets of res) out.push({ kind: 'standard', pair: p, sets });
    c[p] += 2;
  }
  return out;
}

function isSevenPairs(tiles, meldCount) {
  if (meldCount !== 0 || tiles.length !== 14) return false;
  const c = toCounts(tiles);
  return c.every((n) => n === 0 || n === 2);
}

function isThirteenOrphans(tiles, meldCount) {
  if (meldCount !== 0 || tiles.length !== 14) return false;
  const c = toCounts(tiles);
  let pair = false;
  for (let t = 0; t < 34; t++) {
    if (T.isOrphan(t)) {
      if (c[t] === 0) return false;
      if (c[t] === 2) { if (pair) return false; pair = true; } else if (c[t] !== 1) return false;
    } else if (c[t] !== 0) return false;
  }
  return pair;
}

/** Returns every winning form for a 14-tile-equivalent hand (concealed tiles + declared melds). */
function winForms(concealed, melds = []) {
  const need = 4 - melds.length;
  if (need < 0 || concealed.length !== need * 3 + 2) return [];
  if (concealed.some((t) => !(t >= 0 && t < 34))) return [];
  const forms = decompose(concealed, need);
  if (isSevenPairs(concealed, melds.length)) forms.push({ kind: 'sevenPairs' });
  if (isThirteenOrphans(concealed, melds.length)) forms.push({ kind: 'thirteenOrphans' });
  return forms;
}
const isWinningHand = (concealed, melds) => winForms(concealed, melds).length > 0;

// ---------------------------------------------------------------- scoring
const LIMIT = 13;

function suitProfile(tiles) {
  const suits = new Set(); let honors = false;
  for (const t of tiles) { if (T.isSuit(t)) suits.add(T.suitOf(t)); else if (T.isHonor(t)) honors = true; }
  return { suits: suits.size, honors };
}

function flowerItems(flowers, seat) {
  const items = [];
  if (!flowers.length) items.push({ name: 'No flowers', faan: 1 });
  const own = flowers.filter((f) => T.flowerSeat(f) === seat).length;
  if (own) items.push({ name: own > 1 ? `Own flowers ×${own}` : 'Own flower', faan: own });
  const fl = flowers.filter((f) => f < 38).length, se = flowers.filter((f) => f >= 38).length;
  if (fl === 4) items.push({ name: 'All four flowers', faan: 2 });
  if (se === 4) items.push({ name: 'All four seasons', faan: 2 });
  return items;
}

function scoreForm(form, ctx) {
  const items = [];
  const add = (name, faan) => items.push({ name, faan });
  const melds = ctx.melds || [];
  const allTiles = ctx.concealed.concat(...melds.map((m) => m.tiles));
  const openMelds = melds.filter((m) => !m.concealed);
  if (form.kind === 'thirteenOrphans') {
    add('Thirteen Orphans', LIMIT);
  } else {
    if (form.kind === 'sevenPairs') add('Seven Pairs', 4);
    else {
      const sets = melds.map((m) => ({ type: m.type === 'chow' ? 'chow' : 'pung', tile: m.tiles[0] })).concat(form.sets);
      const pungs = sets.filter((s) => s.type === 'pung');
      const chows = sets.filter((s) => s.type === 'chow');
      if (chows.length === 4) add('All Chows', 1);
      if (pungs.length === 4) add('All Pungs', 3);
      const dragonPungs = pungs.filter((s) => T.isDragon(s.tile)).length;
      const windPungs = pungs.filter((s) => T.isWind(s.tile));
      if (dragonPungs === 3) add('Great Three Dragons', 8);
      else if (dragonPungs === 2 && T.isDragon(form.pair)) add('Small Three Dragons', 5);
      else if (dragonPungs) add(dragonPungs > 1 ? `Dragon pungs ×${dragonPungs}` : 'Dragon pung', dragonPungs);
      if (windPungs.length === 4) add('Great Four Winds', LIMIT);
      else if (windPungs.length === 3 && T.isWind(form.pair)) add('Small Four Winds', 10);
      else {
        if (windPungs.some((s) => s.tile === T.EAST + ctx.seatWind)) add('Seat wind pung', 1);
        if (windPungs.some((s) => s.tile === T.EAST + ctx.roundWind)) add('Round wind pung', 1);
      }
    }
    const sp = suitProfile(allTiles);
    if (sp.suits === 0) add('All Honors', 10);
    else if (sp.suits === 1 && !sp.honors) add('Full Flush (one suit)', 7);
    else if (sp.suits === 1) add('Half Flush (one suit + honors)', 3);
  }
  if (ctx.selfDrawn) add('Self-drawn', 1);
  if (openMelds.length === 0) add('Concealed hand', 1);
  if (ctx.lastTile) add('Win on last tile', 1);
  if (ctx.kongReplacement) add('Win on kong replacement', 1);
  items.push(...flowerItems(ctx.flowers || [], ctx.seatWind));
  let faan = items.reduce((s, i) => s + i.faan, 0);
  if (faan > LIMIT) faan = LIMIT;
  return { faan, items, form: form.kind };
}

/**
 * ctx: { concealed (incl. winning tile), melds, flowers, seatWind, roundWind, selfDrawn, lastTile, kongReplacement }
 * Returns best scoring or null if not a winning hand.
 */
function scoreHand(ctx) {
  const forms = winForms(ctx.concealed, ctx.melds || []);
  if (!forms.length) return null;
  let best = null;
  for (const f of forms) { const s = scoreForm(f, ctx); if (!best || s.faan > best.faan) best = s; }
  return best;
}

/** Simple payout: base = 2^faan (capped at 2^8). Self-draw: each opponent pays base. Discard: discarder pays 2×base. */
function basePoints(faan) { return 2 ** Math.min(faan, 8); }

// ---------------------------------------------------------------- claims
const CLAIM_RANK = { win: 3, kong: 2, pung: 2, chow: 1 };

/**
 * Pick the winning claim. claims: [{seat, type}] (type 'pass' ignored).
 * Priority: win > pung/kong > chow. Ties (multiple wins) go to the first seat
 * counter-clockwise after the discarder ("head bump").
 */
function resolveClaims(discarder, claims) {
  const dist = (s) => (s - discarder + 4) % 4;
  const valid = claims.filter((c) => c && CLAIM_RANK[c.type] && c.seat !== discarder);
  valid.sort((a, b) => CLAIM_RANK[b.type] - CLAIM_RANK[a.type] || dist(a.seat) - dist(b.seat));
  return valid[0] || null;
}

/** Chow sequences (start tiles) claimable with `tile` from a hand. */
function chowOptions(hand, tile) {
  if (!T.isSuit(tile)) return [];
  const c = toCounts(hand), r = T.rankOf(tile), out = [];
  for (let start = tile - 2; start <= tile; start++) {
    const sr = r - (tile - start);
    if (sr < 1 || sr > 7) continue;
    const others = [start, start + 1, start + 2].filter((x) => x !== tile);
    if (others.every((x) => c[x] > 0)) out.push(start);
  }
  return out;
}

// ---------------------------------------------------------------- shanten / hints
function shantenStandard(c, meldCount) {
  let best = 8;
  const dfs = (i, sets, partials, pair) => {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) {
      const s = sets + meldCount;
      const p = Math.min(partials, 4 - s);
      const v = 8 - 2 * s - p - (pair ? 1 : 0);
      if (v < best) best = v;
      return;
    }
    // upper bound prune
    if (c[i] >= 3) { c[i] -= 3; dfs(i, sets + 1, partials, pair); c[i] += 3; }
    const suit = i < 27, pos = i % 9;
    if (suit && pos <= 6 && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; dfs(i, sets + 1, partials, pair); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!pair) dfs(i, sets, partials, true);
      dfs(i, sets, partials + 1, pair);
      c[i] += 2;
    }
    if (suit && pos <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; dfs(i, sets, partials + 1, pair); c[i]++; c[i + 1]++; }
    if (suit && pos <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; dfs(i, sets, partials + 1, pair); c[i]++; c[i + 2]++; }
    c[i]--; dfs(i, sets, partials, pair); c[i]++;
  };
  dfs(0, 0, 0, false);
  return best;
}

function shanten(tiles, meldCount = 0) {
  const c = toCounts(tiles);
  let s = shantenStandard(c, meldCount);
  if (meldCount === 0) {
    let pairs = 0, kinds = 0, orph = 0, orphPair = false;
    for (let t = 0; t < 34; t++) {
      if (c[t]) kinds++;
      if (c[t] >= 2) pairs++;
      if (T.isOrphan(t) && c[t]) { orph++; if (c[t] >= 2) orphPair = true; }
    }
    s = Math.min(s, 6 - pairs + Math.max(0, 7 - kinds), 13 - orph - (orphPair ? 1 : 0));
  }
  return s;
}

/** Tiles that would complete a 13-tile-equivalent hand. */
function waitingTiles(hand, melds = []) {
  const out = [];
  for (let t = 0; t < 34; t++) if (isWinningHand(hand.concat(t), melds)) out.push(t);
  return out;
}

function tileKeepValue(c, t, ctx = {}) {
  if (T.isHonor(t)) {
    let v = c[t] >= 2 ? 6 : 0;
    if (T.isDragon(t) || t === T.EAST + (ctx.seatWind ?? -9) || t === T.EAST + (ctx.roundWind ?? -9)) v += 1;
    return v;
  }
  const pos = t % 9; let v = (c[t] - 1) * 3;
  const nb = (d, w) => { const p = pos + d; if (p >= 0 && p <= 8) v += Math.min(c[t + d], 1) * w; };
  nb(-1, 2); nb(1, 2); nb(-2, 1); nb(2, 1);
  if (pos === 0 || pos === 8) v -= 0.5; else if (pos >= 2 && pos <= 6) v += 0.3;
  return v;
}

/** For a 14-equivalent hand: best discard (lowest shanten, then lowest keep value). */
function suggestDiscard(hand, melds = [], ctx = {}) {
  const c = toCounts(hand);
  let best = null;
  for (const t of [...new Set(hand)]) {
    const rest = hand.slice(); rest.splice(rest.indexOf(t), 1);
    const s = shanten(rest, melds.length);
    const v = tileKeepValue(c, t, ctx);
    if (!best || s < best.shanten || (s === best.shanten && v < best.value)) best = { tile: t, shanten: s, value: v, rest };
  }
  return best;
}

module.exports = {
  toCounts, decompose, winForms, isWinningHand, isSevenPairs, isThirteenOrphans,
  scoreHand, basePoints, resolveClaims, chowOptions, shanten, waitingTiles, suggestDiscard, tileKeepValue, LIMIT,
};
