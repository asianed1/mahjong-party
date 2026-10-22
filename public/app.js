'use strict';
/* Mahjong Party client. All user-provided text is rendered with textContent only. */
(function () {
  const $ = (id) => document.getElementById(id);
  const { makeTile, name: tileName } = window.Tiles;
  const WINDS = ['East', 'South', 'West', 'North'];
  const WIND_CH = ['東', '南', '西', '北'];

  // ------------------------------------------------------------ small DOM helpers
  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function seatBadge(i) { return h('span', `seatnum s${i}`, String(i + 1)); }
  function tilesRow(tiles, size, cls) { const d = h('div', cls || 'tiles'); tiles.forEach((t) => d.appendChild(makeTile(t, { size }))); return d; }
  function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms); }
  function show(id) { ['home', 'lobby', 'game'].forEach((s) => $(s).classList.toggle('hidden', s !== id)); $('chat').classList.toggle('hidden', id === 'home'); }

  // ------------------------------------------------------------ sound (WebAudio blips)
  let soundOn = localStorage.getItem('mj_sound') !== 'off', actx = null;
  function blip(freq = 660, dur = 0.08, type = 'sine', vol = 0.15, delay = 0) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* audio not available */ }
  }
  const SFX = {
    discard: () => blip(420, 0.06, 'triangle', 0.18),
    turn: () => { blip(660, 0.08); blip(880, 0.1, 'sine', 0.15, 0.09); },
    claim: () => { blip(520, 0.08, 'square', 0.08); blip(780, 0.12, 'square', 0.08, 0.08); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.18, 'triangle', 0.2, i * 0.12)),
    chat: () => blip(990, 0.05, 'sine', 0.08),
    popup: () => { blip(700, 0.07, 'square', 0.07); blip(700, 0.07, 'square', 0.07, 0.12); },
  };
  function renderSoundBtn() { $('soundBtn').textContent = soundOn ? '🔊' : '🔇'; }
  $('soundBtn').onclick = () => { soundOn = !soundOn; localStorage.setItem('mj_sound', soundOn ? 'on' : 'off'); renderSoundBtn(); blip(); };
  renderSoundBtn();

  // ------------------------------------------------------------ help overlay
  document.querySelectorAll('.mini[data-tiles]').forEach((m) => m.dataset.tiles.split(',').forEach((t) => m.appendChild(makeTile(Number(t), { size: 'xs' }))));
  const openHelp = () => $('helpPopup').classList.remove('hidden');
  $('helpBtn').onclick = openHelp; $('homeHelp').onclick = openHelp;
  $('helpClose').onclick = () => { $('helpPopup').classList.add('hidden'); localStorage.setItem('mj_seenHelp', '1'); };

  // ------------------------------------------------------------ connection
  let ws = null, session = null, room = null, view = null, selected = null, showHint = false, retry = 0, pendingAction = null;
  try { session = JSON.parse(localStorage.getItem('mj_session') || 'null'); } catch { session = null; }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      if (session && session.code && session.token) send({ t: 'rejoin', code: session.code, token: session.token });
      if (pendingAction) { send(pendingAction); pendingAction = null; }
    };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
    ws.onclose = (ev) => {
      if (ev.code === 4000) { toast('This seat was opened in another tab.', 6000); return; }
      retry++; setTimeout(connect, Math.min(5000, 500 * retry));
      if (room) toast('Connection lost - reconnecting…');
    };
  }
  function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); else pendingAction = msg; }
  setInterval(() => send({ t: 'ping' }), 25000);

  function onMessage(m) {
    switch (m.t) {
      case 'joined':
        session = { code: m.code, token: m.token, seat: m.seat };
        localStorage.setItem('mj_session', JSON.stringify(session));
        history.replaceState(null, '', `?room=${encodeURIComponent(m.code)}`);
        break;
      case 'rejoinFailed':
        session = null; localStorage.removeItem('mj_session'); room = null; view = null; show('home'); break;
      case 'room': room = m; renderRoom(); break;
      case 'state': onState(m.v); break;
      case 'event': onEvent(m.e); break;
      case 'chat': addChat(m.seat, m.label, m.text); if (!session || m.seat !== session.seat) SFX.chat(); break;
      case 'system': addSystem(m.text); break;
      case 'error': toast(m.msg); break;
      case 'left': session = null; localStorage.removeItem('mj_session'); room = null; view = null; $('chatLog').replaceChildren(); history.replaceState(null, '', location.pathname); show('home'); break;
    }
  }

  // ------------------------------------------------------------ home
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (urlRoom) $('codeInput').value = urlRoom;
  $('nameInput').value = localStorage.getItem('mj_name') || '';
  function myName() {
    const n = $('nameInput').value.trim();
    if (!n) { toast('Please type your name first 🙂'); $('nameInput').focus(); return null; }
    localStorage.setItem('mj_name', n); return n;
  }
  $('createBtn').onclick = () => { const n = myName(); if (n) send({ t: 'create', name: n }); };
  $('joinBtn').onclick = () => {
    const n = myName(); if (!n) return;
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 6) return toast('Room codes have 6 characters');
    if (session && session.code !== code) { session = null; localStorage.removeItem('mj_session'); }
    send({ t: 'join', code, name: n });
  };
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

  // ------------------------------------------------------------ lobby
  function seatLabel(i) { return room && room.seats[i] ? room.seats[i].label : `Bot ${i + 1}`; }
  function renderRoom() {
    const isHost = room.you === room.host;
    $('lobbyCode').textContent = room.code;
    $('shareLink').value = `${location.origin}/?room=${room.code}`;
    const list = $('seatList'); list.replaceChildren();
    room.seats.forEach((s, i) => {
      const li = h('li', s.human ? '' : 'bot'); li.appendChild(seatBadge(i));
      li.appendChild(h('span', '', s.human ? s.name : 'Empty - a bot will play'));
      const tags = [];
      if (i === room.host) tags.push('host'); if (i === room.you) tags.push('you');
      if (s.human && !s.connected) tags.push('offline'); if (s.muted) tags.push('muted');
      if (tags.length) li.appendChild(h('span', 'tag', tags.join(' · ')));
      list.appendChild(li);
    });
    $('setMinFaan').checked = room.settings.minFaan === 3; $('setFull').checked = room.settings.rounds === 4; $('setProfanity').checked = room.settings.profanity;
    ['setMinFaan', 'setFull', 'setProfanity'].forEach((id) => { $(id).disabled = !isHost; });
    $('startBtn').classList.toggle('hidden', !isHost);
    $('lobbyNote').textContent = isHost ? 'Share the link or code. Press Start when ready - empty seats become bots.' : 'Waiting for the host to start the game…';
    renderMuteBar();
    if (!room.started) show('lobby');
    else if (view) show('game');
    renderTopInfo();
    if (!localStorage.getItem('mj_seenHelp')) openHelp();
  }
  $('copyBtn').onclick = async () => { try { await navigator.clipboard.writeText($('shareLink').value); toast('Link copied - send it to your friends!'); } catch { $('shareLink').select(); toast('Press Ctrl+C / long-press to copy'); } };
  $('startBtn').onclick = () => send({ t: 'start' });
  $('leaveBtn').onclick = () => { if (confirm('Leave this room?')) send({ t: 'leave' }); };
  $('setMinFaan').onchange = (e) => send({ t: 'settings', minFaan: e.target.checked ? 3 : 0 });
  $('setFull').onchange = (e) => send({ t: 'settings', rounds: e.target.checked ? 4 : 1 });
  $('setProfanity').onchange = (e) => send({ t: 'settings', profanity: e.target.checked });

  function renderMuteBar() {
    const bar = $('muteBar'); bar.replaceChildren();
    if (!room || room.you !== room.host) return;
    room.seats.forEach((s, i) => {
      if (!s.human || i === room.you) return;
      const b = h('button', s.muted ? 'on' : '', `${s.muted ? '🔇 Unmute' : 'Mute'} ${s.label}`);
      b.onclick = () => send({ t: 'mute', seat: i, muted: !s.muted });
      bar.appendChild(b);
    });
  }

  // ------------------------------------------------------------ chat
  function addLine(node) {
    const log = $('chatLog'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(node);
    while (log.children.length > 200) log.removeChild(log.firstChild);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  function addChat(seat, label, text) {
    const row = h('div', 'chat-msg');
    const who = h('span', 'who'); who.appendChild(seatBadge(seat)); who.appendChild(h('span', '', `${label}:`));
    row.appendChild(who); row.appendChild(h('span', 'msg', text));
    addLine(row);
  }
  function addSystem(text) { addLine(h('div', 'chat-msg system', text)); }
  $('chatInput').addEventListener('input', () => { $('chatCount').textContent = `${$('chatInput').value.length}/300`; });
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim(); if (!text) return;
    send({ t: 'chat', text: text.slice(0, 300) }); $('chatInput').value = ''; $('chatCount').textContent = '0/300';
  };

  // ------------------------------------------------------------ game rendering
  function rel(seat) { return ['bottom', 'right', 'top', 'left'][(seat - view.you + 4) % 4]; }
  function pLabel(i) { return view && view.players[i].isBot ? `Bot ${i + 1}` : `${view.players[i].name} ${i + 1}`; }

  function renderTopInfo() {
    const ti = $('topInfo');
    if (view && room && room.started) ti.textContent = `Room ${room.code} · ${WINDS[view.roundWind]} round · Hand ${view.handNo} · ${view.wallCount} tiles left`;
    else if (room) ti.textContent = `Room ${room.code}`;
    else ti.textContent = '';
  }

  function renderSeat(i) {
    const p = view.players[i], box = $(`pos-${rel(i)}`); box.replaceChildren();
    box.classList.toggle('active', !!((view.phase === 'discard' && view.turn === i) || (view.result && view.result.winner === i)));
    const plate = h('div', 'plate');
    plate.appendChild(seatBadge(i));
    plate.appendChild(h('span', 'pname', i === view.you ? `${p.name} (you)` : (p.isBot ? `Bot ${i + 1}` : p.name)));
    plate.appendChild(h('span', 'badge', `${WIND_CH[p.seatWind]} ${WINDS[p.seatWind]}`));
    if (i === view.dealer) plate.appendChild(h('span', 'badge dealer', 'Dealer'));
    if (p.away) plate.appendChild(h('span', 'badge away', 'away · bot playing'));
    plate.appendChild(h('span', 'badge score', `${p.score} pts`));
    box.appendChild(plate);
    const zone = h('div', 'zone');
    if (i !== view.you) { const backs = h('div', 'backs'); for (let k = 0; k < p.handCount; k++) backs.appendChild(makeTile(-1, { size: 'xs' })); zone.appendChild(backs); }
    p.melds.forEach((m) => zone.appendChild(tilesRow(m.tiles, 'sm', 'meld')));
    if (p.flowers.length) zone.appendChild(tilesRow(p.flowers, 'xs', 'meld'));
    box.appendChild(zone);
    const disc = h('div', 'discards');
    p.discards.forEach((t, k) => { const tl = makeTile(t, { size: 'xs' }); if (view.lastDiscard && view.lastDiscard.seat === i && k === p.discards.length - 1) tl.classList.add('latest'); disc.appendChild(tl); });
    box.appendChild(disc);
  }

  let timerAnim = null;
  function runTimer(bar, ms) {
    const total = ms, start = performance.now();
    cancelAnimationFrame(timerAnim);
    const step = () => {
      const left = Math.max(0, total - (performance.now() - start));
      [$('turnTimer'), $('claimTimer')].forEach((b) => { b.style.width = b === bar ? `${(left / Math.max(total, 1)) * 100}%` : '0'; });
      if (left > 0) timerAnim = requestAnimationFrame(step);
    };
    step();
  }

  function onState(v) {
    const prev = view; view = v;
    if (room && !room.started) room.started = true;
    show('game');
    renderTopInfo();
    if (!prev || prev.phase !== v.phase || prev.turn !== v.turn || prev.handNo !== v.handNo) selected = null;
    if (v.actions && v.actions.discard && !(prev && prev.actions && prev.actions.discard)) SFX.turn();
    if (v.actions && v.actions.claim && !(prev && prev.actions && prev.actions.claim)) SFX.popup();
    [0, 1, 2, 3].forEach(renderSeat);
    renderCenter(); renderMe(); renderClaim(); renderResult();
  }

  function renderCenter() {
    const c = $('centerInfo'); c.replaceChildren();
    const turnName = view.phase === 'discard' ? (view.turn === view.you ? 'Your turn' : `${pLabel(view.turn)}'s turn`) : view.phase === 'claim' ? 'Waiting for claims…' : view.phase === 'gameOver' ? 'Game over' : 'Hand over';
    c.appendChild(h('div', '', `${WIND_CH[view.roundWind]} ${WINDS[view.roundWind]} round · ${view.wallCount} tiles left`));
    c.appendChild(h('div', '', turnName));
    const ld = $('lastDiscard'); ld.replaceChildren();
    const t = view.actions && view.actions.claimTile != null ? view.actions.claimTile : view.lastDiscard ? view.lastDiscard.tile : null;
    if (t != null && view.lastDiscard) { ld.appendChild(makeTile(t, { size: 'lg' })); ld.appendChild(h('span', 'small', `from ${pLabel(view.lastDiscard.seat)}`)); }
  }

  function renderMe() {
    const me = view.players[view.you], a = view.actions || {}, hand = $('hand');
    hand.replaceChildren();
    hand.classList.toggle('disabled', !a.discard);
    // hand: sorted, with the freshly drawn tile pulled out to the right
    const tiles = view.hand.slice();
    let drawnIdx = -1;
    if (view.drawn != null) { drawnIdx = tiles.lastIndexOf(view.drawn); if (drawnIdx >= 0) tiles.splice(drawnIdx, 1); }
    const ordered = tiles.map((t) => ({ t, drawn: false }));
    if (drawnIdx >= 0) ordered.push({ t: view.drawn, drawn: true });
    const hintTile = showHint && view.hint && view.hint.discard != null ? view.hint.discard : null;
    let hintDone = false;
    ordered.forEach((o, k) => {
      const el = makeTile(o.t, { size: 'lg' });
      if (o.drawn) el.classList.add('drawn');
      if (selected === k) el.classList.add('selected');
      if (hintTile === o.t && !hintDone && (o.drawn || ordered.findIndex((x) => x.t === hintTile) === k)) { el.classList.add('hint'); hintDone = true; }
      el.tabIndex = 0;
      const pick = () => {
        if (!a.discard) { toast('Wait for your turn 🙂', 1200); return; }
        if (selected === k) { send({ t: 'act', a: 'discard', tile: o.t }); selected = null; SFX.discard(); }
        else { selected = k; renderMe(); }
      };
      el.onclick = pick; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
      hand.appendChild(el);
    });
    // my melds + flowers
    if (me.melds.length || me.flowers.length) {
      const mm = h('div', 'my-melds');
      me.melds.forEach((m) => mm.appendChild(tilesRow(m.tiles, 'md', 'meld')));
      if (me.flowers.length) mm.appendChild(tilesRow(me.flowers, 'sm', 'meld'));
      hand.after(mm); if (renderMe.mm) renderMe.mm.remove(); renderMe.mm = mm;
    } else if (renderMe.mm) { renderMe.mm.remove(); renderMe.mm = null; }

    // status line
    const st = $('status'); st.replaceChildren();
    let msg;
    if (view.phase === 'discard' && a.discard) msg = selected != null ? 'Tap the raised tile again to discard it' : 'Your turn - tap a tile to pick, tap again to discard';
    else if (view.phase === 'discard') msg = `${pLabel(view.turn)} is thinking…`;
    else if (view.phase === 'claim') msg = a.claim ? 'You can grab that tile!' : 'Waiting for other players…';
    else msg = view.phase === 'gameOver' ? 'Game over' : 'Hand finished';
    st.appendChild(h('span', '', msg));
    if (view.hint && view.hint.ready) st.appendChild(h('span', 'ready', 'Ready! 1 tile from winning'));

    // action buttons
    const act = $('actions'); act.replaceChildren();
    if (a.selfWin) { const b = h('button', 'big-btn win', 'WIN! 🎉'); b.onclick = () => send({ t: 'act', a: 'selfWin' }); act.appendChild(b); }
    (a.kongs || []).forEach((t) => { const b = h('button', 'big-btn primary', `Kong ${tileName(t)}`); b.onclick = () => send({ t: 'act', a: 'kong', tile: t }); act.appendChild(b); });
    if (view.result) { const rb = h('button', 'big-btn small primary', '📋 Show result'); rb.onclick = () => $('resultPopup').classList.remove('hidden'); act.appendChild(rb); }
    const hb = h('button', 'big-btn small', showHint ? '💡 Hide hint' : '💡 Hint');
    hb.onclick = () => { showHint = !showHint; renderMe(); };
    act.appendChild(hb);
    if (showHint && view.hint) {
      const parts = [];
      if (view.hint.discard != null) parts.push(`Suggested discard: ${tileName(view.hint.discard)}.`);
      if (view.hint.ready) parts.push(`Waiting on: ${view.hint.waits.map(tileName).join(', ') || '—'}`);
      else parts.push(`${view.hint.shanten} tile change${view.hint.shanten === 1 ? '' : 's'} away from Ready.`);
      act.appendChild(h('div', 'hint-text', parts.join(' ')));
    }
    if (view.phase === 'discard' && a.discard && view.remainingMs != null) runTimer($('turnTimer'), view.remainingMs);
    else if (!(view.phase === 'claim' && a.claim)) runTimer($('turnTimer'), 0);
  }

  function renderClaim() {
    const a = view.actions || {}, pop = $('claimPopup');
    if (!a.claim) { pop.classList.add('hidden'); return; }
    pop.classList.remove('hidden');
    $('claimTitle').textContent = `${pLabel(view.lastDiscard.seat)} threw ${tileName(a.claimTile)}`;
    $('claimTile').replaceChildren(makeTile(a.claimTile, { size: 'lg' }));
    const box = $('claimButtons'); box.replaceChildren();
    const btn = (label, cls, msg, tiles) => {
      const b = h('button', `big-btn ${cls}`); b.appendChild(h('span', '', label));
      if (tiles) b.appendChild(tilesRow(tiles, 'xs', 'mini'));
      b.onclick = () => { send(Object.assign({ t: 'act', a: 'claim' }, msg)); pop.classList.add('hidden'); if (msg.claim !== 'pass') SFX.claim(); };
      box.appendChild(b);
    };
    if (a.claim.win) btn('WIN! 🎉', 'win', { claim: 'win' });
    if (a.claim.kong) btn('KONG', 'kong', { claim: 'kong' }, [a.claimTile, a.claimTile, a.claimTile, a.claimTile]);
    if (a.claim.pung) btn('PUNG', 'pung', { claim: 'pung' }, [a.claimTile, a.claimTile, a.claimTile]);
    (a.claim.chows || []).forEach((s) => btn('CHOW', 'chow', { claim: 'chow', chow: s }, [s, s + 1, s + 2]));
    btn('Pass', 'pass', { claim: 'pass' });
    if (view.remainingMs != null) runTimer($('claimTimer'), view.remainingMs);
  }

  let resultShownFor = null;
  function renderResult() {
    const pop = $('resultPopup'), r = view.result;
    if (!r || (view.phase !== 'handOver' && view.phase !== 'gameOver')) { pop.classList.add('hidden'); resultShownFor = null; return; }
    pop.classList.remove('hidden');
    const card = $('resultCard'); card.replaceChildren();
    if (resultShownFor !== r.handNo) { resultShownFor = r.handNo; if (r.winner != null) SFX.win(); }
    if (r.winner != null) {
      card.appendChild(h('div', 'result-head', `${r.winner === view.you ? '🎉 You win' : `${pLabel(r.winner)} wins`}${r.selfDrawn ? ' by self-draw!' : ` on ${pLabel(r.from)}'s discard!`}`));
      const hd = r.hands[r.winner], rh = h('div', 'result-hand');
      hd.melds.forEach((m) => rh.appendChild(tilesRow(m.tiles, 'sm', 'meld')));
      rh.appendChild(tilesRow(hd.hand, 'sm'));
      if (hd.flowers.length) rh.appendChild(tilesRow(hd.flowers, 'xs', 'meld'));
      card.appendChild(rh);
      card.appendChild(h('div', '', `${r.faan} faan${r.form === 'sevenPairs' ? ' · Seven Pairs' : r.form === 'thirteenOrphans' ? ' · Thirteen Orphans' : ''}`));
      const ul = h('ul', 'faan-list');
      if (!r.items.length) ul.appendChild(h('li', '', 'Chicken hand (no bonuses) - still a win!'));
      r.items.forEach((it) => ul.appendChild(h('li', '', `${it.name}: ${it.faan}`)));
      card.appendChild(ul);
    } else card.appendChild(h('div', 'result-head', '🤝 Draw game - wall exhausted. Dealer stays.'));
    const tbl = h('table', 'pay-table');
    const order = view.phase === 'gameOver' ? [0, 1, 2, 3].sort((x, y) => r.scores[y] - r.scores[x]) : [0, 1, 2, 3];
    order.forEach((i, rank) => {
      const tr = h('tr'); const td1 = h('td'); td1.appendChild(seatBadge(i)); td1.appendChild(document.createTextNode(` ${view.phase === 'gameOver' ? ['🥇', '🥈', '🥉', '4th'][rank] + ' ' : ''}${pLabel(i)}`));
      const pay = r.payments[i]; const td2 = h('td', pay > 0 ? 'plus' : pay < 0 ? 'minus' : '', pay ? (pay > 0 ? `+${pay}` : String(pay)) : '–');
      tr.append(td1, td2, h('td', '', `${r.scores[i]} pts`)); tbl.appendChild(tr);
    });
    card.appendChild(tbl);
    const row = h('div', 'row');
    if (view.phase === 'gameOver') {
      card.prepend(h('div', 'result-head', '🏁 Game over!'));
      if (room && room.you === room.host) { const b = h('button', 'big-btn primary', 'Play again'); b.onclick = () => send({ t: 'start' }); row.appendChild(b); }
      else row.appendChild(h('span', 'muted', 'The host can start a new game.'));
    } else if (view.actions && view.actions.next) {
      const b = h('button', 'big-btn primary', `Next hand ▶ (auto in ${Math.round((view.remainingMs || 0) / 1000)}s)`); b.onclick = () => send({ t: 'act', a: 'next' }); row.appendChild(b);
    } else row.appendChild(h('span', 'muted', 'Waiting for the others…'));
    const hide = h('button', 'big-btn ghost', 'View table'); hide.onclick = () => pop.classList.add('hidden'); row.appendChild(hide);
    card.appendChild(row);
  }

  function onEvent(e) {
    $('ticker').textContent = e.seat != null && view ? e.text.replace(view.players[e.seat].name, pLabel(e.seat)) : e.text;
    if (e.kind === 'discard' && (!session || e.seat !== session.seat)) SFX.discard();
    if (['pung', 'kong', 'chow'].includes(e.kind)) SFX.claim();
  }

  // ------------------------------------------------------------ boot
  if (session && urlRoom && session.code !== urlRoom) { session = null; localStorage.removeItem('mj_session'); }
  show('home');
  connect();
})();
