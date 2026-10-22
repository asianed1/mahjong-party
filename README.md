# Mahjong Party 🀄

A simple, friendly **online 4-player Hong Kong mahjong** game with private rooms, AI bots for empty seats,
and a secure room-only text chat. Node.js server (Express + `ws`) and a dependency-free single-page frontend.

```
mahjong/
├── server/
│   ├── index.js    HTTP + WebSocket server, security headers, origin check, per-IP limits
│   ├── rooms.js    rooms, seats, session tokens, payload validation, chat, host actions
│   ├── game.js     server-authoritative game state machine (wall, turns, claims, scoring, dealer rotation)
│   ├── rules.js    win checker, faan scoring, claim priority, shanten/hint/ready logic
│   ├── bot.js      simple AI
│   ├── chat.js     text cleaning, profanity filter, rate limiter
│   └── tiles.js    tile set, CSPRNG shuffle, names
├── public/         index.html, style.css, tiles.js (SVG tile renderer), app.js (client)
├── test/           node:test unit tests + 4-bot headless simulation
└── scripts/        smoke.js (2 socket clients), tunnel.sh (cloudflared quick tunnel)
```

## Run it

Needs Node.js 18+ (tested on Node 20).

```bash
npm install
npm start                 # http://localhost:3000   (PORT=8080 npm start to change)
npm test                  # unit tests + headless 4-bot simulation
npm run smoke             # with the server running: 2 socket clients join a room and chat
scripts/tunnel.sh         # optional: public https://….trycloudflare.com link (needs cloudflared + outbound port 7844)
```

Open the page, type your name, **Create a private room**, and share the 6-character code or the link
(`https://host/?room=ABC123`). Friends type their name and join. The host presses **Start**; any empty seats are
filled by bots (labelled "Bot 3", "Bot 4"…). If you refresh or lose connection you rejoin your seat automatically
(a session token is kept in `localStorage`); while you're away a bot plays your seat for you.
Late joiners take over a bot seat.

## Rules summary (simplified Hong Kong / Cantonese)

* 144 tiles: Characters, Dots, Bamboo (1-9 ×4), Winds ×4, Dragons ×4, 4 Flowers + 4 Seasons.
* Dealer starts with 14 tiles, others 13. Flowers are set aside automatically and replaced from the back of the wall.
* On your turn you draw, then discard. A discard may be claimed:
  **Win** > **Pung / Kong** > **Chow** (chow only by the next player). Several winners → the first player after the
  discarder wins ("head bump"). After a pung/chow you discard; after a kong you draw a replacement tile.
* On your own turn you may declare a concealed kong or add to an exposed pung.
* Winning hands: 4 sets + 1 pair, **Seven Pairs** (7 different pairs), **Thirteen Orphans**.
* Faan: self-drawn 1 · concealed hand 1 · all chows 1 · dragon pung 1 each · seat-wind pung 1 · round-wind pung 1 ·
  no flowers 1 · own flower 1 each · all 4 flowers / seasons 2 · win on last tile 1 · win on kong replacement 1 ·
  all pungs 3 · half flush 3 · small three dragons 5 · full flush 7 · great three dragons 8 · seven pairs 4 ·
  all honors 10 · small four winds 10 · great four winds 13 · thirteen orphans 13. Max (limit) 13.
* **3-faan minimum** is a host toggle, off by default (0-faan "chicken hands" may win).
* Points: base = 2^faan (capped at 256). Self-draw: every other player pays base. Discard win: the discarder pays 2×base.
  Everyone starts with 1000 points.
* Dealer keeps the deal after a dealer win or a draw (wall exhausted); otherwise it passes to the right.
  The round wind advances when the deal returns to seat 1. Default game = East round only; "Full game" = 4 wind rounds
  (with a safety cap on the number of hands).

## Architecture

* **Server-authoritative.** The server shuffles with `crypto.randomInt` (Fisher-Yates), keeps the wall and every hand,
  validates every move (turn, phase, tile ownership, claim legality), runs timers and bots. Each client receives
  `viewFor(seat)`: its own hand only, opponents' tile counts, public melds/discards/flowers (concealed kongs hidden).
* **Transport:** one WebSocket per tab at `/ws`, JSON messages. Client → server: `create`, `join`, `rejoin`, `start`,
  `settings`, `act` (`discard` / `selfWin` / `kong` / `claim` / `next`), `chat`, `mute`, `leave`, `ping`.
  Server → client: `joined`, `room`, `state`, `event`, `chat`, `system`, `error`.
* **Timers:** 30 s per turn and 12 s per claim window for humans (then a bot move / pass is made for them),
  20 s between hands (or as soon as all humans press Next).
* **Hint / Ready:** the server computes shanten (tiles away from ready) and suggests the discard that minimises it;
  when ready it lists the winning tiles.
* State lives in memory only. Restarting the server ends all games.

## Security notes

* **Encryption in transit comes from HTTPS/WSS.** The app itself speaks plain HTTP/WS; deploy it behind TLS
  (Render/Fly/Railway/Cloudflare do this automatically). The client uses `wss://` automatically on an `https://` page.
* Chat is **room-scoped**, broadcast only to that room's seats, and **never stored** (not in memory history, not on disk,
  not in logs).
* All user text (names, chat) is rendered with `textContent` — the client never uses `innerHTML`. A strict
  Content-Security-Policy (`default-src 'self'`, no inline scripts) is set by **helmet** as a second layer, plus
  `X-Content-Type-Options`, `frame-ancestors 'none'`, Referrer-Policy, etc.
* Chat: 1-300 characters, control/bidi characters stripped, **5 messages per 5 s** per seat, optional profanity filter
  (host toggle, on by default), host can **mute** a player.
* Every WebSocket payload is size-limited (4 KB), JSON-parsed safely, checked against a per-type whitelist of fields
  and types; unknown fields are rejected. A general limit of 30 messages / 3 s per socket applies.
* Identity: joining issues a random 192-bit **seat token**. Every in-room message re-checks that the socket is bound to
  a seat whose token still matches (constant-time comparison); the sender's seat/name are always taken from the
  server, never from the payload. Opening the same seat in a second tab disconnects the first.
* WebSocket upgrades with a foreign `Origin` are refused (cross-site WebSocket hijacking). Per-IP limits:
  10 room creations/minute, 20 concurrent sockets. Idle rooms are deleted after 30 minutes.

## Deploying permanently

Any Node host works — it's a single process with no database.

* **Render**: New → Web Service → connect the repo, Build `npm install`, Start `npm start`. Render sets `PORT` and gives
  you HTTPS. (Free instances sleep when idle, which ends games in progress.)
* **Fly.io**: `fly launch` (Node detected) → `fly deploy`. Set `internal_port = 3000` in `fly.toml`; keep
  `min_machines_running = 1` and **run a single machine** (rooms are in memory).
* **Railway**: New project from GitHub → it runs `npm start`; add a generated domain.
* WebSockets work out of the box on all three. Because state is in memory, run **one instance**; to scale out you'd need
  sticky sessions or a shared store (e.g. Redis) — see next steps.

## Known limitations

* Robbing the kong, the "flower-win" (7/8 flowers) and some regional special hands are not implemented.
* Seven Pairs requires seven *different* pairs. Scoring is a simplified HK table (see above), not a full official one.
* Concealed / added kongs can only be declared right after drawing (not after a pung).
* Bots are simple (shanten-minimising, no defence).
* No spectators, accounts or persistence; a server restart ends games.

## Next steps

* Robbing the kong, a payment-style option (half-shooter / full-shooter), dealer-bonus scoring.
* Smarter bots with defensive play; difficulty levels.
* Persist rooms in Redis to survive restarts / scale horizontally.
* Emoji reactions, tile-click sound themes, larger-text accessibility mode, PWA install.
