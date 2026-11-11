(() => {
  'use strict';
  const E = window.CursoraEngine, B = window.cursora;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const S = { lang: 'ar', settings: {}, packs: [], filter: 'all', q: '', view: 'library', pack: null, variant: {}, design: null, base: null,
    hist: [], fut: [], scope: 'all', role: 'Arrow', mine: [], info: {}, zoom: 'x3', bg: 'dark', split: 0, compare: false };
  const DPR = () => window.devicePixelRatio || 1;

  /* ---------------- i18n & dom helpers ---------------- */
  const t = (k, v = {}) => String((I18N[S.lang] || I18N.ar)[k] ?? I18N.ar[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => v[x] ?? m);
  const roleName = r => E.ROLE_INFO[r][S.lang] || r;
  const txt = o => (o && typeof o === 'object' ? (o[S.lang] || o.ar || o.en) : o) || '';
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'html') el.innerHTML = v; else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  const svgI = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = d; return s; };
  const IC = {
    back: '<path d="M15 6l-6 6 6 6"/>', heart: '<path d="M12 20.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', brush: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="M14 7l3 3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>', save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    chev: '<path d="M6 9l6 6 6-6"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 17v3h16v-3"/>', swap: '<path d="M7 4L3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 4 4"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8a4 4 0 0 1-4-4"/>', play: '<path d="M7 4l12 8-12 8z"/>', split: '<path d="M12 3v18"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  };

  /* ---------------- animation loop for canvases ---------------- */
  const anims = new Set();
  function drawResult(cv, r, i = 0) {
    const f = r.frames[i % r.frames.length];
    if (cv.width !== f.width) { cv.width = f.width; cv.height = f.height; }
    const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(f, 0, 0);
  }
  function show(cv, r) {
    for (const a of anims) if (a.cv === cv) anims.delete(a);
    drawResult(cv, r, 0);
    if (r.animated) anims.add({ cv, r, i: 0, next: performance.now() + r.delays[0] });
  }
  (function loop(now) {
    for (const a of anims) {
      if (!a.cv.isConnected) { anims.delete(a); continue; }
      if (now >= a.next) { a.i = (a.i + 1) % a.r.frames.length; drawResult(a.cv, a.r, a.i); a.next = now + Math.max(16, a.r.delays[a.i] || 40); }
    }
    requestAnimationFrame(loop);
  })(performance.now());

  // shape size so that the rendered canvas (which grows when a glow is on) fills `px` device pixels
  const fitPx = (design, px) => { const l = E.layout(design); return Math.max(8, Math.round(px * l.shape / l.canvas)); };
  async function preview(cv, design, role, size) {
    const tok = (cv._tok = (cv._tok || 0) + 1);
    try { const r = await E.renderRole(design, role, size); if (cv._tok === tok) show(cv, r); } catch (e) { console.warn(role, e); }
  }

  /* ---------------- live cursors ---------------- */
  const cursorCache = new Map();
  async function cursorCss(design, role) {
    const size = Math.min(64, Math.max(24, (design.global && design.global.size) || 32));
    const key = JSON.stringify([design.pack, design.variant, design.global, design.roles && design.roles[role], role, size]);
    if (!cursorCache.has(key)) cursorCache.set(key, E.renderRole(design, role, size).then(r => ({ list: r.frames.map((_, i) => E.cssCursor(r, i)), delays: r.delays })));
    if (cursorCache.size > 400) cursorCache.delete(cursorCache.keys().next().value);
    return cursorCache.get(key);
  }
  function bindCursor(el, getDesign, role) {
    // one binding per element: re-binding just swaps the source (persistent containers get re-bound on every render)
    if (el._cur) { el._cur.getDesign = getDesign; el._cur.role = role; el._cur.refresh(); return el._cur; }
    const b = el._cur = { getDesign, role, on: false, timer: null, gen: 0 };
    b.stop = () => { b.on = false; b.gen++; clearTimeout(b.timer); };
    b.start = async () => {
      b.stop(); b.on = true; const gen = b.gen; const d = b.getDesign(); if (!d) return;
      let c; try { c = await cursorCss(d, typeof b.role === 'function' ? b.role() : b.role); } catch { return; }
      if (gen !== b.gen) return;
      let i = 0; const step = () => {
        if (gen !== b.gen) return;
        if (!el.isConnected) return b.stop();
        el.style.cursor = c.list[i];
        if (c.list.length > 1) { b.timer = setTimeout(step, Math.max(30, c.delays[i] || 40)); i = (i + 1) % c.list.length; }
      };
      step();
    };
    b.refresh = () => { if (b.on) b.start(); };
    el.addEventListener('mouseenter', b.start);
    el.addEventListener('mouseleave', b.stop);
    return b;
  }

  /* ---------------- toasts, modal, confetti ---------------- */
  function toast(msg, sub, bad, ms = 3200) {
    const el = h('div', { class: 'toast' + (bad ? ' bad' : '') }, h('span', { class: 'ti' }, bad ? '!' : '✓'), h('div', {}, msg, sub ? h('small', {}, sub) : null));
    $('#toasts').append(el); setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
  }
  function modal(body, actions) {
    return new Promise(res => {
      const m = $('#modal'); $('#modalBody').replaceChildren(body); const a = $('#modalActions'); a.replaceChildren();
      for (const [label, val, cls] of actions) a.append(h('button', { class: 'btn ' + (cls || ''), onclick: () => { m.classList.add('hidden'); res(val); } }, label));
      m.onclick = e => { if (e.target === m) { m.classList.add('hidden'); res(null); } };
      m.classList.remove('hidden');
    });
  }
  function confetti(x, y) {
    if (S.settings.motion === false) return;
    const cols = ['#a5b4fc', '#f0abfc', '#67e8f9', '#fde68a', '#86efac', '#ffffff'];
    for (let i = 0; i < 46; i++) {
      const c = h('i', { class: 'confetti', style: { left: x + 'px', top: y + 'px', background: cols[i % cols.length] } });
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 220;
      c.style.setProperty('--dx', Math.cos(a) * d + 'px'); c.style.setProperty('--dy', Math.sin(a) * d + 160 + 'px'); c.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      document.body.append(c); setTimeout(() => c.remove(), 1300);
    }
  }

  /* ---------------- settings & theme ---------------- */
  const hexRgb = hx => { const n = parseInt(hx.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  function applyTheme() {
    const a = S.settings.accent || '#a5b4fc'; const [r, g, b] = hexRgb(a);
    document.documentElement.style.setProperty('--accent', a);
    document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    document.documentElement.style.setProperty('--on-accent', (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0b0b10' : '#ffffff');
    document.body.classList.toggle('no-motion', S.settings.motion === false);
  }
  async function saveSettings(p) { S.settings = await B.settings.set(p); applyTheme(); }
  function applyLang() {
    document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    $$('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    $('#search').placeholder = t('search'); $('#langBtn').textContent = S.lang === 'ar' ? 'EN' : 'ع';
    renderChips(); renderLibrary(); renderNow();
    if (S.view === 'pack') renderPack(); if (S.view === 'studio') renderStudio(); if (S.view === 'mine') renderMine(); if (S.view === 'settings') renderSettings();
    requestAnimationFrame(movePill);
  }

  /* ---------------- navigation ---------------- */
  function movePill() {
    const b = $(`#nav button[data-view="${S.view === 'pack' ? 'library' : S.view}"]`); const pill = $('.nav-pill');
    $$('#nav button').forEach(x => x.classList.toggle('active', x === b));
    if (b) pill.style.transform = `translateY(${b.offsetTop}px)`;
  }
  function go(view) {
    S.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    movePill();
    if (view === 'studio') renderStudio(); if (view === 'mine') renderMine(); if (view === 'settings') renderSettings();
  }

  /* ---------------- library ---------------- */
  const FILTERS = ['all', 'dark', 'light', 'color', 'mac', 'minimal', 'playful', 'rounded', 'fav'];
  function renderChips() {
    $('#chips').replaceChildren(...FILTERS.map(f => h('button', { class: 'chip' + (S.filter === f ? ' on' : ''), onclick: () => { S.filter = f; renderChips(); renderLibrary(); } }, t('f_' + f))));
  }
  const isFav = id => (S.settings.favorites || []).includes(id);
  function matches(p) {
    const q = S.q.trim().toLowerCase();
    if (q && ![p.name, p.author, txt(p.desc), ...(p.tags || []), ...p.variants.map(v => v.name)].join(' ').toLowerCase().includes(q)) return false;
    if (S.filter === 'all') return true;
    if (S.filter === 'fav') return isFav(p.id);
    if (S.filter === 'minimal') return (p.tags || []).some(x => ['minimal', 'flat', 'classic'].includes(x));
    if (S.filter === 'rounded') return (p.tags || []).some(x => ['rounded'].includes(x)) || ['volantes', 'oreo', 'bibata-modern', 'fuchsia'].includes(p.id);
    return (p.tags || []).includes(S.filter);
  }
  const appliedKey = () => { const a = S.settings.applied; const d = a && a.design; if (!d) return null; const plain = !Object.keys(d.roles || {}).length && !Object.keys(d.global || {}).filter(k => k !== 'size').length; return plain ? d.pack + '/' + d.variant : null; };

  function sw(v, on, click) {
    const [a, b] = v.swatch || ((v.colors && [v.colors.fill, v.colors.edge]) || ['#000', '#fff']);
    return h('button', { class: 'sw' + (on ? ' on' : ''), title: v.name, onclick: click }, h('i', { style: { background: a } }), h('i', { style: { background: b } }));
  }

  function renderLibrary() {
    const grid = $('#grid'); if (!grid) return;
    const list = S.packs.filter(matches);
    $('#libStats').textContent = t('packs_count', { n: S.packs.length, v: S.packs.reduce((s, p) => s + p.variants.length, 0) });
    $('#libEmpty').classList.toggle('hidden', list.length > 0);
    grid.replaceChildren(...list.map((p, i) => libCard(p, i)));
  }
  function libCard(p, i) {
    const vid = S.variant[p.id] || p.variants[0].id;
    const design = () => E.newDesign(p.id, S.variant[p.id] || p.variants[0].id);
    const cvs = ['Arrow', 'Hand', 'IBeam', 'Wait'].map((r, k) => h('canvas', { class: k === 0 ? 'big' : '' }));
    const draw = () => cvs.forEach((cv, k) => preview(cv, design(), ['Arrow', 'Hand', 'IBeam', 'Wait'][k], Math.round((k ? 48 : 72) * DPR())));
    const fav = h('button', { class: 'fav' + (isFav(p.id) ? ' on' : ''), onclick: async e => {
      e.stopPropagation(); const f = new Set(S.settings.favorites || []); f.has(p.id) ? f.delete(p.id) : (f.add(p.id), toast(t('fav_add')));
      await saveSettings({ favorites: [...f] }); fav.classList.toggle('on', f.has(p.id)); fav.classList.remove('pop'); void fav.offsetWidth; fav.classList.add('pop');
    } }, svgI(IC.heart));
    const MAXSW = 7; // more colours than fit: show the first few and a "+N" that opens the pack
    const sws = h('div', { class: 'swatches' }, p.variants.slice(0, MAXSW).map(v => sw(v, v.id === vid, e => {
      e.stopPropagation(); S.variant[p.id] = v.id; $$('.sw', sws).forEach((x, k) => x.classList.toggle('on', p.variants[k].id === v.id)); draw();
      cursorHandle.refresh(); badge.classList.toggle('hidden', appliedKey() !== p.id + '/' + v.id);
    })), p.variants.length > MAXSW ? h('button', { class: 'sw-more', dir: 'ltr', title: t('variants'), onclick: e => { e.stopPropagation(); openPack(p.id); } }, '+' + (p.variants.length - MAXSW)) : null);
    const badge = h('span', { class: 'badge-applied' + (appliedKey() === p.id + '/' + vid ? '' : ' hidden') }, '✓ ' + t('applied_now'));
    const card = h('div', { class: 'card', style: { animationDelay: Math.min(i, 12) * 35 + 'ms' }, onclick: () => openPack(p.id) },
      badge,
      h('div', { class: 'card-stage' }, h('div', { class: 'row' }, cvs)),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-top' }, h('div', { class: 'card-name' }, p.name), fav),
        h('div', { class: 'card-desc' }, txt(p.desc)),
        h('div', { class: 'card-top' }, sws, h('span', { class: 'tag' }, p.license))));
    draw();
    const cursorHandle = bindCursor(card, design, 'Arrow');
    $$('button', card).forEach(b => bindCursor(b, design, 'Hand'));
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', x * 100 + '%'); card.style.setProperty('--my', y * 100 + '%');
      if (S.settings.motion !== false) card.style.transform = `rotateX(${(0.5 - y) * 7}deg) rotateY(${(x - 0.5) * 9}deg) translateZ(0)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    return card;
  }

  /* ---------------- pack view ---------------- */
  function openPack(id, vid) {
    S.pack = id; if (vid) S.variant[id] = vid;
    renderPack(); go('pack'); $('#view-pack').scrollTop = 0;
  }
  function renderPack() {
    const p = S.packs.find(x => x.id === S.pack); if (!p) return;
    const vid = () => S.variant[p.id] || p.variants[0].id;
    const design = () => E.newDesign(p.id, vid());
    const root = $('#view-pack');
    const roleTiles = E.ROLES.map((r, i) => {
      const cv = h('canvas'); const el = h('div', { class: 'role', style: { animationDelay: i * 25 + 'ms' } }, cv, h('span', {}, roleName(r)));
      bindCursor(el, design, r); el._draw = () => preview(cv, design(), r, Math.round(48 * DPR())); el._draw(); return el;
    });
    const vrow = h('div', { class: 'variant-row' }, p.variants.map(v => h('button', { class: 'vchip' + (v.id === vid() ? ' on' : ''), onclick: e => {
      S.variant[p.id] = v.id; $$('.vchip', vrow).forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); roleTiles.forEach(x => x._draw()); renderLibrary();
    } }, sw(v, false), v.name)));
    root.replaceChildren(
      h('div', { class: 'pack-head' },
        h('button', { class: 'backbtn', onclick: () => go('library'), title: t('back') }, svgI(IC.back)),
        h('div', { class: 'pack-title' }, h('h1', {}, p.name), h('p', { class: 'sub' }, txt(p.desc)),
          h('div', { class: 'meta' }, h('span', {}, t('by') + ' ' + p.author), h('span', {}, t('license') + ': ' + p.license),
            p.url ? h('a', { href: '#', onclick: e => { e.preventDefault(); B.url(p.url); } }, t('source')) : null)),
        h('div', { class: 'pack-actions' },
          h('button', { class: 'btn lg', onclick: () => startStudio(design()) }, svgI(IC.brush), t('customize')),
          h('button', { class: 'btn lg primary shine', onclick: e => applyDesign(design(), p.name + ' ' + E.variantOf(p, vid()).name, e) }, svgI(IC.check), t('apply')))),
      h('h3', { style: { marginBottom: '10px' } }, t('variants')), vrow,
      h('div', { class: 'pack-grid' },
        h('div', { class: 'panel' }, h('div', { class: 'panel-h' }, h('h2', {}, t('roles_title', { n: 17 }))), h('div', { class: 'roles' }, roleTiles)),
        playground(design)));
    $$('button:not([data-r])', root).forEach(b => bindCursor(b, design, 'Hand'));
    bindCursor(root, design, 'Arrow');
  }

  function playground(design) {
    const busyBtn = h('button', { class: 'c3 ploading', 'data-r': 'Wait' }, '⏳ ', t('pg_loading'));
    const pad = h('canvas', { class: 'pad' }); const padWrap = h('div', { class: 'c3 padwrap', 'data-r': 'NWPen' }, pad, h('span', {}, '✍️ ' + t('pg_draw')));
    const cross = h('canvas', { class: 'pad' }); const crossWrap = h('div', { class: 'c3 padwrap', 'data-r': 'Crosshair' }, cross, h('span', {}, '⌖ ' + t('pg_cross')));
    const knob = h('div', { class: 'knob', 'data-r': 'SizeAll', style: { left: '20px', top: '20px' } }, '✥ ' + t('pg_move'));
    const mover = h('div', { class: 'c3 mover' }, knob);
    const resize = h('div', { class: 'c3 resize' }, t('pg_resize'),
      ...[['n', 'SizeNS'], ['s', 'SizeNS'], ['e', 'SizeWE'], ['w', 'SizeWE'], ['nw', 'SizeNWSE'], ['se', 'SizeNWSE'], ['ne', 'SizeNESW'], ['sw2', 'SizeNESW']].map(([c, r]) => h('b', { class: c, 'data-r': r })));
    const box = h('div', { class: 'panel', style: { position: 'relative' } },
      h('div', { class: 'panel-h' }, h('div', {}, h('h2', {}, t('playground')), h('div', { class: 'hint' }, t('playground_sub')))),
      h('div', { class: 'pg' },
        h('button', { class: 'c2 pbtn', 'data-r': 'Hand' }, t('pg_button')),
        h('a', { class: 'c2 plink', href: '#', 'data-r': 'Hand', onclick: e => e.preventDefault() }, t('pg_link')),
        h('div', { class: 'c2 pdis', 'data-r': 'No' }, '⛔ ' + t('pg_disabled')),
        h('input', { class: 'c6', 'data-r': 'IBeam', placeholder: t('pg_input') }),
        busyBtn,
        h('div', { class: 'c3', 'data-r': 'AppStarting' }, '⚙️ ' + t('pg_working')),
        resize, mover, padWrap, crossWrap,
        h('div', { class: 'c2', 'data-r': 'Help' }, h('span', { class: 'ic' }, '❔'), t('pg_help')),
        h('div', { class: 'c2', 'data-r': 'Pin' }, h('span', { class: 'ic' }, '📍'), t('pg_pin')),
        h('div', { class: 'c2', 'data-r': 'Person' }, h('span', { class: 'ic' }, '👤'), t('pg_person')),
        h('div', { class: 'c6', 'data-r': 'UpArrow' }, '⬆ ' + t('pg_alt'))));
    $$('[data-r]', box).forEach(el => bindCursor(el, design, el.dataset.r));
    // loading button → whole playground turns busy for a moment
    const pgBind = bindCursor(box, design, () => (box._busy ? 'Wait' : 'Arrow'));
    busyBtn.addEventListener('click', () => {
      box._busy = true; busyBtn.classList.add('busy'); pgBind.refresh();
      setTimeout(() => { box._busy = false; busyBtn.classList.remove('busy'); pgBind.refresh(); }, 2600);
    });
    // pen pad
    const fit = c => { const r = c.getBoundingClientRect(); if (r.width) { c.width = Math.round(r.width * DPR()); c.height = Math.round(r.height * DPR()); } };
    let drawing = false, last = null;
    pad.addEventListener('pointerdown', e => { if (pad.width !== Math.round(pad.clientWidth * DPR())) fit(pad); drawing = true; last = [e.offsetX, e.offsetY]; pad.setPointerCapture(e.pointerId); padWrap.querySelector('span').style.opacity = 0; });
    pad.addEventListener('pointermove', e => { if (!drawing) return; const x = pad.getContext('2d'); const k = pad.width / pad.clientWidth; x.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent'); x.lineWidth = 2.5 * k; x.lineCap = 'round'; x.beginPath(); x.moveTo(last[0] * k, last[1] * k); x.lineTo(e.offsetX * k, e.offsetY * k); x.stroke(); last = [e.offsetX, e.offsetY]; });
    pad.addEventListener('pointerup', () => { drawing = false; });
    requestAnimationFrame(() => { fit(pad); fit(cross); });
    cross.addEventListener('click', e => { const x = cross.getContext('2d'); const k = cross.width / cross.clientWidth; x.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent'); x.beginPath(); x.arc(e.offsetX * k, e.offsetY * k, 3 * k, 0, 7); x.fill(); crossWrap.querySelector('span').style.opacity = 0; });
    // drag knob
    knob.addEventListener('pointerdown', e => {
      knob.setPointerCapture(e.pointerId); const r0 = mover.getBoundingClientRect(); const k0 = knob.getBoundingClientRect(); const dx = e.clientX - k0.left, dy = e.clientY - k0.top;
      const mv = ev => { knob.style.left = Math.max(0, Math.min(r0.width - k0.width, ev.clientX - r0.left - dx)) + 'px'; knob.style.top = Math.max(0, Math.min(r0.height - k0.height, ev.clientY - r0.top - dy)) + 'px'; };
      knob.addEventListener('pointermove', mv); knob.addEventListener('pointerup', () => knob.removeEventListener('pointermove', mv), { once: true });
    });
    return box;
  }

  /* ---------------- apply ---------------- */
  async function applyDesign(design, name, ev) {
    const ov = $('#applyOverlay'), card = $('.apply-card', ov), bar = $('#applyBar');
    card.classList.remove('done'); bar.style.strokeDashoffset = 327; $('#applyT').textContent = t('applying'); $('#applyS').textContent = '';
    ov.classList.remove('hidden');
    const cv = $('#applyCanvas');
    try {
      const d = E.clone(design); d.name = name || d.name || 'CURSORA';
      if (!d.global || d.global.size == null) d.global = { ...(d.global || {}), size: S.sysSize || 32 };
      const files = await E.buildFiles(d, async (pct, role) => {
        bar.style.strokeDashoffset = 327 * (1 - pct * 0.9); $('#applyS').textContent = t('building', { r: roleName(role) });
        try { show(cv, await E.renderRole(d, role, 96)); } catch {}
      });
      const size = E.canvasSize(d);
      if (B.mock) await B.apply({ name: d.name, files: [], size, design: d });
      else await B.apply({ name: d.name, files, size, design: d });
      bar.style.strokeDashoffset = 0; card.classList.add('done');
      $('#applyT').textContent = t('applied_ok'); $('#applyS').textContent = B.mock ? t('only_windows') : t('applied_ok_s');
      S.settings = await B.settings.get(); renderNow(); renderLibrary();
      const r = card.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + 70);
      setTimeout(() => ov.classList.add('hidden'), 1700);
    } catch (e) {
      ov.classList.add('hidden'); toast(t('err', { e: e.message || e }), null, true, 6000);
    }
  }
  async function restoreFlow() {
    const has = await B.hasBackup();
    const v = await modal(h('div', {}, h('h2', {}, t('set_restore')), h('p', { class: 'sub', style: { marginTop: '8px' } }, t('set_restore_d'))),
      [[t('cancel'), null, 'ghost'], ...(has ? [[t('restore_mine'), 'backup', '']] : []), [t('restore_win'), 'windows', 'primary']]);
    if (!v) return;
    try { await B.restore(v); S.settings = await B.settings.get(); renderNow(); renderLibrary(); toast(t('restored_ok')); } catch (e) { toast(t('err', { e: e.message }), null, true); }
  }
  async function renderNow() {
    const a = S.settings.applied; const cv = $('#nowPreview');
    $('#nowName').textContent = a ? a.name : t('windows_default');
    $('#quickRestore').classList.toggle('hidden', !a);
    if (a && a.design) { try { if (a.design.userPack) E.registerPack(a.design.userPack); await preview(cv, a.design, 'Arrow', 96); } catch {} }
    else { const x = cv.getContext('2d'); x.clearRect(0, 0, 96, 96); x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 3; x.beginPath(); x.moveTo(34, 20); x.lineTo(34, 72); x.lineTo(46, 61); x.lineTo(55, 79); x.lineTo(63, 75); x.lineTo(55, 58); x.lineTo(70, 58); x.closePath(); x.stroke(); x.fill(); }
  }

  /* ---------------- studio ---------------- */
  function startStudio(design, mineId) {
    S.design = E.clone(design); S.mineId = mineId || null;
    if (!mineId && S.sysSize && (!S.design.global || S.design.global.size == null)) S.design.global = { ...(S.design.global || {}), size: S.sysSize };
    if (!S.design.name) { const p = S.packs.find(x => x.id === design.pack); S.design.name = p ? p.name + ' ✦' : 'CURSORA'; }
    S.base = { pack: design.pack, variant: design.variant };
    S.hist = []; S.fut = []; S.scope = 'all'; S.role = 'Arrow';
    go('studio');
  }
  const snapshot = () => JSON.stringify(S.design);
  function commit(before) { if (before !== snapshot()) { S.hist.push(before); S.fut = []; if (S.hist.length > 120) S.hist.shift(); syncUndo(); } }
  function syncUndo() { const u = $('#stUndo'), r = $('#stRedo'); if (u) u.disabled = !S.hist.length; if (r) r.disabled = !S.fut.length; }
  function undo() { if (!S.hist.length) return; S.fut.push(snapshot()); S.design = JSON.parse(S.hist.pop()); renderStudio(); }
  function redo() { if (!S.fut.length) return; S.hist.push(snapshot()); S.design = JSON.parse(S.fut.pop()); renderStudio(); }

  function curParams() { return E.paramsFor(S.design, S.role); }
  function setParam(k, v) {
    const d = S.design;
    if (S.scope === 'role' && k !== 'size') {
      d.roles[S.role] = d.roles[S.role] || {}; d.roles[S.role].params = { ...(d.roles[S.role].params || {}), [k]: v };
    } else { d.global = { ...(d.global || {}), [k]: v }; }
    refreshStudio();
  }

  function setRoleParam(k, v) {
    const r = (S.design.roles[S.role] = S.design.roles[S.role] || {});
    r.params = { ...(r.params || {}), [k]: v };
    if (v == null) delete r.params[k];
    if (!Object.keys(r.params).length) delete r.params;
    if (!Object.keys(r).length) delete S.design.roles[S.role];
    refreshStudio();
  }
  const PRESETS = [['#000000', '#ffffff'], ['#ffffff', '#000000'], ['#0b0b0f', '#a5b4fc'], ['#111827', '#67e8f9'], ['#1a1a1a', '#fbbf24'], ['#fafafa', '#ec4899'], ['#7c3aed', '#ffffff'], ['#0ea5e9', '#ffffff'], ['#22c55e', '#052e16'], ['#ef4444', '#ffffff'], ['#f59e0b', '#1c1917'], ['#f472b6', '#ffffff']];

  let refreshTok = 0;
  function refreshStudio() {
    const tok = ++refreshTok;
    requestAnimationFrame(async () => {
      if (tok !== refreshTok || S.view !== 'studio') return;
      drawStage(); drawStrip(); syncControls(); stageCursor.refresh && stageCursor.refresh();
    });
  }

  let stageCursor = {};
  function renderStudio() {
    const root = $('#view-studio');
    if (!S.design) {
      root.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, '✎'), h('h2', {}, t('studio_empty_t')), h('p', { class: 'sub' }, t('studio_empty_s')),
        h('button', { class: 'btn primary', onclick: () => go('library') }, t('go_library'))));
      return;
    }
    const d = S.design;
    const designFn = () => S.design;
    // ---- controls
    const rng = (key, min, max, step, fmt, roleOnly) => {
      const out = h('output'); const inp = h('input', { type: 'range', min, max, step, 'data-k': key, 'data-role': roleOnly ? '1' : null });
      let before = null;
      inp.addEventListener('pointerdown', () => { before = snapshot(); });
      inp.addEventListener('input', () => { if (before == null) before = snapshot(); (roleOnly ? setRoleParam : setParam)(key, parseFloat(inp.value)); });
      inp.addEventListener('change', () => { if (before != null) commit(before); before = null; });
      inp._fmt = fmt || (v => v); inp._out = out;
      return h('div', { class: 'field' }, h('div', { class: 'field-h' }, h('span', {}, t(key === 'shadowOpacity' ? 'sop' : key === 'shadowBlur' ? 'blur' : key === 'shadowX' ? 'sx' : key === 'shadowY' ? 'sy' : key === 'glowBlur' ? 'gblur' : key === 'glowStrength' ? 'gstr' : key)), out), inp);
    };
    const tog = (key, label) => {
      const s = h('span', { class: 'sw-t', 'data-k': key });
      return h('button', { class: 'toggle', onclick: () => { const b = snapshot(); setParam(key, !curParams()[key]); commit(b); } }, h('span', {}, t(label || key)), s);
    };
    const col = (key, label) => {
      const i = h('i'); const inp = h('input', { type: 'color', 'data-k': key }); const code = h('code');
      let before = null;
      inp.addEventListener('input', () => { if (before == null) before = snapshot(); setParam(key, inp.value); });
      inp.addEventListener('change', () => { if (before != null) commit(before); before = null; });
      inp._i = i; inp._code = code;
      return h('div', { class: 'color' }, h('label', {}, i, inp), h('div', {}, h('div', {}, t(label || key)), code));
    };
    const sec = (title, body, open = true) => {
      const s = h('div', { class: 'sec' + (open ? '' : ' closed') }, h('button', { class: 'sec-h', style: { width: '100%' }, onclick: () => s.classList.toggle('closed') }, title, svgI(IC.chev)), h('div', { class: 'sec-b' }, body));
      $('svg', s).classList.add('arr'); return s;
    };
    const p0 = S.packs.find(x => x.id === d.pack);
    const presets = h('div', { class: 'presets' }, PRESETS.map(([f, e]) => h('button', { class: 'preset', title: f + ' / ' + e, onclick: () => {
      const b = snapshot(); const dd = S.design; const tgt = S.scope === 'role' ? ((dd.roles[S.role] = dd.roles[S.role] || {}).params = { ...((dd.roles[S.role] || {}).params || {}) }) : (dd.global = { ...(dd.global || {}) });
      Object.assign(tgt, { recolor: true, fill: f, edge: e, accent: f }); refreshStudio(); commit(b);
    } }, h('i', { style: { background: f } }), h('i', { style: { background: e } }))));

    // ---- the selected shape: its own size + swap it for the same shape from another pack
    const ro = d.roles[S.role] || {};
    const srcPack = S.packs.find(x => x.id === (ro.pack || d.pack));
    const srcName = srcPack ? srcPack.name + ' · ' + E.variantOf(srcPack, ro.pack ? ro.variant : d.variant).name : '';
    const shapeCv = h('canvas', { class: 'shape-cv' });
    const shapeSec = h('div', { class: 'sec shape-sec' },
      h('div', { class: 'shape-head' }, h('div', { class: 'shape-thumb' }, shapeCv),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'shape-t' }, t('sec_shape') + ': ' + roleName(S.role)), h('div', { class: 'hint' }, t('from_pack', { p: srcName })))),
      h('div', { class: 'sec-b' },
        rng('own', 0.4, 1.6, 0.02, v => Math.round(v * 100) + '%', true),
        h('div', { class: 'row2' },
          h('button', { class: 'btn sm', onclick: () => openPicker() }, svgI(IC.swap), t('pick_shape')),
          h('button', { class: 'btn sm ghost', disabled: !(ro.pack || (ro.params && ro.params.own != null)), onclick: () => {
            const b = snapshot(); const r = S.design.roles[S.role] || {}; delete r.pack; delete r.variant; if (r.params) delete r.params.own;
            if (r.params && !Object.keys(r.params).length) delete r.params; if (!Object.keys(r).length) delete S.design.roles[S.role]; renderStudio(); commit(b);
          } }, svgI(IC.reset), t('reset_shape')))));
    const side = h('div', { class: 'studio-side' },
      h('div', { class: 'seg', id: 'scopeSeg' },
        h('button', { 'data-s': 'all', onclick: () => { S.scope = 'all'; renderStudio(); } }, t('scope_all')),
        h('button', { 'data-s': 'role', onclick: () => { S.scope = 'role'; renderStudio(); } }, t('scope_role'))),
      shapeSec,
      S.scope === 'role' ? h('div', { class: 'hint' }, t('editing', { r: roleName(S.role) })) : null,
      sec(t('sec_size'), [rng('size', 32, 128, 4, v => v + 'px'), rng('scale', 0.6, 1.4, 0.02, v => Math.round(v * 100) + '%')]),
      sec(t('sec_color'), [tog('recolor'), h('div', { class: 'field' }, h('div', { class: 'field-h' }, h('span', {}, t('presets'))), presets),
        h('div', { class: 'row2' }, col('fill'), col('edge')), (p0 && p0.kind === 'tokens' && p0.tokens.accent) ? col('accent') : null,
        tog('gradient'), col('fill2'), rng('angle', 0, 360, 5, v => v + '°')]),
      sec(t('sec_outline'), [rng('outline', 0, 4, 0.25, v => v + 'px'), col('outlineColor', 'outline_color')], false),
      sec(t('sec_shadow'), [tog('shadow'), rng('shadowBlur', 0, 8, 0.25), h('div', { class: 'row2' }, rng('shadowX', -4, 4, 0.2), rng('shadowY', -4, 6, 0.2)), rng('shadowOpacity', 0, 1, 0.05, v => Math.round(v * 100) + '%'), col('shadowColor', 'scolor')], false),
      sec(t('sec_glow'), [tog('glow'), col('glowColor', 'gcolor'), rng('glowStrength', 0.2, 3, 0.05, v => Math.round(v * 100) + '%'), rng('glowBlur', 1, 16, 0.5), rng('glowSoft', 0, 1, 0.05, v => Math.round(v * 100) + '%')], !!curParams().glow),
      sec(t('sec_more'), [rng('opacity', 0.3, 1, 0.05, v => Math.round(v * 100) + '%'), rng('speed', 0.25, 3, 0.05, v => v.toFixed(2) + '×'), tog('mirror')], false),
    );

    // ---- main
    const nameIn = h('input', { class: 'st-name', value: d.name || '', placeholder: t('name_ph'), oninput: e => { S.design.name = e.target.value; } });
    const top = h('div', { class: 'st-top' }, nameIn,
      h('button', { class: 'btn icon', id: 'stUndo', title: t('undo') + ' (Ctrl+Z)', onclick: undo }, svgI(IC.undo)),
      h('button', { class: 'btn icon', id: 'stRedo', title: t('redo') + ' (Ctrl+Y)', onclick: redo }, svgI(IC.redo)),
      h('button', { class: 'btn icon', title: t('reset'), onclick: () => { const b = snapshot(); const keep = S.design.global && S.design.global.size; S.design = { ...E.newDesign(S.base.pack, S.base.variant), name: S.design.name }; if (keep) S.design.global.size = keep; renderStudio(); commit(b); } }, svgI(IC.reset)),
      h('button', { class: 'btn', onclick: saveMine }, svgI(IC.save), t('save')),
      h('button', { class: 'btn primary shine', onclick: e => applyDesign(S.design, S.design.name, e) }, svgI(IC.check), t('apply')));
    const seg = (id, items, cur, fn) => h('div', { class: 'seg', id }, items.map(([v, l]) => h('button', { class: v === cur ? 'on' : '', onclick: e => { $$('button', e.currentTarget.parentNode).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); fn(v); } }, l)));
    const before = h('canvas'), after = h('canvas');
    const cmp = h('div', { class: 'compare' + (S.zoom !== 'real' ? ' pixel' : '') }, after, h('div', { class: 'before' + (S.compare ? '' : ' hidden') }, before), h('div', { class: 'split' + (S.compare ? '' : ' hidden') }));
    const stage = h('div', { class: 'stage bg-' + S.bg, id: 'stage' },
      h('div', { class: 'stage-tools' },
        seg('bgSeg', [['dark', t('bg_dark')], ['light', t('bg_light')], ['check', t('bg_check')], ['wall', t('bg_wall')]], S.bg, v => { S.bg = v; stage.className = 'stage bg-' + v; }),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', { class: 'btn sm' + (S.compare ? ' primary' : ''), onclick: e => { S.compare = !S.compare; e.currentTarget.classList.toggle('primary', S.compare); $('.before', cmp).classList.toggle('hidden', !S.compare); $('.split', cmp).classList.toggle('hidden', !S.compare); setSplit(50); drawStage(); } }, svgI(IC.split), t('compare')),
          seg('zoomSeg', [['real', t('real')], ['x2', '2×'], ['x3', '3×'], ['x5', '5×']], S.zoom, v => { S.zoom = v; cmp.classList.toggle('pixel', v !== 'real'); drawStage(); }))),
      cmp, h('div', { class: 'stage-hint' }, t('hint_stage')));
    const setSplit = pct => { S.split = pct; cmp.style.setProperty('--split', pct + '%'); };
    setSplit(50);
    stage.addEventListener('mousemove', e => { if (!S.compare) return; const r = cmp.getBoundingClientRect(); if (r.width) setSplit(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100))); });
    const strip = h('div', { class: 'strip', id: 'strip' }, E.ROLES.map(r => {
      const el = h('button', { class: 'role' + (r === S.role ? ' sel' : ''), onclick: () => { S.role = r; renderStudio(); } }, h('canvas'), h('span', {}, roleName(r)));
      el.dataset.role = r; bindCursor(el, designFn, r); return el;
    }));
    const mainCol = h('div', { class: 'st-main' }, top, stage, strip);
    root.replaceChildren(h('div', { class: 'studio' }, side, mainCol));
    $$(`#scopeSeg button`).forEach(b => b.classList.toggle('on', b.dataset.s === S.scope));
    stageCursor = bindCursor(stage, designFn, () => S.role);
    $$('button', root).forEach(b => { if (!b.classList.contains('role')) bindCursor(b, designFn, 'Hand'); });
    $$('input[type=range]', root).forEach(b => bindCursor(b, designFn, 'Hand'));
    bindCursor(nameIn, designFn, 'IBeam');
    bindCursor(side, designFn, 'Arrow');
    root._before = before; root._after = after;
    preview(shapeCv, d, S.role, fitPx(d, Math.round(56 * DPR())));
    syncUndo(); syncControls(); drawStage(); drawStrip();
    // keep the strip where it was and the selected shape in view (re-rendering would jump back to the start)
    if (S.stripScroll != null) strip.scrollLeft = S.stripScroll;
    const selEl = $('.role.sel', strip); if (selEl) selEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    strip.addEventListener('scroll', () => { S.stripScroll = strip.scrollLeft; }, { passive: true });
  }
  function syncControls() {
    const root = $('#view-studio'); if (!root || !S.design) return;
    const p = curParams();
    const pr = E.paramsFor(S.design, S.role);
    $$('input[type=range]', root).forEach(i => { const src = i.dataset.role ? pr : p; const v = src[i.dataset.k]; i.value = v; i._out.textContent = i._fmt(+v); i.style.setProperty('--p', ((v - i.min) / (i.max - i.min)) * 100 + '%'); });
    $$('.sw-t', root).forEach(s => s.classList.toggle('on', !!p[s.dataset.k]));
    $$('input[type=color]', root).forEach(i => { const v = p[i.dataset.k] || '#000000'; i.value = v; i._i.style.background = v; i._code.textContent = v.toUpperCase(); });
    $$('.role', $('#strip')).forEach(el => { const r = el.dataset.role; const has = S.design.roles[r] && (S.design.roles[r].params || S.design.roles[r].pack); let dot = $('.dot', el); if (has && !dot) el.append(h('i', { class: 'dot' })); if (!has && dot) dot.remove(); });
  }
  async function drawStage() {
    const root = $('#view-studio'); if (!root._after) return;
    const sz = E.paramsFor(S.design, S.role).size;
    const zoom = S.zoom === 'real' ? 1 / DPR() : +S.zoom.slice(1);
    const base = E.newDesign(S.base.pack, S.base.variant); base.global = { size: sz };
    const css = d => Math.round(E.layout(d, sz).canvas * zoom) + 'px';
    root._after.style.width = root._after.style.height = css(S.design);
    root._before.style.width = root._before.style.height = css(base);
    preview(root._after, S.design, S.role, sz);
    if (S.compare) preview(root._before, base, S.role, sz);
    const sc = $('.shape-cv', root); if (sc) preview(sc, S.design, S.role, fitPx(S.design, Math.round(56 * DPR())));
  }
  function drawStrip() { const px = fitPx(S.design, Math.round(36 * DPR())); $$('#strip .role').forEach(el => preview($('canvas', el), S.design, el.dataset.role, px)); }

  /* ---------------- shape picker: the same shape from every pack, as pictures ---------------- */
  function openPicker() {
    const role = S.role, cur = S.design.roles[role] || {};
    const curKey = cur.pack ? cur.pack + '/' + cur.variant : '';
    let filter = 'all', q = '';
    const big = h('canvas', { class: 'pk-big' }); const bigName = h('div', { class: 'pk-name' });
    const mixOf = (pack, variant) => {
      const dd = E.clone(S.design); const r = (dd.roles[role] = dd.roles[role] || {});
      if (pack) { r.pack = pack; r.variant = variant; } else { delete r.pack; delete r.variant; }
      if (!Object.keys(r).length) delete dd.roles[role];
      return dd;
    };
    const showBig = (pack, variant, label) => { bigName.textContent = label; preview(big, mixOf(pack, variant), role, fitPx(S.design, Math.round(112 * DPR()))); };
    const grid = h('div', { class: 'pk-grid' });
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && e.target._draw) { e.target._draw(); e.target._draw = null; io.unobserve(e.target); } }), { root: grid, rootMargin: '200px' });
    const tile = (pack, variant, label, sub) => {
      const cv = h('canvas'); const key = pack ? pack + '/' + variant : '';
      const plain = pack ? E.newDesign(pack, variant) : E.newDesign(S.design.pack, S.design.variant);
      const full = label + (sub ? ' · ' + sub : '');
      const el = h('button', { class: 'pk-tile' + (key === curKey ? ' on' : ''), title: full, onclick: () => {
        const b = snapshot(); S.design = mixOf(pack, variant);
        close(); renderStudio(); commit(b); toast(t('picked', { r: roleName(role) }), full);
      } }, h('div', { class: 'pk-cv' }, cv), h('b', {}, label), sub ? h('span', {}, sub) : null);
      el._draw = () => preview(cv, plain, role, Math.round(48 * DPR()));
      el.addEventListener('mouseenter', () => showBig(pack, variant, full));
      bindCursor(el, () => plain, role);
      const pk = pack && S.packs.find(p => p.id === pack);
      el._meta = { pack: pk, variant: pk && E.variantOf(pk, variant) };
      return el;
    };
    const tiles = [tile(null, null, t('original'), (S.packs.find(p => p.id === S.design.pack) || {}).name)];
    for (const p of S.packs) for (const v of p.variants) if (!(p.id === S.design.pack && v.id === S.design.variant)) tiles.push(tile(p.id, v.id, p.name, v.name));
    const tone = v => {
      const f = (v.colors && v.colors.fill) || (v.swatch && v.swatch[0]) || '#000000';
      const n = parseInt(String(f).replace('#', '').slice(0, 6), 16) || 0; const a = [n >> 16 & 255, n >> 8 & 255, n & 255];
      return { lum: (a[0] * .299 + a[1] * .587 + a[2] * .114) / 255, sat: (Math.max(...a) - Math.min(...a)) / 255 };
    };
    const match = el => {
      const m = el._meta; if (!m.pack) return !q && filter === 'all';
      if (q && !(m.pack.name + ' ' + m.variant.name + ' ' + (m.pack.tags || []).join(' ')).toLowerCase().includes(q)) return false;
      if (filter === 'all') return true;
      const { lum, sat } = tone(m.variant);
      if (filter === 'color') return sat > 0.25 || m.variant.polarity === 'color';
      if (filter === 'dark') return sat <= 0.25 && lum < 0.5;
      if (filter === 'light') return sat <= 0.25 && lum >= 0.5;
      return true;
    };
    const refilter = () => { for (const el of tiles) el.classList.toggle('hidden', !match(el)); };
    grid.append(...tiles); tiles.forEach(el => io.observe(el));
    const chips = h('div', { class: 'chips' }, ['all', 'dark', 'light', 'color'].map(f => h('button', { class: 'chip' + (f === filter ? ' on' : ''), onclick: e => { filter = f; $$('.chip', chips).forEach(c => c.classList.remove('on')); e.currentTarget.classList.add('on'); refilter(); } }, t('f_' + f))));
    const search = h('input', { placeholder: t('search'), oninput: e => { q = e.target.value.trim().toLowerCase(); refilter(); } });
    const ov = h('div', { class: 'overlay picker' },
      h('div', { class: 'pk-card' },
        h('div', { class: 'pk-side' }, h('div', { class: 'pk-stage' }, big), bigName, h('div', { class: 'hint' }, t('preview_mix'))),
        h('div', { class: 'pk-main' },
          h('div', { class: 'pk-head' }, h('div', {}, h('h2', {}, t('pick_title', { r: roleName(role) })), h('div', { class: 'hint' }, t('pick_sub'))),
            h('button', { class: 'btn icon', onclick: () => close(), title: 'Esc' }, svgI('<path d="M6 6l12 12M18 6L6 18"/>'))),
          h('div', { class: 'pk-tools' }, h('label', { class: 'search' }, svgI('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'), search), chips),
          grid)));
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => { io.disconnect(); document.removeEventListener('keydown', onKey, true); ov.remove(); };
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(ov);
    const curT = tiles.find(el => el.classList.contains('on')) || tiles[0];
    showBig(cur.pack || null, cur.variant || null, curT.title);
    curT.scrollIntoView({ block: 'center' }); search.focus();
    $$('.pk-head button, .chip', ov).forEach(b => bindCursor(b, () => S.design, 'Hand'));
    bindCursor(search, () => S.design, 'IBeam'); bindCursor(ov, () => S.design, 'Arrow');
  }

  async function saveMine() {
    const d = E.clone(S.design); d.name = d.name || 'CURSORA';
    const pk = S.packs.find(p => p.id === d.pack) || null;
    if (pk && pk.user) d.userPack = pk;
    if (S.mineId) { const it = S.mine.find(m => m.id === S.mineId); if (it) { it.design = d; it.updated = Date.now(); } }
    else { S.mineId = 'm' + Date.now().toString(36); S.mine.unshift({ id: S.mineId, design: d, created: Date.now() }); }
    S.mine = await B.mine.set(S.mine); updateMineCount(); toast(t('saved'), d.name);
  }

  /* ---------------- mine ---------------- */
  function updateMineCount() { $('#mineCount').textContent = S.mine.length || ''; }
  function renderMine() {
    const grid = $('#mineGrid'); $('#mineEmpty').classList.toggle('hidden', S.mine.length > 0);
    grid.replaceChildren(...S.mine.map((m, i) => {
      if (m.design.userPack) E.registerPack(m.design.userPack);
      const d = () => m.design;
      const cvs = ['Arrow', 'Hand', 'IBeam', 'Wait'].map((r, k) => { const c = h('canvas', { class: k ? '' : 'big' }); preview(c, m.design, r, fitPx(m.design, Math.round((k ? 48 : 72) * DPR()))); return c; });
      const act = (ic, label, fn, cls) => h('button', { class: 'btn sm ' + (cls || ''), title: label, onclick: e => { e.stopPropagation(); fn(e); } }, svgI(ic), label);
      const card = h('div', { class: 'card', style: { animationDelay: i * 40 + 'ms' }, onclick: () => startStudio(m.design, m.id) },
        h('div', { class: 'card-stage' }, h('div', { class: 'row' }, cvs)),
        h('div', { class: 'card-body' },
          h('div', { class: 'card-top' }, h('div', { class: 'card-name' }, m.design.name || 'CURSORA'), h('span', { class: 'tag' }, m.design.userPack ? t('user_pack') : t('custom_badge'))),
          h('div', { class: 'tagline' },
            act(IC.check, t('apply'), e => applyDesign(m.design, m.design.name, e), 'primary'),
            act(IC.brush, t('edit'), () => startStudio(m.design, m.id)),
            act(IC.up, t('export'), () => B.exportDesign(m.design)),
            act(IC.copy, t('duplicate'), async () => { S.mine.splice(i + 1, 0, { id: 'm' + Date.now().toString(36), design: { ...E.clone(m.design), name: (m.design.name || '') + ' 2' }, created: Date.now() }); S.mine = await B.mine.set(S.mine); updateMineCount(); renderMine(); }),
            act(IC.trash, t('del'), async () => {
              const ok = await modal(h('h2', {}, t('confirm_del', { n: m.design.name })), [[t('no'), false, 'ghost'], [t('del'), true, 'danger']]);
              if (ok) { S.mine = await B.mine.set(S.mine.filter(x => x.id !== m.id)); updateMineCount(); renderMine(); }
            }, 'danger'))));
      bindCursor(card, d, 'Arrow'); $$('button', card).forEach(b => bindCursor(b, d, 'Hand'));
      card.addEventListener('mousemove', e => { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', (e.clientX - r.left) / r.width * 100 + '%'); card.style.setProperty('--my', (e.clientY - r.top) / r.height * 100 + '%'); });
      return card;
    }));
  }

  const INF_KEYS = { pointer: 'Arrow', help: 'Help', work: 'AppStarting', busy: 'Wait', cross: 'Crosshair', text: 'IBeam', hand: 'NWPen', unavailiable: 'No', unavailable: 'No', vert: 'SizeNS', horz: 'SizeWE', dgn1: 'SizeNWSE', dgn2: 'SizeNESW', move: 'SizeAll', alternate: 'UpArrow', link: 'Hand', pin: 'Pin', person: 'Person' };
  const GUESS = [[/work|appstart|progress|background/i, 'AppStarting'], [/busy|wait|load/i, 'Wait'], [/help|question/i, 'Help'], [/cross|precision/i, 'Crosshair'], [/text|beam|select_text/i, 'IBeam'], [/hand.?writ|pen|nwpen/i, 'NWPen'], [/unavail|no\b|forbid|not.?allowed/i, 'No'],
    [/vert|ns|size.?ns|sizens/i, 'SizeNS'], [/horz|hor|we|sizewe/i, 'SizeWE'], [/dgn1|nwse|diag.?1|fdiag/i, 'SizeNWSE'], [/dgn2|nesw|diag.?2|bdiag/i, 'SizeNESW'], [/move|all|fleur/i, 'SizeAll'], [/alt|up/i, 'UpArrow'], [/link|hand|pointer.?hand/i, 'Hand'], [/pin|location/i, 'Pin'], [/person/i, 'Person'], [/normal|arrow|pointer|default/i, 'Arrow']];
  async function importFolder() {
    const r = await B.openFolderCursors(); if (!r || !r.files.length) return;
    const byFile = {};
    if (r.inf) { // [Strings] section maps keys → file names
      const strings = {}; let inS = false;
      for (const line of r.inf.split(/\r?\n/)) { const l = line.trim(); if (/^\[/.test(l)) { inS = /^\[strings\]/i.test(l); continue; } const m = inS && l.match(/^(\w+)\s*=\s*"?([^"]+)"?/); if (m) strings[m[1].toLowerCase()] = m[2]; }
      for (const [k, role] of Object.entries(INF_KEYS)) if (strings[k]) byFile[strings[k].toLowerCase()] = role;
    }
    const byRole = {};
    for (const f of r.files) {
      let role = byFile[f.name.toLowerCase()];
      if (!role) { const g = GUESS.find(([re]) => re.test(f.name.replace(/\.(cur|ani)$/i, ''))); role = g && g[1]; }
      if (!role || byRole[role]) continue;
      try { byRole[role] = await E.decodeAny(new Uint8Array(f.bytes)); } catch (e) { console.warn(f.name, e); }
    }
    if (!Object.keys(byRole).length) return toast(t('err', { e: 'no cursors' }), null, true);
    const id = 'user-' + Date.now().toString(36);
    const pack = E.packFromDecoded(id, r.name, byRole);
    const d = E.newDesign(id, 'default'); d.name = r.name; d.global = { shadow: false }; d.userPack = pack;
    S.mine.unshift({ id: 'm' + Date.now().toString(36), design: d, created: Date.now() });
    S.mine = await B.mine.set(S.mine); updateMineCount(); renderMine(); toast(t('imported_ok'), r.name);
  }
  async function importDesign() {
    const d = await B.importDesign(); if (!d) return;
    S.mine.unshift({ id: 'm' + Date.now().toString(36), design: d, created: Date.now() });
    S.mine = await B.mine.set(S.mine); updateMineCount(); renderMine(); toast(t('imported_ok'), d.name);
  }

  /* ---------------- settings ---------------- */
  const ACCENTS = ['#a5b4fc', '#e5e7eb', '#67e8f9', '#f0abfc', '#fda4af', '#fde68a', '#86efac', '#c4b5fd'];
  function renderSettings() {
    const root = $('#view-settings');
    const row = (title, desc, ...acts) => h('div', { class: 'set-row' }, h('div', {}, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), h('div', { class: 'acts' }, acts));
    const motion = h('span', { class: 'sw-t' + (S.settings.motion !== false ? ' on' : '') });
    root.replaceChildren(
      h('div', { class: 'hero' }, h('div', {}, h('h1', {}, t('set_title')))),
      h('div', { class: 'set-wrap' },
        row(t('set_lang'), null, h('div', { class: 'seg' }, [['ar', 'العربية'], ['en', 'English']].map(([v, l]) => h('button', { class: S.lang === v ? 'on' : '', onclick: () => setLang(v) }, l)))),
        row(t('set_accent'), null, h('div', { class: 'accents' }, ACCENTS.map(c => h('button', { class: 'accent-dot' + (S.settings.accent === c ? ' on' : ''), style: { background: c, color: c }, onclick: async () => { await saveSettings({ accent: c }); renderSettings(); } })))),
        row(t('set_motion'), t('set_motion_d'), h('button', { class: 'toggle', onclick: async () => { await saveSettings({ motion: S.settings.motion === false }); motion.classList.toggle('on', S.settings.motion !== false); } }, motion)),
        row(t('set_perm'), t('set_perm_d'), h('button', { class: 'btn sm', onclick: () => B.openFolder() }, t('open_folder'))),
        row(t('set_restore'), t('set_restore_d') + ' ' + t('shortcut_restore'), h('button', { class: 'btn sm', onclick: restoreFlow }, svgI(IC.reset), t('restore_quick'))),
        row(t('set_about'), `CURSORA ${S.info.version || ''}`, h('button', { class: 'btn sm', onclick: () => B.url(S.info.repo) }, 'GitHub'), h('button', { class: 'btn sm', onclick: support }, '☕ ' + t('support'))),
        h('div', { class: 'set-row', style: { display: 'block' } }, h('div', { class: 't' }, t('set_credits')), h('div', { class: 'd' }, t('set_credits_d')),
          h('div', { class: 'credits' }, S.packs.map(p => h('div', { class: 'credit' }, h('b', {}, p.name), h('span', {}, p.author + ' · ' + p.license + ' · '), h('a', { href: '#', onclick: e => { e.preventDefault(); B.url(p.url); } }, 'GitHub')))))));
    const d = () => (S.settings.applied && S.settings.applied.design) || null;
    $$('button', root).forEach(b => bindCursor(b, d, 'Hand'));
  }
  async function setLang(l) { S.lang = l; await saveSettings({ lang: l }); applyLang(); }
  const support = () => B.url((S.info.supportUrl && S.info.supportUrl[S.lang]) || 'https://7krh-hub.pages.dev/ar/support/');

  /* ---------------- self-test (CI) ---------------- */
  async function selftest() {
    const rep = { ok: true, checks: [] };
    try {
      // glow (canvas padding), a smaller Hand taken from another pack, and a resized IBeam
      const d = E.newDesign('bibata-modern', 'classic'); d.name = 'SelfTest'; d.global = { size: 48, outline: 1, glow: true, glowColor: '#a5b4fc' };
      d.roles = { Hand: { pack: 'apple', variant: 'black', params: { own: 0.7 } }, IBeam: { params: { own: 1.3 } } };
      const C = E.canvasSize(d); rep.canvas = C; rep.size = C;
      const files = await E.buildFiles(d);
      for (const f of files) {
        const dec = await E.decodeAny(f.bytes);
        const r = await E.renderRole(d, f.role, 48);
        // the decoder returns the largest image of each file (a multiple of the base size C); compare proportionally
        const w = dec.frames[0].width, k = w / C;
        const ok = dec.frames.length === r.frames.length && dec.frames[0].height === w && Number.isInteger(k) && k >= 1 &&
          Math.abs(dec.hot[0] * w - r.hot[0] * k) <= 1.5 * k && Math.abs(dec.hot[1] * w - r.hot[1] * k) <= 1.5 * k;
        rep.checks.push({ role: f.role, ext: f.ext, bytes: f.bytes.length, frames: dec.frames.length, w, ok });
        if (!ok) rep.ok = false;
      }
      // the glow must stay inside the canvas: no opaque pixels on the outer border
      const g = await E.renderRole(d, 'Arrow', 48); const gx = g.frames[0].getContext('2d').getImageData(0, 0, C, C).data;
      let edge = 0; for (let i = 0; i < C; i++) for (const [x, y] of [[i, 0], [i, C - 1], [0, i], [C - 1, i]]) edge = Math.max(edge, gx[(y * C + x) * 4 + 3]);
      rep.glowEdgeAlpha = edge; if (edge > 8) rep.ok = false;
      let packsOk = 0;
      for (const p of S.packs) for (const v of p.variants) { const dd = E.newDesign(p.id, v.id); for (const r of E.ROLES) await E.renderRole(dd, r, 32); packsOk++; }
      rep.variantsRendered = packsOk;
      rep.files = files;
      // plain designs at common sizes, dumped for the Windows size measurement in CI
      rep.extra = [];
      for (const [name, pack, variant, size] of [['bibata32', 'bibata-modern', 'classic', 32], ['bibata48', 'bibata-modern', 'classic', 48], ['breezex32', 'breezex', 'black', 32], ['fluent32', 'fluent', 'dark', 32]]) {
        const dd = E.newDesign(pack, variant); dd.global = { size }; dd.name = name;
        rep.extra.push({ name, size: E.canvasSize(dd), files: await E.buildFiles(dd) });
      }
    } catch (e) { rep.ok = false; rep.error = String(e && e.stack || e); }
    await B.selftestReport(rep);
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    [S.settings, S.mine, S.info] = await Promise.all([B.settings.get(), B.mine.get(), B.info()]);
    S.lang = S.settings.lang || 'ar';
    const ap = S.settings.applied && S.settings.applied.design;
    if (ap && ap.global && ap.global.size) S.sysSize = ap.global.size; // registry size may include glow padding
    else B.current().then(c => { const n = +(c && c.CursorBaseSize); if (n >= 32 && n <= 256) S.sysSize = n; }).catch(() => {});
    applyTheme();
    S.packs = await E.loadIndex('../packs/');
    $$('[data-win]').forEach(b => b.addEventListener('click', () => B.win(b.dataset.win)));
    window.addEventListener('blur', () => document.body.classList.add('blurred')); window.addEventListener('focus', () => document.body.classList.remove('blurred'));
    $('#coffee').addEventListener('click', support);
    $('#langBtn').addEventListener('click', () => setLang(S.lang === 'ar' ? 'en' : 'ar'));
    $$('#nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
    $('#search').addEventListener('input', e => { S.q = e.target.value; renderLibrary(); });
    $('#surprise').addEventListener('click', () => { const p = S.packs[Math.floor(Math.random() * S.packs.length)]; openPack(p.id, p.variants[Math.floor(Math.random() * p.variants.length)].id); });
    $('#quickRestore').addEventListener('click', restoreFlow);
    $('#impDesign').addEventListener('click', importDesign); $('#impFolder').addEventListener('click', importFolder);
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); go('library'); $('#search').focus(); }
      else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); B.restore('windows').then(async () => { S.settings = await B.settings.get(); renderNow(); renderLibrary(); toast(t('restored_ok')); }).catch(err => toast(t('err', { e: err.message || err }), null, true)); }
      else if (S.view === 'studio' && e.ctrlKey && e.key.toLowerCase() === 'z' && !(document.activeElement.tagName === 'INPUT' && /^(text|search|)$/.test(document.activeElement.type))) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (S.view === 'studio' && e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (S.view === 'studio' && e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveMine(); }
      else if (e.key === 'Escape' && S.view === 'pack') go('library');
    });
    window.addEventListener('resize', movePill);
    updateMineCount();
    applyLang(); go('library');
    // the app's own cursor follows the applied design
    const appliedDesign = () => (S.settings.applied && S.settings.applied.design) || null;
    bindCursor($('.sidebar'), appliedDesign, 'Arrow'); $$('.sidebar button, .titlebar button').forEach(b => bindCursor(b, appliedDesign, 'Hand'));
    if (new URLSearchParams(location.search).get('selftest')) selftest();
  }
  window.__cursora = { S, go, openPack, startStudio, renderStudio, setParam, E };
  boot().catch(e => { console.error(e); document.body.append(h('pre', { style: { position: 'fixed', bottom: 0, color: '#f87171', zIndex: 999 } }, String(e.stack || e))); });
})();
