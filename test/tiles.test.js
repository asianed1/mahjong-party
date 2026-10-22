'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../server/tiles');
const { Game } = require('../server/game');

const bots = () => [0, 1, 2, 3].map((i) => ({ name: `Bot ${i + 1}`, isBot: true }));

test('wall has 144 tiles: 4x34 playing tiles + 8 unique flowers', () => {
  const w = T.buildWall();
  assert.equal(w.length, 144);
  for (let t = 0; t < 34; t++) assert.equal(w.filter((x) => x === t).length, 4);
  for (let t = 34; t < 42; t++) assert.equal(w.filter((x) => x === t).length, 1);
});

test('shuffle is a permutation and actually shuffles', () => {
  const a = T.shuffle(T.buildWall()), b = T.shuffle(T.buildWall());
  assert.deepEqual(a.slice().sort((x, y) => x - y), T.buildWall());
  assert.notDeepEqual(a, b);
});

test('deal: dealer 14, others 13, no flowers in hands, all 144 tiles accounted for', () => {
  for (let k = 0; k < 50; k++) {
    const g = new Game(bots(), { botDelay: 1e9 });
    g.dealer = k % 4;
    g.startHand();
    g.players.forEach((p, i) => {
      assert.equal(p.hand.length, i === g.dealer ? 14 : 13);
      assert.ok(p.hand.every((t) => !T.isFlower(t)));
    });
    const all = g.wall.concat(...g.players.map((p) => p.hand.concat(p.flowers)));
    assert.deepEqual(all.sort((x, y) => x - y), T.buildWall());
    assert.equal(g.turn, g.dealer);
    assert.equal(g.phase, 'discard');
    g.destroy();
  }
});

test('views never leak other players\' hands', () => {
  const g = new Game(bots(), { botDelay: 1e9 });
  g.start();
  const v = g.viewFor(1);
  assert.equal(v.hand.length, 13);
  v.players.forEach((p) => { assert.equal(p.hand, undefined); assert.equal(typeof p.handCount, 'number'); });
  assert.equal(JSON.stringify(v).includes('"wall"'), false);
  g.destroy();
});
