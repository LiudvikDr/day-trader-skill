/* UI: state, rendering, gallery, statistics. Depends on Geo and Patterns. */
(function () {
  'use strict';

  const P = window.Patterns;
  const Geo = window.Geo;

  const FINISHES = {
    tile: [
      { name: 'Carrara', c: '#ecebe6', joint: '#c4bfb5', alt: '#34373b' },
      { name: 'Terracotta', c: '#c4673f', joint: '#e6d8c4', alt: '#efe6d6' },
      { name: 'Sage', c: '#9fb08b', joint: '#ebe6da', alt: '#f1eee6' },
      { name: 'Charcoal', c: '#3e4044', joint: '#8d8f92', alt: '#e7e5df' },
      { name: 'Sand', c: '#d8c4a2', joint: '#f2ebdf', alt: '#7b6a52' },
      { name: 'Ocean', c: '#3f6f8d', joint: '#e3e9ed', alt: '#f3f1ea' },
    ],
    wood: [
      { name: 'Natural oak', c: '#c9a26b', joint: '#8d6c45' },
      { name: 'White ash', c: '#e3d0ae', joint: '#b29d7a' },
      { name: 'Smoked oak', c: '#8b6a4a', joint: '#5a432e' },
      { name: 'Walnut', c: '#6b4a33', joint: '#3f2b1d' },
      { name: 'Grey wash', c: '#a59e92', joint: '#766f64' },
    ],
  };

  const PRESETS = {
    tile: { cm: [[30, 30], [60, 60], [60, 30], [120, 60], [15, 7.5], [30, 10]], in: [[12, 12], [24, 24], [24, 12], [48, 24], [6, 3], [12, 4]] },
    wood: { cm: [[120, 18], [180, 20], [220, 22], [90, 15], [60, 10]], in: [[48, 7], [72, 8], [86, 9], [36, 6], [24, 4]] },
  };

  const DEFAULTS = {
    units: 'cm', shape: 'rect', roomW: 450, roomL: 380, notchW: 180, notchL: 150,
    custom: '0, 0\n520, 0\n520, 300\n380, 420\n0, 420',
    material: 'wood',
    tile: { L: 60, W: 30, gap: 0.3, finish: 0 },
    wood: { L: 120, W: 18, gap: 0, finish: 0 },
    perBox: '', price: '',
    pattern: 'herringbone', rotation: 0, shiftU: 0, shiftV: 0, seed: 1,
    showCuts: true, showDims: true, spare: 'auto',
  };

  let state = loadState();
  let current = null;      // last layout of the selected pattern
  let hover = -1;          // hovered piece index
  let room = null;         // { poly, error }

  // ---------- state & persistence ----------

  function loadState() {
    const s = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const h = decodeURIComponent(location.hash.slice(1));
      if (h) {
        const saved = JSON.parse(h);
        for (const k of Object.keys(s)) {
          if (!(k in saved)) continue;
          if (typeof s[k] === 'object') Object.assign(s[k], saved[k]);
          else s[k] = saved[k];
        }
      }
    } catch (e) { /* ignore malformed links */ }
    return s;
  }

  let saveTimer = 0;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(state)));
    }, 250);
  }

  const mat = () => state[state.material];
  const pattern = () => P.byId[state.pattern];

  // ---------- room ----------

  function buildRoom() {
    const n = (v) => Math.max(0, parseFloat(v) || 0);
    if (state.shape === 'rect') {
      const w = n(state.roomW), l = n(state.roomL);
      if (!w || !l) return { error: 'Enter the room width and length.' };
      return { poly: Geo.rect(0, 0, w, l) };
    }
    if (state.shape === 'l') {
      const w = n(state.roomW), l = n(state.roomL), cw = n(state.notchW), cl = n(state.notchL);
      if (!w || !l) return { error: 'Enter the room width and length.' };
      if (cw >= w || cl >= l || !cw || !cl) return { error: 'The notch must be smaller than the room.' };
      return { poly: [[0, 0], [w, 0], [w, l - cl], [w - cw, l - cl], [w - cw, l], [0, l]] };
    }
    const pts = state.custom.split(/\n|;/).map((line) => line.trim()).filter(Boolean)
      .map((line) => line.split(/[\s,]+/).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite))
      .map((p) => [p[0], p[1]]);
    if (pts.length < 3) return { error: 'Add at least three corners.' };
    if (Geo.area(pts) < 1) return { error: 'Those corners enclose no area.' };
    if (Geo.selfIntersects(pts)) return { error: 'Walls cross each other — list corners in order around the room.' };
    return { poly: pts };
  }

  // ---------- formatting ----------

  const round = (v, step) => Math.round(v / step) * step;
  function fmtLen(v, precise) {
    if (state.units === 'cm') {
      if (!precise && v >= 100) return (v / 100).toFixed(2) + ' m';
      return +round(v, 0.1).toFixed(1) + ' cm';
    }
    if (!precise && v >= 12) {
      const ft = Math.floor(v / 12), inch = round(v - ft * 12, 0.25);
      return inch >= 12 ? `${ft + 1}′` : `${ft}′ ${+inch.toFixed(2)}″`;
    }
    return +round(v, 0.125).toFixed(3) + '″';
  }
  const areaUnit = () => (state.units === 'cm' ? 'm²' : 'ft²');
  const toAreaUnit = (a) => (state.units === 'cm' ? a / 1e4 : a / 144);
  const fmtArea = (a) => toAreaUnit(a).toFixed(toAreaUnit(a) < 10 ? 2 : 1) + ' ' + areaUnit();
  const nounFor = (n) => (state.material === 'tile' ? (n === 1 ? 'tile' : 'tiles') : (n === 1 ? 'board' : 'boards'));

  // ---------- colours ----------

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function shade(hex, t) { // t in [-1, 1]: towards black / white
    const [r, g, b] = hexToRgb(hex), f = t < 0 ? 0 : 255, k = Math.abs(t);
    return `rgb(${Math.round(r + (f - r) * k)},${Math.round(g + (f - g) * k)},${Math.round(b + (f - b) * k)})`;
  }
  function hash3(i, j, k, seed) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- drawing ----------

  function draw(canvas, res, poly, o) {
    const cssW = o.width || canvas.clientWidth, cssH = o.height || canvas.clientHeight;
    const dpr = o.dpr || window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }

    const bb = Geo.bbox(poly), pad = o.pad ?? (o.thumb ? 10 : 56);
    const s = Math.min((cssW - 2 * pad) / bb.w, (cssH - 2 * pad) / bb.h);
    const ox = (cssW - bb.w * s) / 2 - bb.minX * s + (o.offsetX || 0);
    const oy = (cssH - bb.h * s) / 2 - bb.minY * s + (o.offsetY || 0);
    const view = { s, ox, oy };
    const worldTx = () => ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    const path = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };

    const finish = FINISHES[state.material][mat().finish] || FINISHES[state.material][0];
    const wood = state.material === 'wood';
    const twoTone = !!pattern().twoTone;

    // joints show through the gaps between pieces
    worldTx();
    path(poly);
    ctx.fillStyle = finish.joint;
    ctx.fill();

    if (res) {
      const tf = res.transform;
      worldTx();
      ctx.translate(tf.c[0], tf.c[1]);
      ctx.rotate(tf.theta);
      ctx.translate(tf.d[0], tf.d[1]);
      const px = 1 / s;
      res.pieces.forEach((p, idx) => {
        const r = hash3(p.i, p.j, p.k, state.seed);
        let base = finish.c;
        if (twoTone && ((p.i + p.j) % 2 + 2) % 2 === 1) base = finish.alt;
        path(p.poly);
        ctx.fillStyle = shade(base, (r - 0.5) * (wood ? 0.22 : 0.05));
        ctx.fill();

        if (wood && !o.thumb) { drawGrain(ctx, p, r, px, path); path(p.poly); }

        if (res.gap === 0) {
          ctx.lineWidth = px * (o.thumb ? 0.6 : 1);
          ctx.strokeStyle = wood ? 'rgba(40,25,10,.35)' : 'rgba(0,0,0,.22)';
          ctx.stroke();
        }
        if (o.showCuts && !p.full) {
          path(p.poly);
          ctx.fillStyle = p.sliver ? 'rgba(210,65,47,.5)' : 'rgba(232,163,61,.32)';
          ctx.fill();
          ctx.lineWidth = px;
          ctx.strokeStyle = p.sliver ? 'rgba(160,40,25,.7)' : 'rgba(170,105,20,.55)';
          ctx.stroke();
        }
        if (idx === o.hover) {
          path(p.poly);
          ctx.lineWidth = px * 2.5;
          ctx.strokeStyle = cssVar('--accent') || '#b5562f';
          ctx.stroke();
        }
      });
    }

    // walls
    worldTx();
    path(poly);
    ctx.lineJoin = 'round';
    ctx.lineWidth = (o.thumb ? 1.5 : 3) / s;
    ctx.strokeStyle = o.ink || cssVar('--ink') || '#222';
    ctx.stroke();

    if (o.showDims && !o.thumb) drawDims(ctx, poly, view, dpr, o.ink || cssVar('--ink'), o.paper || cssVar('--plan-bg'));
    return view;
  }

  function drawGrain(ctx, p, r, px, path) {
    ctx.save();
    path(p.poly);
    ctx.clip();
    const cx = p.outline.reduce((a, q) => a + q[0], 0) / p.outline.length;
    const cy = p.outline.reduce((a, q) => a + q[1], 0) / p.outline.length;
    ctx.translate(cx, cy);
    ctx.rotate(p.ang);
    ctx.lineWidth = px * 0.8;
    ctx.strokeStyle = 'rgba(60,35,15,.13)';
    const lines = 4, half = p.L / 2 + p.W;
    for (let k = 0; k < lines; k++) {
      const v = ((k + 0.5) / lines - 0.5) * p.W + (hash3(k, p.i, p.j, 9) - 0.5) * p.W * 0.2;
      const wobble = (r - 0.5) * p.W * 0.3;
      ctx.beginPath();
      ctx.moveTo(-half, v);
      ctx.bezierCurveTo(-half / 3, v + wobble, half / 3, v - wobble, half, v);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDims(ctx, poly, view, dpr, ink, paper) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len * view.s < 40) continue;
      let nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (Geo.pointInPolygon([mx + nx * 1e-3 * len, my + ny * 1e-3 * len], poly)) { nx = -nx; ny = -ny; }
      const X = view.ox + mx * view.s + nx * 22, Y = view.oy + my * view.s + ny * 22;
      const text = fmtLen(len);
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = paper;
      ctx.fillRect(X - w / 2, Y - 10, w, 20);
      ctx.fillStyle = ink;
      ctx.fillText(text, X, Y);
    }
  }

  // ---------- computations ----------

  function layoutOpts(extra) {
    const m = mat();
    return {
      L: Math.max(0.5, +m.L || 0), W: Math.max(0.5, +m.W || 0), gap: Math.max(0, +m.gap || 0),
      rotation: +state.rotation || 0, shift: [+state.shiftU || 0, +state.shiftV || 0], seed: state.seed,
      ...extra,
    };
  }

  function quantities(res, pat) {
    const st = res.stats;
    const spare = state.spare === 'auto' ? (state.material === 'tile' ? 0.05 : pat.waste) : +state.spare;
    let order = state.material === 'tile' ? Math.ceil(st.count * (1 + spare)) : Math.ceil(st.minUnits * (1 + spare));
    const perBox = Math.floor(+state.perBox || 0);
    const boxes = perBox > 0 ? Math.ceil(order / perBox) : null;
    if (boxes) order = boxes * perBox;
    const coverArea = order * res.L * res.W;
    const price = +state.price || 0;
    const cost = price > 0 ? toAreaUnit(coverArea) * price : null;
    const wastePct = Math.max(0, 1 - st.roomArea / (order * (res.L + res.gap) * (res.W + res.gap)));
    return { order, boxes, cost, spare, wastePct };
  }

  // ---------- rendering the page ----------

  const $ = (sel) => document.querySelector(sel);
  const planCanvas = $('#plan');

  function renderMain() {
    if (!room.poly) {
      current = null;
      const ctx = planCanvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, planCanvas.width, planCanvas.height);
      $('#stats').innerHTML = '';
      return;
    }
    const pat = pattern();
    current = P.layout(room.poly, pat, layoutOpts());
    current.view = draw(planCanvas, current, room.poly, { showCuts: state.showCuts, showDims: state.showDims, hover });
    $('#pattern-name').textContent = pat.name;
    $('#pattern-desc').textContent = pat.desc;
    renderStats();
    renderCutList();
    renderLegend();
  }

  function redrawOnly() {
    if (current && room.poly) {
      current.view = draw(planCanvas, current, room.poly, { showCuts: state.showCuts, showDims: state.showDims, hover });
    }
  }

  function renderStats() {
    const st = current.stats, q = quantities(current, pattern());
    const noun = nounFor(q.order);
    const cards = [
      `<div class="stat hero"><b>${q.order} ${noun}</b><span>to order${q.boxes ? ` · ${q.boxes} box${q.boxes > 1 ? 'es' : ''}` : ''} (incl. ${Math.round(q.spare * 100)} % ${state.material === 'tile' ? 'spare' : 'waste'})</span></div>`,
      `<div class="stat"><b>${fmtArea(st.roomArea)}</b><span>floor area</span></div>`,
      `<div class="stat"><b>${st.full}</b><span>full ${nounFor(st.full)}</span></div>`,
      `<div class="stat"><b>${st.cut}</b><span>cut ${nounFor(st.cut)}</span></div>`,
      `<div class="stat ${st.slivers ? 'warn' : ''}"><b>${st.slivers}</b><span>slivers (&lt; ¼ wide)</span></div>`,
      `<div class="stat"><b>${Math.round(q.wastePct * 100)} %</b><span>material not on the floor</span></div>`,
    ];
    if (q.cost !== null) {
      cards.push(`<div class="stat"><b>${q.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b><span>estimated cost</span></div>`);
    }
    $('#stats').innerHTML = cards.join('');
  }

  function renderLegend() {
    const finish = FINISHES[state.material][mat().finish] || FINISHES[state.material][0];
    const items = [`<span><i style="background:${finish.c}"></i>full piece</span>`];
    if (state.showCuts) {
      items.push('<span><i style="background:rgba(232,163,61,.75)"></i>cut</span>');
      items.push('<span><i style="background:rgba(210,65,47,.8)"></i>sliver</span>');
    }
    $('#legend').innerHTML = items.join('');
  }

  function renderCutList() {
    const step = state.units === 'cm' ? 0.5 : 0.125;
    const groups = new Map();
    for (const p of current.pieces) {
      if (p.full) continue;
      const len = round(Math.min(p.eu, p.L), step), wid = round(Math.min(p.ev, p.W), step);
      const key = `${len}|${wid}|${p.angled}|${p.sliver}`;
      const g = groups.get(key) || { len, wid, angled: p.angled, sliver: p.sliver, n: 0 };
      g.n++;
      groups.set(key, g);
    }
    const rows = [...groups.values()].sort((a, b) => b.n - a.n || b.len - a.len);
    $('#cut-count').textContent = `(${current.stats.cut} pieces, ${rows.length} sizes)`;
    $('#cuts').innerHTML = '<thead><tr><th>Qty</th><th>Length</th><th>Width</th><th>Cut</th></tr></thead><tbody>' +
      rows.map((g) => `<tr><td>${g.n}×</td><td>${fmtLen(g.len, true)}</td><td>${fmtLen(g.wid, true)}</td><td>${g.angled ? 'angled' : 'straight'}${g.sliver ? '<span class="tag bad">sliver</span>' : ''}</td></tr>`).join('') +
      '</tbody>';
  }

  let galleryTimer = 0;
  function scheduleGallery() {
    clearTimeout(galleryTimer);
    galleryTimer = setTimeout(renderGallery, 120);
  }

  function renderGallery() {
    const el = $('#gallery');
    el.innerHTML = '';
    if (!room.poly) return;
    const m = mat();
    const list = P.available(state.material, +m.L || 1, +m.W || 1);
    const savedPattern = state.pattern;
    for (const pat of list) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.dataset.pattern = pat.id;
      card.setAttribute('aria-pressed', String(pat.id === savedPattern));
      const cv = document.createElement('canvas');
      card.append(cv);
      el.append(card);
      state.pattern = pat.id; // so draw() picks up two-tone etc.
      const res = P.layout(room.poly, pat, layoutOpts({ rotation: 0, shift: [0, 0] }));
      const q = quantities(res, pat);
      draw(cv, res, room.poly, { thumb: true, showCuts: false });
      card.insertAdjacentHTML('beforeend',
        `<strong>${pat.name}</strong><small>${q.order} ${nounFor(q.order)} · ${res.stats.cut} cuts · ${res.stats.slivers} slivers</small>`);
      card.addEventListener('click', () => selectPattern(pat.id));
    }
    state.pattern = savedPattern;
  }

  function markGallerySelection() {
    document.querySelectorAll('.card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.pattern === state.pattern)));
  }

  function selectPattern(id) {
    state.pattern = id;
    state.rotation = 0; state.shiftU = 0; state.shiftV = 0;
    $('#opt-msg').textContent = '';
    syncInputs();
    markGallerySelection();
    renderMain();
    saveState();
  }

  // Keep the chosen pattern valid for the current material and proportions.
  function ensurePatternValid() {
    const m = mat();
    const list = P.available(state.material, +m.L || 1, +m.W || 1);
    if (!list.some((p) => p.id === state.pattern)) {
      state.pattern = (list.find((p) => p.id === 'herringbone') || list.find((p) => p.id === 'brick') || list[0]).id;
    }
  }

  // ---------- inputs ----------

  function syncInputs() {
    document.querySelectorAll('[data-bind]').forEach((el) => {
      const key = el.dataset.bind;
      const val = ['L', 'W', 'gap'].includes(key) ? mat()[key] : state[key];
      if (el.classList.contains('seg')) {
        el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === val)));
        el.querySelectorAll('button').forEach((b) => b.setAttribute('role', 'radio'));
      } else if (el.type === 'checkbox') el.checked = !!val;
      else if (document.activeElement !== el) el.value = val;
    });
    document.querySelectorAll('[data-show]').forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(state.shape); });
    document.querySelectorAll('[data-show-pattern]').forEach((el) => { el.hidden = !el.dataset.showPattern.split(' ').includes(state.pattern); });
    document.querySelectorAll('em.u').forEach((el) => { el.textContent = state.units; });
    document.querySelectorAll('.ua').forEach((el) => { el.textContent = areaUnit(); });
    $('[data-label="gap"]').textContent = state.material === 'tile' ? 'Grout' : 'Joint gap';
    $('#rot-out').textContent = `${state.rotation}°`;
    renderPresets();
    renderSwatches();
    $('#custom-msg').textContent = state.shape === 'custom' && room && room.error ? room.error : (state.shape === 'custom' ? `Units: ${state.units}. Area ${room && room.poly ? fmtArea(Geo.area(room.poly)) : '—'}` : '');
    $('#custom-msg').classList.toggle('error', !!(room && room.error));
  }

  function renderPresets() {
    const el = $('#presets');
    const sizes = PRESETS[state.material][state.units];
    el.innerHTML = sizes.map(([l, w]) => `<button type="button" data-l="${l}" data-w="${w}">${l} × ${w}</button>`).join('');
  }

  function renderSwatches() {
    const el = $('#swatches');
    el.innerHTML = FINISHES[state.material].map((f, i) =>
      `<button type="button" role="radio" aria-checked="${i === mat().finish}" title="${f.name}" aria-label="${f.name}" data-i="${i}" style="background:${f.c}"></button>`).join('');
  }

  function convertUnits(to) {
    if (to === state.units) return;
    const f = to === 'in' ? 1 / 2.54 : 2.54;
    const r = (v, step) => +(round(+v * f, step)).toFixed(3);
    state.roomW = r(state.roomW, 0.5); state.roomL = r(state.roomL, 0.5);
    state.notchW = r(state.notchW, 0.5); state.notchL = r(state.notchL, 0.5);
    state.shiftU = r(state.shiftU, 0.1); state.shiftV = r(state.shiftV, 0.1);
    state.custom = state.custom.split('\n').map((line) => {
      const nums = line.split(/[\s,]+/).filter(Boolean).map(Number);
      return nums.length >= 2 && nums.every(Number.isFinite) ? `${r(nums[0], 0.5)}, ${r(nums[1], 0.5)}` : line;
    }).join('\n');
    for (const m of ['tile', 'wood']) {
      state[m].L = r(state[m].L, 0.25);
      state[m].W = r(state[m].W, 0.25);
      state[m].gap = r(state[m].gap, to === 'in' ? 1 / 16 : 0.1);
    }
    if (state.price) state.price = +(+state.price * (to === 'in' ? 1 / 10.7639 : 10.7639)).toFixed(2);
    state.units = to;
  }

  function onChange(opts = {}) {
    room = buildRoom();
    ensurePatternValid();
    syncInputs();
    renderMain();
    if (opts.gallery !== false) scheduleGallery();
    else markGallerySelection();
    saveState();
  }

  function bind() {
    document.querySelectorAll('.seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const key = seg.dataset.bind;
        if (key === 'units') convertUnits(b.dataset.value);
        else state[key] = b.dataset.value;
        if (key === 'material') { state.shiftU = 0; state.shiftV = 0; state.rotation = 0; }
        onChange();
      });
    });

    document.querySelectorAll('input[data-bind], textarea[data-bind], select[data-bind]').forEach((el) => {
      const key = el.dataset.bind;
      const layoutOnly = ['rotation', 'shiftU', 'shiftV', 'showCuts', 'showDims'].includes(key);
      el.addEventListener('input', () => {
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'number' || el.type === 'range') v = el.value === '' ? '' : +el.value;
        if (['L', 'W', 'gap'].includes(key)) mat()[key] = v;
        else state[key] = v;
        if (key === 'rotation' || key === 'shiftU' || key === 'shiftV') $('#opt-msg').textContent = '';
        onChange({ gallery: !layoutOnly });
      });
    });

    $('#presets').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      mat().L = +b.dataset.l; mat().W = +b.dataset.w;
      onChange();
    });
    $('#swatches').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      mat().finish = +b.dataset.i;
      onChange();
    });

    $('#btn-opt').addEventListener('click', () => {
      if (!room.poly) return;
      const btn = $('#btn-opt');
      btn.disabled = true;
      btn.textContent = 'Searching…';
      setTimeout(() => {
        const before = current.stats;
        const best = P.optimizeShift(room.poly, pattern(), layoutOpts());
        state.shiftU = +best.shift[0].toFixed(2);
        state.shiftV = +best.shift[1].toFixed(2);
        onChange({ gallery: false });
        const after = current.stats;
        $('#opt-msg').textContent = `Slivers ${before.slivers} → ${after.slivers}, cuts ${before.cut} → ${after.cut}.`;
        btn.disabled = false;
        btn.textContent = '✦ Minimise cuts';
      }, 20);
    });
    $('#btn-reset').addEventListener('click', () => {
      state.rotation = 0; state.shiftU = 0; state.shiftV = 0;
      $('#opt-msg').textContent = '';
      onChange({ gallery: false });
    });
    $('#btn-shuffle').addEventListener('click', () => { state.seed = (state.seed % 9999) + 1; onChange(); });

    $('#btn-link').addEventListener('click', async () => {
      history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(state)));
      try { await navigator.clipboard.writeText(location.href); flash('#btn-link', 'Copied!'); }
      catch (e) { flash('#btn-link', 'Copy from address bar'); }
    });
    $('#btn-print').addEventListener('click', () => window.print());
    $('#btn-png').addEventListener('click', exportPng);

    planCanvas.addEventListener('mousemove', onHover);
    planCanvas.addEventListener('mouseleave', () => { hover = -1; $('#tip').style.opacity = 0; redrawOnly(); });

    let resizeTimer = 0;
    new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redrawOnly, 50); }).observe(planCanvas);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawOnly);
  }

  function flash(sel, text) {
    const el = $(sel), old = el.textContent;
    el.textContent = text;
    setTimeout(() => { el.textContent = old; }, 1400);
  }

  let hoverFrame = 0;
  function onHover(e) {
    if (!current || !current.view) return;
    const rect = planCanvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => {
      const v = current.view;
      const world = [(sx - v.ox) / v.s, (sy - v.oy) / v.s];
      const local = current.transform.toLocal(world);
      const idx = Geo.pointInPolygon(world, room.poly)
        ? current.pieces.findIndex((p) => Geo.pointInPolygon(local, p.poly)) : -1;
      const tip = $('#tip');
      if (idx !== hover) { hover = idx; redrawOnly(); }
      if (idx < 0) { tip.style.opacity = 0; return; }
      const p = current.pieces[idx];
      const noun = state.material === 'tile' ? 'tile' : 'board';
      tip.textContent = p.full
        ? `Full ${noun} · ${fmtLen(p.L, true)} × ${fmtLen(p.W, true)}`
        : `Cut ${noun} · ${fmtLen(Math.min(p.eu, p.L), true)} × ${fmtLen(Math.min(p.ev, p.W), true)} · ${Math.round(p.frac * 100)} %${p.angled ? ' · angled' : ''}${p.sliver ? ' · sliver!' : ''}`;
      tip.style.left = Math.min(sx, rect.width - tip.offsetWidth - 24) + 'px';
      tip.style.top = Math.min(sy, rect.height - 40) + 'px';
      tip.style.opacity = 1;
    });
  }

  function exportPng() {
    if (!current) return;
    const W = 1600, H = 1200, head = 120;
    const cv = document.createElement('canvas');
    draw(cv, current, room.poly, {
      width: W, height: H, dpr: 1, pad: 80, offsetY: head / 2, showCuts: state.showCuts, showDims: true,
      background: '#ffffff', ink: '#23211e', paper: '#ffffff',
    });
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const st = current.stats, q = quantities(current, pattern()), m = mat();
    ctx.fillStyle = '#23211e';
    ctx.font = '600 40px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(pattern().name, 60, 70);
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#6f6a62';
    ctx.fillText(`${m.L} × ${m.W} ${state.units} ${state.material === 'tile' ? 'tiles' : 'boards'} · ${fmtArea(st.roomArea)} · ` +
      `${q.order} to order · ${st.full} full · ${st.cut} cut · ${st.slivers} slivers`, 60, 108);
    const a = document.createElement('a');
    a.download = `floor-plan-${state.pattern}.png`;
    a.href = cv.toDataURL('image/png');
    a.click();
  }

  // ---------- go ----------
  bind();
  onChange();
})();
