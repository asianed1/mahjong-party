'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, START_SCORE } = require('../server/game');
const T = require('../server/tiles');

const bots = () => [0, 1, 2, 3].map((i) => ({ name: `Bot ${i + 1}`, isBot: true }));

function playGame(opts) {
  return new Promise((resolve, reject) => {
    const g = new Game(bots(), Object.assign({ botDelay: 0 }, opts));
    let actions = 0;
    g.on('error', reject);
    g.on('update', () => {
      actions++;
      // invariants after every state change
      if (g.phase === 'discard' || g.phase === 'claim') {
        const all = g.wall.concat(...g.players.map((p) => p.hand.concat(p.flowers, p.discards, ...p.melds.map((m) => m.tiles))));
        if (all.length !== 144) reject(new Error(`tile count ${all.length}`));
        g.players.forEach((p, i) => {
          const eq = p.hand.length + 3 * p.melds.length;
          const expect = g.phase === 'discard' && g.turn === i ? 14 : 13;
          if (eq !== expect) reject(new Error(`seat ${i} has ${eq} tiles, expected ${expect} (${g.phase})`));
        });
      }
    });
    g.on('gameOver', (res) => { g.destroy(); resolve({ g, res, actions }); });
    g.start();
  });
}

test('headless simulation: several full 4-bot games finish without errors', { timeout: 120000 }, async () => {
  const summary = [];
  for (let i = 0; i < 6; i++) {
    const { g, res } = await playGame({ rounds: i % 2 ? 4 : 1, minFaan: i === 5 ? 3 : 0 });
    assert.equal(res.gameOver, true);
    const total = res.scores.reduce((a, b) => a + b, 0);
    assert.equal(total, 4 * START_SCORE, 'points are zero-sum');
    assert.ok(g.history.length >= 4);
    if (i === 5) g.history.filter((h) => h.winner != null).forEach((h) => assert.ok(h.faan >= 3));
    summary.push(`${g.history.length} hands, ${g.history.filter((h) => h.winner != null).length} wins`);
  }
  console.log('  simulated games:', summary.join(' | '));
});

test('server validates moves: wrong seat / tile / claim are rejected', () => {
  const g = new Game(bots(), { botDelay: 1e9 });
  g.start();
  const d = g.dealer, other = (d + 1) % 4;
  assert.equal(g.act(other, { a: 'discard', tile: g.players[other].hand[0] }).ok, false);
  const missing = [...Array(34).keys()].find((t) => !g.players[d].hand.includes(t));
  assert.equal(g.act(d, { a: 'discard', tile: missing }).ok, false);
  assert.equal(g.act(d, { a: 'discard', tile: 99 }).ok, false);
  assert.equal(g.act(d, { a: 'claim', claim: 'pung' }).ok, false);
  assert.equal(g.act(d, { a: 'nonsense' }).ok, false);
  assert.equal(g.act(d, { a: 'selfWin' }).ok, !!g.canSelfWin(d));
  g.destroy();
});

test('claim flow: pung beats chow, claimer must discard next', () => {
  const g = new Game(bots(), { botDelay: 1e9, claimTime: 1e9 });
  g.start();
  // craft a position: seat 0 discards 5 Dots; seat 1 can chow, seat 2 can pung
  const P5 = 13;
  g.players[0].hand = [P5, 0, 0, 0, 1, 1, 1, 2, 2, 2, 27, 27, 27, 30];
  g.players[1].hand = [11, 12, 20, 21, 22, 23, 24, 25, 28, 28, 28, 29, 29];
  g.players[2].hand = [P5, P5, 3, 4, 5, 6, 7, 8, 18, 18, 18, 31, 32];
  g.players[3].hand = [9, 9, 9, 10, 10, 10, 33, 33, 33, 26, 26, 26, 19];
  g.dealer = 0; g.turn = 0; g.justDrew = true;
  assert.ok(g.discard(0, P5).ok);
  assert.equal(g.phase, 'claim');
  assert.deepEqual(Object.keys(g.claim.options).sort(), ['1', '2']);
  assert.ok(g.claim.options[1].chows.includes(11));
  assert.ok(g.respond(1, { type: 'chow', chow: 11 }).ok);
  assert.equal(g.phase, 'claim', 'still waiting for seat 2');
  assert.ok(g.respond(2, { type: 'pung' }).ok);
  assert.equal(g.phase, 'discard');
  assert.equal(g.turn, 2);
  assert.equal(g.players[2].melds[0].type, 'pung');
  assert.equal(g.players[2].hand.length, 11);
  assert.equal(g.players[1].melds.length, 0);
  g.destroy();
});

test('discard win beats pung and pays from discarder', () => {
  const g = new Game(bots(), { botDelay: 1e9, claimTime: 1e9 });
  g.start();
  const RD = 31;
  g.players[0].hand = [RD, 0, 0, 0, 1, 1, 1, 2, 2, 2, 27, 27, 27, 30];
  g.players[3].hand = [9, 10, 11, 12, 13, 14, 18, 19, 20, 22, 22, 22, RD]; // waits on RD (pair)
  g.players[2].hand = [RD, RD, 3, 4, 5, 6, 7, 8, 23, 24, 25, 32, 32];
  g.players[1].hand = [15, 15, 15, 16, 16, 16, 33, 33, 33, 26, 26, 26, 17];
  g.dealer = 0; g.turn = 0;
  g.discard(0, RD);
  g.respond(2, { type: 'pung' });
  g.respond(3, { type: 'win' });
  assert.equal(g.phase, 'handOver');
  assert.equal(g.result.winner, 3);
  assert.equal(g.result.from, 0);
  assert.ok(g.result.payments[0] < 0 && g.result.payments[3] > 0 && g.result.payments[2] === 0);
  assert.equal(g.dealer, 1, 'dealer rotates when a non-dealer wins');
  g.destroy();
});

test('3-faan minimum blocks low-value wins', () => {
  const g = new Game(bots(), { botDelay: 1e9, claimTime: 1e9, minFaan: 3 });
  g.start();
  g.players[0].hand = [31, 0, 0, 0, 1, 1, 1, 2, 2, 2, 27, 27, 27, 30];
  g.players[1].melds = [{ type: 'chow', tiles: [9, 10, 11], concealed: false }];
  g.players[1].flowers = [36];
  g.players[1].hand = [12, 13, 14, 18, 19, 20, 22, 22, 22, 31]; // open chicken hand waiting on Red
  g.dealer = 0; g.turn = 0;
  g.discard(0, 31);
  assert.ok(!(g.claim && g.claim.options[1] && g.claim.options[1].win));
  g.destroy();
});
