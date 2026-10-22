'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../server/rules');

// helpers: m(1..9)=characters, p()=dots, s()=bamboo, honors
const m = (...r) => r.map((x) => x - 1), p = (...r) => r.map((x) => x + 8), s = (...r) => r.map((x) => x + 17);
const E = 27, S = 28, W = 29, N = 30, RD = 31, GD = 32, WD = 33;

test('standard win: 4 sets + pair', () => {
  assert.ok(R.isWinningHand([...m(1, 2, 3), ...p(4, 5, 6), ...s(7, 8, 9), E, E, E, RD, RD], []));
  assert.ok(R.isWinningHand([...m(1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9), ...m(5)], [])); // nine gates-ish
  assert.ok(!R.isWinningHand([...m(1, 2, 4), ...p(4, 5, 6), ...s(7, 8, 9), E, E, E, RD, RD], []));
  assert.ok(!R.isWinningHand([...m(8, 9), ...p(1), ...p(4, 5, 6), ...s(7, 8, 9), E, E, E, RD, RD], [])); // no wrap-around
  assert.ok(!R.isWinningHand([E, S, W], []));
});

test('win with declared melds', () => {
  const melds = [{ type: 'pung', tiles: [RD, RD, RD] }, { type: 'kong', tiles: [5, 5, 5, 5], concealed: true }];
  assert.ok(R.isWinningHand([...p(1, 2, 3), ...s(4, 5, 6), N, N], melds));
  assert.ok(!R.isWinningHand([...p(1, 2, 3), ...s(4, 5, 7), N, N], melds));
});

test('seven pairs special', () => {
  const h = [...m(1, 1), ...m(5, 5), ...p(2, 2), ...p(9, 9), ...s(3, 3), E, E, RD, RD];
  assert.ok(R.isSevenPairs(h, 0));
  assert.ok(R.isWinningHand(h, []));
  const sc = R.scoreHand({ concealed: h, melds: [], flowers: [], seatWind: 1, roundWind: 0, selfDrawn: false });
  assert.equal(sc.form, 'sevenPairs');
  assert.ok(sc.items.some((i) => i.name === 'Seven Pairs' && i.faan === 4));
  assert.ok(!R.isSevenPairs([...m(1, 1, 1, 1), ...m(5, 5), ...p(2, 2), ...p(9, 9), ...s(3, 3), E, E], 0), 'four of a kind is not two pairs');
  assert.ok(!R.isWinningHand(h.slice(0, 12).concat(RD, GD), []));
});

test('thirteen orphans special', () => {
  const h = [...m(1, 9), ...p(1, 9), ...s(1, 9), E, S, W, N, RD, GD, WD, WD];
  assert.ok(R.isThirteenOrphans(h, 0));
  const sc = R.scoreHand({ concealed: h, melds: [], flowers: [], seatWind: 0, roundWind: 0 });
  assert.equal(sc.faan, R.LIMIT);
  assert.ok(!R.isThirteenOrphans([...m(1, 9), ...p(1, 9), ...s(1, 9), E, S, W, N, RD, GD, ...m(5), WD], 0));
  assert.ok(!R.isThirteenOrphans(h, 1));
  // 13 orphans wait on all 13
  assert.equal(R.waitingTiles([...m(1, 9), ...p(1, 9), ...s(1, 9), E, S, W, N, RD, GD, WD], []).length, 13);
});

test('faan scoring', () => {
  const base = { melds: [], flowers: [], seatWind: 0, roundWind: 0, selfDrawn: false };
  const allPungFlush = R.scoreHand({ ...base, concealed: [...m(1, 1, 1, 3, 3, 3, 5, 5, 5, 7, 7, 7, 9, 9)] });
  assert.ok(allPungFlush.items.find((i) => i.name === 'All Pungs'));
  assert.ok(allPungFlush.items.find((i) => i.name.startsWith('Full Flush')));
  const chicken = R.scoreHand({ ...base, flowers: [35], seatWind: 2, concealed: [...m(1, 2, 3), ...p(4, 5, 6), ...s(7, 8, 9), ...s(2, 2, 2), ...m(5, 5)], melds: [] });
  const mixed = R.scoreHand({ ...base, seatWind: 2, flowers: [35], concealed: [...p(4, 5, 6), ...s(7, 8, 9), ...s(2, 2, 2), ...m(5, 5)], melds: [{ type: 'chow', tiles: m(1, 2, 3) }] });
  assert.equal(mixed.faan, 0, 'open hand, no bonuses = chicken hand');
  assert.ok(chicken.faan >= 1); // concealed
  const dragons = R.scoreHand({ ...base, concealed: [RD, RD, RD, GD, GD, GD, WD, WD, WD, ...m(1, 2, 3), E, E] });
  assert.ok(dragons.items.find((i) => i.name === 'Great Three Dragons'));
  const winds = R.scoreHand({ ...base, seatWind: 0, roundWind: 0, concealed: [E, E, E, ...m(2, 3, 4), ...p(2, 3, 4), ...s(2, 3, 4), N, N] });
  assert.ok(winds.items.find((i) => i.name === 'Seat wind pung'));
  assert.ok(winds.items.find((i) => i.name === 'Round wind pung'));
  assert.equal(R.basePoints(0), 1); assert.equal(R.basePoints(3), 8); assert.equal(R.basePoints(13), 256);
});

test('claim priority: win > pung/kong > chow; head-bump for multiple wins', () => {
  // discarder seat 0
  assert.equal(R.resolveClaims(0, [{ seat: 1, type: 'chow', chow: 0 }, { seat: 2, type: 'pung' }]).seat, 2);
  assert.equal(R.resolveClaims(0, [{ seat: 1, type: 'chow', chow: 0 }, { seat: 3, type: 'win' }, { seat: 2, type: 'pung' }]).type, 'win');
  assert.equal(R.resolveClaims(0, [{ seat: 3, type: 'win' }, { seat: 2, type: 'win' }]).seat, 2, 'nearest after discarder wins');
  assert.equal(R.resolveClaims(2, [{ seat: 1, type: 'win' }, { seat: 3, type: 'win' }]).seat, 3);
  assert.equal(R.resolveClaims(1, [{ seat: 0, type: 'win' }, { seat: 3, type: 'win' }]).seat, 3);
  assert.equal(R.resolveClaims(0, [{ seat: 1, type: 'kong' }, { seat: 1, type: 'chow' }]).type, 'kong');
  assert.equal(R.resolveClaims(0, [{ seat: 1, type: 'pass' }, { seat: 2, type: 'pass' }]), null);
  assert.equal(R.resolveClaims(0, [{ seat: 0, type: 'win' }]), null, 'discarder cannot claim own tile');
});

test('chow options', () => {
  assert.deepEqual(R.chowOptions([...m(1, 2, 4, 5)], m(3)[0]), [0, 1, 2]);
  assert.deepEqual(R.chowOptions([...m(8, 9)], m(7)[0]), [6]);
  assert.deepEqual(R.chowOptions([...m(9), ...p(1)], m(8)[0]), []);
  assert.deepEqual(R.chowOptions([E, S], W), []);
});

test('shanten / ready / waits', () => {
  const ready = [...m(1, 2, 3), ...p(4, 5, 6), ...s(7, 8, 9), E, E, E, RD];
  assert.equal(R.shanten(ready, 0), 0);
  assert.deepEqual(R.waitingTiles(ready, []), [RD]);
  const twoSided = [...m(2, 3), ...p(4, 5, 6), ...s(7, 8, 9), E, E, E, RD, RD];
  assert.deepEqual(R.waitingTiles(twoSided, []), m(1, 4));
  assert.equal(R.shanten([...m(1, 4, 7), ...p(2, 5, 8), ...s(3, 6, 9), E, S, W, N], 0) > 2, true);
  const sug = R.suggestDiscard([...ready, GD], []);
  assert.ok(sug.tile === GD || sug.tile === RD);
  assert.equal(sug.shanten, 0);
});
