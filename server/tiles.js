'use strict';
// Tile kinds are integers:
//  0-8   Characters (Craks) 1-9      9-17 Dots 1-9      18-26 Bamboo 1-9
//  27-30 Winds East, South, West, North
//  31-33 Dragons Red, Green, White
//  34-37 Flowers 1-4 (Plum, Orchid, Chrysanthemum, Bamboo)
//  38-41 Seasons 1-4 (Spring, Summer, Autumn, Winter)
const crypto = require('crypto');

const SUIT_NAMES = ['Characters', 'Dots', 'Bamboo'];
const WIND_NAMES = ['East', 'South', 'West', 'North'];
const DRAGON_NAMES = ['Red', 'Green', 'White'];
const FLOWER_NAMES = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo', 'Spring', 'Summer', 'Autumn', 'Winter'];

const EAST = 27, RED = 31, FIRST_FLOWER = 34, NUM_KINDS = 42;

const isSuit = (t) => t >= 0 && t < 27;
const isHonor = (t) => t >= 27 && t < 34;
const isWind = (t) => t >= 27 && t <= 30;
const isDragon = (t) => t >= 31 && t <= 33;
const isFlower = (t) => t >= 34 && t < 42;
const suitOf = (t) => (isSuit(t) ? Math.floor(t / 9) : -1);
const rankOf = (t) => (isSuit(t) ? (t % 9) + 1 : 0);
const isTerminal = (t) => isSuit(t) && (t % 9 === 0 || t % 9 === 8);
const isOrphan = (t) => isTerminal(t) || isHonor(t);
const isValidTile = (t) => Number.isInteger(t) && t >= 0 && t < NUM_KINDS;
const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

function tileName(t) {
  if (isSuit(t)) return `${rankOf(t)} ${SUIT_NAMES[suitOf(t)]}`;
  if (isWind(t)) return `${WIND_NAMES[t - 27]} Wind`;
  if (isDragon(t)) return `${DRAGON_NAMES[t - 31]} Dragon`;
  if (isFlower(t)) return FLOWER_NAMES[t - 34];
  return '?';
}

/** Full 144-tile set: 4 copies of the 34 playing tiles + 8 unique flowers/seasons. */
function buildWall() {
  const w = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < 4; k++) w.push(t);
  for (let t = 34; t < 42; t++) w.push(t);
  return w;
}

/** Fisher-Yates using a CSPRNG (crypto.randomInt) unless an rng(n) is injected for tests. */
function shuffle(arr, randInt = (n) => crypto.randomInt(n)) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sortTiles(tiles) { return tiles.slice().sort((a, b) => a - b); }

/** Seat number (0-3) owning a flower: Plum/Spring=East(0), Orchid/Summer=South(1) ... */
const flowerSeat = (t) => (t - 34) % 4;

module.exports = {
  SUIT_NAMES, WIND_NAMES, DRAGON_NAMES, FLOWER_NAMES, EAST, RED, FIRST_FLOWER, NUM_KINDS, ORPHANS,
  isSuit, isHonor, isWind, isDragon, isFlower, suitOf, rankOf, isTerminal, isOrphan, isValidTile,
  tileName, buildWall, shuffle, sortTiles, flowerSeat,
};
