'use strict';
// Simple, fast heuristic AI: always wins when possible, minimises shanten, likes honour pungs.
const T = require('./tiles');
const R = require('./rules');

function chooseTurn(game, seat) {
  const p = game.players[seat];
  if (game.canSelfWin(seat)) return { a: 'selfWin' };
  const kongs = game.kongOptions(seat);
  if (kongs.length) return { a: 'kong', tile: kongs[0] };
  const sug = R.suggestDiscard(p.hand, p.melds, { seatWind: game.seatWind(seat), roundWind: game.roundWind });
  return { a: 'discard', tile: sug ? sug.tile : p.hand[p.hand.length - 1] };
}

function improves(p, removeTiles, meldsAfter) {
  const before = R.shanten(p.hand, p.melds.length);
  const rest = p.hand.slice();
  for (const t of removeTiles) rest.splice(rest.indexOf(t), 1);
  const sug = R.suggestDiscard(rest, meldsAfter);
  return sug && sug.shanten < before;
}

function chooseClaim(game, seat) {
  const o = game.claim.options[seat], tile = game.claim.tile, p = game.players[seat];
  if (o.win) return { type: 'win' };
  const valuable = T.isDragon(tile) || tile === T.EAST + game.seatWind(seat) || tile === T.EAST + game.roundWind;
  const fake = (type, tiles) => p.melds.concat({ type, tiles });
  if (o.kong && (valuable || improves(p, [tile, tile, tile], fake('kong', [tile, tile, tile, tile])))) return { type: 'kong' };
  if (o.pung && (valuable || improves(p, [tile, tile], fake('pung', [tile, tile, tile])))) return { type: 'pung' };
  if (o.chows) {
    for (const st of o.chows) {
      const seq = [st, st + 1, st + 2], others = seq.filter((t) => t !== tile);
      if (improves(p, others, fake('chow', seq))) return { type: 'chow', chow: st };
    }
  }
  return { type: 'pass' };
}

module.exports = { chooseTurn, chooseClaim };
