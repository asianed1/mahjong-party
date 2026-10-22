'use strict';
/* Tile renderer: pure SVG built with createElementNS (no images, no innerHTML). */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const WIND = ['東', '南', '西', '北'], WIND_L = ['E', 'S', 'W', 'N'];
  const FLOWER = ['梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬'];
  const SUIT = ['Characters', 'Dots', 'Bamboo'];
  const PIPS = {
    1: [[30, 40]], 2: [[30, 22], [30, 58]], 3: [[16, 18], [30, 40], [44, 62]],
    4: [[18, 22], [42, 22], [18, 58], [42, 58]], 5: [[17, 18], [43, 18], [30, 40], [17, 62], [43, 62]],
    6: [[18, 16], [42, 16], [18, 40], [42, 40], [18, 64], [42, 64]],
    7: [[14, 12], [30, 20], [46, 28], [18, 46], [42, 46], [18, 66], [42, 66]],
    8: [[18, 12], [42, 12], [18, 30], [42, 30], [18, 50], [42, 50], [18, 68], [42, 68]],
    9: [[14, 16], [30, 16], [46, 16], [14, 40], [30, 40], [46, 40], [14, 64], [30, 64], [46, 64]],
  };
  const PIP_COL = ['#1f5fbf', '#1e8a4c', '#d23a2f'];

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(svg, str, x, y, size, color, weight = 700) {
    const t = el('text', { x, y, 'font-size': size, fill: color, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-weight': weight, 'font-family': '"Noto Sans CJK SC","Noto Sans SC","PingFang SC","Microsoft YaHei","Hiragino Sans",sans-serif' }, svg);
    t.textContent = str; return t;
  }

  function name(t) {
    if (t < 0) return 'Hidden tile';
    if (t < 27) return `${t % 9 + 1} ${SUIT[Math.floor(t / 9)]}`;
    if (t < 31) return `${['East', 'South', 'West', 'North'][t - 27]} Wind`;
    if (t < 34) return `${['Red', 'Green', 'White'][t - 31]} Dragon`;
    return ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo', 'Spring', 'Summer', 'Autumn', 'Winter'][t - 34];
  }
  function short(t) {
    if (t < 27) return `${t % 9 + 1}${['C', 'D', 'B'][Math.floor(t / 9)]}`;
    return name(t);
  }

  function face(svg, t) {
    if (t < 9) { // characters
      text(svg, NUM[t], 30, 27, 30, '#1b2a6b', 800);
      text(svg, '萬', 30, 58, 28, '#c62828', 800);
    } else if (t < 27) {
      const dots = t < 18, n = (t % 9) + 1;
      PIPS[n].forEach(([x, y], i) => {
        if (dots) {
          const r = n === 1 ? 17 : n <= 4 ? 10 : n <= 6 ? 8.5 : 7.5;
          const c = n === 1 ? '#c62828' : PIP_COL[(i + (n === 5 && i === 2 ? 2 : 0)) % 3];
          el('circle', { cx: x, cy: y, r, fill: '#fff', stroke: c, 'stroke-width': n === 1 ? 4 : 3 }, svg);
          el('circle', { cx: x, cy: y, r: r * 0.45, fill: c }, svg);
        } else {
          const h = n === 1 ? 44 : n <= 4 ? 26 : n <= 6 ? 20 : 15, w = n === 1 ? 12 : 8;
          const c = n === 1 ? '#1e8a4c' : (i % 3 === 2 && n > 4) ? '#c62828' : (i % 2 ? '#1f5fbf' : '#1e8a4c');
          el('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 3, fill: c }, svg);
          el('line', { x1: x - w / 2, x2: x + w / 2, y1: y, y2: y, stroke: '#fff', 'stroke-width': 1.5 }, svg);
          if (n === 1) el('circle', { cx: x, cy: y - 26, r: 5, fill: '#c62828' }, svg);
        }
      });
    } else if (t < 31) {
      text(svg, WIND[t - 27], 30, 42, 36, '#1b2a6b', 800);
    } else if (t === 31) text(svg, '中', 30, 42, 38, '#c62828', 900);
    else if (t === 32) text(svg, '發', 30, 42, 36, '#1e8a4c', 900);
    else if (t === 33) { el('rect', { x: 12, y: 14, width: 36, height: 52, rx: 4, fill: 'none', stroke: '#1f5fbf', 'stroke-width': 4 }, svg); el('rect', { x: 19, y: 21, width: 22, height: 38, rx: 2, fill: 'none', stroke: '#1f5fbf', 'stroke-width': 2 }, svg); }
    else {
      const i = t - 34, c = i < 4 ? '#c2185b' : '#ef6c00';
      el('circle', { cx: 30, cy: 38, r: 20, fill: i < 4 ? '#fde4ef' : '#fff1de' }, svg);
      text(svg, FLOWER[i], 30, 39, 28, c, 800);
    }
  }

  function corner(svg, t) {
    let s = null, col = '#555';
    if (t < 27) { s = String(t % 9 + 1); col = ['#c62828', '#1f5fbf', '#1e8a4c'][Math.floor(t / 9)]; }
    else if (t < 31) s = WIND_L[t - 27];
    else if (t >= 34) s = String((t - 34) % 4 + 1);
    if (s) text(svg, s, 8, 9, 12, col, 800);
  }

  /** Create a tile element. opts: {size:'lg'|'md'|'sm'|'xs', title} */
  function makeTile(t, opts = {}) {
    const d = document.createElement('div');
    d.className = `tile ${opts.size || 'md'}${t < 0 ? ' back' : ''}`;
    d.dataset.tile = t;
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', name(t));
    d.title = name(t);
    if (t >= 0) {
      const svg = el('svg', { viewBox: '0 0 60 80', 'aria-hidden': 'true' });
      face(svg, t); corner(svg, t);
      d.appendChild(svg);
    }
    return d;
  }
  window.Tiles = { makeTile, name, short };
})();
