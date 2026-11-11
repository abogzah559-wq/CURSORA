/* CURSORA engine — renders cursor packs with live customisation and encodes Windows .cur / .ani files.
   Runs in the renderer (browser) so the preview and the files written to Windows are pixel-identical. */
(function () {
  'use strict';

  const ROLES = ['Arrow', 'Help', 'AppStarting', 'Wait', 'Crosshair', 'IBeam', 'NWPen', 'No', 'SizeNS', 'SizeWE',
    'SizeNWSE', 'SizeNESW', 'SizeAll', 'UpArrow', 'Hand', 'Pin', 'Person'];
  const ROLE_INFO = {
    Arrow: { ar: 'السهم العادي', en: 'Normal select' },
    Help: { ar: 'المساعدة', en: 'Help select' },
    AppStarting: { ar: 'يعمل في الخلفية', en: 'Working in background' },
    Wait: { ar: 'مشغول', en: 'Busy' },
    Crosshair: { ar: 'تحديد دقيق', en: 'Precision select' },
    IBeam: { ar: 'الكتابة', en: 'Text select' },
    NWPen: { ar: 'الكتابة بالقلم', en: 'Handwriting' },
    No: { ar: 'غير متاح', en: 'Unavailable' },
    SizeNS: { ar: 'تحجيم عمودي', en: 'Vertical resize' },
    SizeWE: { ar: 'تحجيم أفقي', en: 'Horizontal resize' },
    SizeNWSE: { ar: 'تحجيم قطري ١', en: 'Diagonal resize 1' },
    SizeNESW: { ar: 'تحجيم قطري ٢', en: 'Diagonal resize 2' },
    SizeAll: { ar: 'تحريك', en: 'Move' },
    UpArrow: { ar: 'اختيار بديل', en: 'Alternate select' },
    Hand: { ar: 'الروابط', en: 'Link select' },
    Pin: { ar: 'تحديد مكان', en: 'Location select' },
    Person: { ar: 'تحديد شخص', en: 'Person select' },
  };
  const ANIMATED = new Set(['AppStarting', 'Wait']);
  const BASE_SIZE = 32;        // all pixel-based params are expressed at 32 px and scaled
  const MAX_FRAMES = 36;

  const DEFAULTS = {
    size: 32, scale: 1, own: 1, mirror: false, opacity: 1,
    recolor: false, fill: '#000000', edge: '#ffffff', accent: '#000000',
    gradient: false, fill2: '#6366f1', angle: 135,
    outline: 0, outlineColor: '#ffffff',
    shadow: true, shadowBlur: 2.5, shadowX: 0.6, shadowY: 1.4, shadowOpacity: 0.45, shadowColor: '#000000',
    glow: false, glowMode: 'circle', glowPos: 'center', glowColor: '#ffffff', glowBlur: 16, glowStrength: 1.6, glowSoft: 0.75,
    speed: 1,
  };

  let BASE = 'packs/';
  const cache = { packs: {}, text: {}, img: {}, render: new Map() };

  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hexRgb = h => { h = String(h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h.slice(0, 6), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };

  async function fetchText(url) {
    if (cache.text[url]) return cache.text[url];
    const r = await fetch(url); if (!r.ok) throw new Error('load ' + url);
    return (cache.text[url] = await r.text());
  }
  async function fetchJSON(url) { return JSON.parse(await fetchText(url)); }

  let ALIASES = {};
  async function loadIndex(base) {
    if (base) BASE = base;
    const idx = await fetchJSON(BASE + 'index.json');
    const ids = Array.isArray(idx) ? idx : idx.packs; ALIASES = (idx && idx.aliases) || {};
    return Promise.all(ids.map(getPack));
  }
  async function getPack(id) {
    if (cache.packs[id]) return cache.packs[id];
    if (ALIASES[id]) return getPack(ALIASES[id]);
    const p = await fetchJSON(BASE + id + '/pack.json');
    p.base = BASE + id + '/';
    return (cache.packs[id] = p);
  }
  const registerPack = p => { cache.packs[p.id] = p; return p; };   // user-imported packs (data URLs)

  /* ---------------- SVG preparation ---------------- */
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function gradientDefs(svgText, from, to, angle) {
    const tag = (svgText.match(/<svg[\s\S]*?>/) || [''])[0];
    let vb = (tag.match(/viewBox="([^"]+)"/) || [])[1];
    let [x, y, w, h] = vb ? vb.trim().split(/[\s,]+/).map(Number) : [0, 0, parseFloat((tag.match(/\swidth="([\d.]+)/) || [0, 32])[1]), parseFloat((tag.match(/\sheight="([\d.]+)/) || [0, 32])[1])];
    const a = angle * Math.PI / 180, cx = x + w / 2, cy = y + h / 2, r = Math.max(w, h) / 2;
    const x1 = cx - Math.cos(a) * r, y1 = cy - Math.sin(a) * r, x2 = cx + Math.cos(a) * r, y2 = cy + Math.sin(a) * r;
    return `<defs><linearGradient id="cursoraGrad" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`;
  }

  // Applies colour tokens (packs that ship colour-keyed templates) and normalises the root size.
  function prepareSvg(text, pack, variant, p, size) {
    let s = text;
    if (pack.kind === 'tokens') {
      const vc = (variant && variant.colors) || {};
      const tokens = pack.tokens || {};
      const pick = k => (p.recolor && p[k] ? p[k] : vc[k]);
      let fill = pick('fill');
      if (p.recolor && p.gradient) fill = 'url(#cursoraGrad)';
      for (const k of Object.keys(tokens)) {
        let val = k === 'fill' ? fill : k === 'accent' ? (pick('accent') || vc.fill) : (/^edge/.test(k) ? pick('edge') : /^fill/.test(k) ? pick('fill') : vc[k]);
        if (val == null) continue;
        s = s.replace(new RegExp(escRe(tokens[k]), 'gi'), val);
      }
      if (p.recolor && p.gradient) s = s.replace(/(<svg[\s\S]*?>)/, m => m + gradientDefs(s, p.fill, p.fill2, p.angle));
    }
    // normalise root size so the browser rasterises the vector directly at the requested size
    s = s.replace(/<svg([\s\S]*?)>/, (m, attrs) => {
      let vb = (attrs.match(/viewBox="([^"]+)"/) || [])[1];
      const w = parseFloat((attrs.match(/\swidth="([\d.]+)/) || [])[1]);
      const h = parseFloat((attrs.match(/\sheight="([\d.]+)/) || [])[1]);
      if (!vb) vb = `0 0 ${w || 32} ${h || w || 32}`;
      attrs = attrs.replace(/\s(width|height)="[^"]*"/g, '').replace(/viewBox="[^"]*"/, '');
      return `<svg${attrs} viewBox="${vb}" width="${size}" height="${size}">`;
    });
    return s;
  }

  // Decoded images are reused: dragging a shadow/glow slider re-renders with the very same source image.
  const imgCache = new Map();
  function loadImage(src) {
    const hit = imgCache.get(src);
    if (hit) { imgCache.delete(src); imgCache.set(src, hit); return hit; }
    const job = new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + src.slice(0, 80))); im.src = src; });
    imgCache.set(src, job); job.catch(() => imgCache.delete(src));
    if (imgCache.size > 600) imgCache.delete(imgCache.keys().next().value);
    return job;
  }
  const svgUrl = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);

  /* ---------------- spinner frames (packs that rotate one element) ---------------- */
  let measureHost = null;
  function spinFrames(svgText, id, n) {
    if (!measureHost) { measureHost = document.createElement('div'); measureHost.style.cssText = 'position:fixed;left:-9999px;top:0;width:256px;height:256px;visibility:hidden'; document.body.appendChild(measureHost); }
    measureHost.innerHTML = svgText;
    const svg = measureHost.querySelector('svg'); const el = svg && svg.querySelector('#' + id);
    if (!el) return [svgText];
    const b = el.getBBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const orig = el.getAttribute('transform') || '';
    const out = [];
    for (let i = 0; i < n; i++) { el.setAttribute('transform', `rotate(${(360 / n) * i} ${cx} ${cy}) ${orig}`); out.push(svg.outerHTML); }
    measureHost.innerHTML = '';
    return out;
  }

  /* ---------------- badges for roles a pack does not ship ---------------- */
  function drawBadge(ctx, kind, S, fill, edge, t) {
    const r = S * 0.2, cx = S * 0.72, cy = S * 0.72, lw = Math.max(1, S / 22);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (kind === 'busy') {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke();
      ctx.beginPath(); const a = (t || 0) * Math.PI * 2; ctx.arc(cx, cy, r * 0.55, a, a + Math.PI * 1.3); ctx.lineWidth = lw * 1.6; ctx.strokeStyle = edge; ctx.stroke();
    } else if (kind === 'help') {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke();
      ctx.fillStyle = edge; ctx.font = `700 ${Math.round(r * 1.5)}px "Segoe UI", Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', cx, cy + r * 0.06);
    } else if (kind === 'pin') {
      ctx.beginPath(); ctx.moveTo(cx, cy + r * 1.15);
      ctx.bezierCurveTo(cx - r * 1.1, cy - r * 0.05, cx - r * 0.95, cy - r * 1.1, cx, cy - r * 1.1);
      ctx.bezierCurveTo(cx + r * 0.95, cy - r * 1.1, cx + r * 1.1, cy - r * 0.05, cx, cy + r * 1.15);
      ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.35, r * 0.32, 0, Math.PI * 2); ctx.fillStyle = edge; ctx.fill();
    } else if (kind === 'person') {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - lw / 2, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = edge; ctx.beginPath(); ctx.arc(cx, cy - r * 0.22, r * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.72, r * 0.62, r * 0.48, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore();
  }

  /* ---------------- source resolution ---------------- */
  function variantOf(pack, vid) { return pack.variants.find(v => v.id === vid) || pack.variants.find(v => vid && v.id.endsWith('-' + vid)) || pack.variants[0]; }
  function swatch(pack, variant, p) {
    if (p.recolor) return [p.fill, p.edge];
    if (variant.colors) return [variant.colors.fill, variant.colors.edge];
    return variant.swatch || ['#000', '#fff'];
  }

  // Returns { frames: [ {url, isSvg} ], delay, hot:[nx,ny], badge?, rotateUp? }
  async function resolveSource(pack, variant, role, p, size, depth = 0) {
    const spec = pack.roles[role];
    if (!spec || depth > 3) return null;
    if (spec.ref) {
      const r = await resolveSource(pack, variant, spec.ref, p, size, depth + 1);
      return r && { ...r, bbox: pack.bbox && pack.bbox[spec.ref] };
    }
    if (spec.compose) {
      const r = await resolveSource(pack, variant, spec.compose, p, size, depth + 1);
      return r && { ...r, badge: spec.badge, animated: spec.badge === 'busy', bbox: pack.bbox && pack.bbox[spec.compose] };
    }
    const dir = pack.kind === 'tokens' ? pack.dir : (variant.dir || variant.id);
    const files = spec.frames || [spec.src];
    const out = [];
    const isSvg = f => /\.svg$/i.test(f);
    let list = files;
    if (list.length > MAX_FRAMES) { const step = list.length / MAX_FRAMES; list = Array.from({ length: MAX_FRAMES }, (_, i) => files[Math.floor(i * step)]); }
    for (const f of list) {
      const url = /^data:/.test(f) ? f : pack.base + dir + '/' + f;
      if (isSvg(f) || /^data:image\/svg/.test(f)) {
        const txt = /^data:/.test(f) ? decodeURIComponent(f.split(',')[1]) : await fetchText(url);
        if (spec.spin) { for (const fr of spinFrames(prepareSvg(txt, pack, variant, p, size), spec.spin, spec.spinFrames || 30)) out.push({ url: svgUrl(fr), isSvg: true }); }
        else out.push({ url: svgUrl(prepareSvg(txt, pack, variant, p, size)), isSvg: true });
      } else out.push({ url, isSvg: false });
    }
    const delay = (spec.delay || 40) * (files.length / list.length);
    return { frames: out, delay: spec.spin ? (spec.delay || 33) : delay, hot: spec.hot || [0, 0], bbox: pack.bbox && pack.bbox[role] };
  }

  /* ---------------- pixel pipeline ---------------- */
  function luminance(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

  function recolorPixels(ctx, S, p, polarity) {
    const img = ctx.getImageData(0, 0, S, S), d = img.data;
    const f1 = hexRgb(p.fill), f2 = hexRgb(p.gradient ? p.fill2 : p.fill), e = hexRgb(p.edge);
    const a = p.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4; if (!d[i + 3]) continue;
      let L = luminance(d[i], d[i + 1], d[i + 2]);
      if (polarity === 'light') L = 1 - L;
      const tg = clamp(0.5 + (((x / S) - 0.5) * ca + ((y / S) - 0.5) * sa), 0, 1);
      const fr = f1[0] + (f2[0] - f1[0]) * tg, fg = f1[1] + (f2[1] - f1[1]) * tg, fb = f1[2] + (f2[2] - f1[2]) * tg;
      d[i] = fr + (e[0] - fr) * L; d[i + 1] = fg + (e[1] - fg) * L; d[i + 2] = fb + (e[2] - fb) * L;
    }
    ctx.putImageData(img, 0, 0);
  }

  function silhouette(src, color) {
    const c = mkCanvas(src.width, src.height), x = c.getContext('2d');
    x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // Draws one frame at size S. Returns { canvas, hot:[px,py] }.
  // S = size of the shape box, C = size of the output canvas (larger than S when a glow needs room around the shape)
  async function drawFrame(frame, src, pack, variant, p, S, C, t) {
    const k = S / BASE_SIZE, off = (C - S) / 2;
    const fit = (pack.fit || 1) * (p.scale || 1), own = p.own || 1;
    const hot = src.hot;
    // keep the shape (plus the room its effects need) inside the canvas, anchored on the hotspot
    const ow = p.outline || 0;
    const sb = p.shadow ? p.shadowBlur * 0.7 : 0;
    const mL = (ow + Math.max(0, sb - p.shadowX)) * k, mT = (ow + Math.max(0, sb - p.shadowY)) * k;
    const mR = (ow + Math.max(0, sb + p.shadowX)) * k, mB = (ow + Math.max(0, sb + p.shadowY)) * k;
    let scale = fit * own;
    const bb = src.bbox; // normalised alpha bbox of the source at scale 1
    if (bb) {
      const hx = hot[0] * S, hy = hot[1] * S;
      // a side with no room (shape starts right at the hotspot, e.g. an arrow tip in the corner) can't be helped by
      // shrinking, so it must not shrink the whole shape either
      const need = (room, extent) => (extent > 0.5 && room > 0 ? room / extent : 99);
      const limit = (l, t, r, b) => Math.min(need(hx - l, hx - bb[0] * S), need(S - r - hx, bb[2] * S - hx), need(hy - t, hy - bb[1] * S), need(S - b - hy, bb[3] * S - hy));
      const base = Math.max(Math.min(fit, limit(mL, mT, mR, mB)), fit * 0.8);
      // "own" (size of this shape only) scales on top; enlarging may use the whole frame, up to its edges
      scale = own > 1 ? Math.max(base, Math.min(base * own, limit(0, 0, 0, 0))) : base * own;
    }
    scale = clamp(scale, 0.2, 3);
    const hpx = hot[0] * S, hpy = hot[1] * S;

    // 1) base shape
    const im = await loadImage(frame.url);
    const base = mkCanvas(C), bx = base.getContext('2d');
    bx.imageSmoothingQuality = 'high';
    bx.translate(off, off);
    bx.translate(hpx, hpy); bx.scale(scale, scale); bx.translate(-hpx, -hpy);
    bx.drawImage(im, 0, 0, S, S);
    bx.setTransform(1, 0, 0, 1, 0, 0);
    if (src.badge) { const [f, e] = swatch(pack, variant, p); bx.translate(off, off); drawBadge(bx, src.badge, S, f, e, t); bx.setTransform(1, 0, 0, 1, 0, 0); }

    // 2) pixel recolour for packs without colour tokens
    if (p.recolor && pack.kind !== 'tokens') recolorPixels(bx, C, p, variant.polarity || 'dark');

    // 3) compose effects
    const out = mkCanvas(C), ox = out.getContext('2d');
    let shape = base;
    if (p.outline > 0) {
      const sil = silhouette(base, p.outlineColor); const w = p.outline * k;
      const c = mkCanvas(C), cx = c.getContext('2d');
      const steps = Math.max(12, Math.ceil(w * 8));
      for (let rr = w; rr > 0; rr -= Math.max(0.5, w / 3)) for (let i = 0; i < steps; i++) { const a = i / steps * Math.PI * 2; cx.drawImage(sil, Math.cos(a) * rr, Math.sin(a) * rr); }
      cx.drawImage(base, 0, 0); shape = c;
    }
    if (p.glow && p.glowMode === 'shape') {
      // a halo that hugs the outline: widen the silhouette, blur it
      const reach = p.glowBlur * k, soft = clamp(p.glowSoft == null ? 0.7 : p.glowSoft, 0, 1);
      const dil = reach * (1 - soft) * 0.6, sigma = Math.max(0.4, (reach - dil) / 2.6);
      let g = silhouette(shape, p.glowColor);
      if (dil >= 0.5) {
        const w = mkCanvas(C), wx = w.getContext('2d'); const steps = Math.max(16, Math.ceil(dil * 6));
        for (let rr = dil; rr > 0; rr -= Math.max(0.75, dil / 4)) for (let i = 0; i < steps; i++) { const a = i / steps * Math.PI * 2; wx.drawImage(g, Math.cos(a) * rr, Math.sin(a) * rr); }
        wx.drawImage(g, 0, 0); g = w;
      }
      const gl = mkCanvas(C), gx = gl.getContext('2d'); gx.filter = `blur(${sigma}px)`; gx.drawImage(g, 0, 0);
      ox.save(); for (let st = p.glowStrength; st > 0.01; st -= 1) { ox.globalAlpha = Math.min(1, st); ox.drawImage(gl, 0, 0); } ox.restore();
    } else if (p.glow) {
      // a round disc of light behind the cursor (default): centred on the shape, or on the hotspot ("tip")
      const [cx, cy] = p.glowPos === 'tip' ? [off + hpx, off + hpy] : glowCenter(src, base, C);
      // never let the disc reach the frame edge, so it always stays a clean circle
      const R = Math.max(1, Math.min(glowRadius(p, S), cx - 1, cy - 1, C - cx - 1, C - cy - 1)), soft = clamp(p.glowSoft == null ? 0.7 : p.glowSoft, 0, 1);
      const [r, g, b] = hexRgb(p.glowColor);
      const a = clamp(p.glowStrength, 0, 3) / 3; // brightness 0..300% → peak opacity
      const core = Math.min(1, a * 1.15), inner = R * (1 - soft) * 0.92;
      const gr = ox.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, `rgba(${r},${g},${b},${core})`);
      gr.addColorStop(Math.max(0.001, inner / R), `rgba(${r},${g},${b},${core})`);
      // smooth fall-off (eased) between the solid core and the rim
      for (let i = 1; i <= 6; i++) { const u = i / 6, pos = inner / R + (1 - inner / R) * u; const e = Math.pow(1 - u, 2.2); gr.addColorStop(Math.min(1, pos), `rgba(${r},${g},${b},${core * e})`); }
      ox.save(); ox.fillStyle = gr; ox.beginPath(); ox.arc(cx, cy, R, 0, Math.PI * 2); ox.fill(); ox.restore();
    }
    if (p.shadow) {
      const [r, g, b] = hexRgb(p.shadowColor);
      ox.save(); ox.shadowColor = `rgba(${r},${g},${b},${p.shadowOpacity})`; ox.shadowBlur = p.shadowBlur * k * 2;
      ox.shadowOffsetX = p.shadowX * k * (p.mirror ? -1 : 1); ox.shadowOffsetY = p.shadowY * k;
      ox.drawImage(shape, 0, 0); ox.restore();
    } else ox.drawImage(shape, 0, 0);

    // 4) opacity + mirror
    let fin = out;
    if (p.opacity < 1 || p.mirror) {
      fin = mkCanvas(C); const fx = fin.getContext('2d');
      if (p.mirror) { fx.translate(C, 0); fx.scale(-1, 1); }
      fx.globalAlpha = p.opacity; fx.drawImage(out, 0, 0);
    }
    let hx = Math.round(off + hpx), hy = Math.round(off + hpy);
    if (p.mirror) hx = C - 1 - hx;
    return { canvas: fin, hot: [clamp(hx, 0, C - 1), clamp(hy, 0, C - 1)] };
  }

  // Radius of the round glow in canvas pixels: glowBlur is the disc *diameter* as a multiple of the shape box ×10
  // (slider "size"), so 10 = as wide as the cursor box, 20 = twice as wide.
  function glowRadius(p, S) { return Math.max(1, (p.glowBlur / 10) * S / 2); }
  // Centre of the visible shape (first frame of each role is enough; animated frames share the same box).
  function glowCenter(src, canvas, C) {
    if (src._gc && src._gc[0] === C) return src._gc[1];
    const px = canvas.getContext('2d').getImageData(0, 0, C, C).data; let x0 = C, y0 = C, x1 = -1, y1 = -1;
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) if (px[(y * C + x) * 4 + 3] > 30) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const c = x1 < 0 ? [C / 2, C / 2] : [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2];
    src._gc = [C, c]; return c;
  }

  // Effective params for a role inside a design.
  function paramsFor(design, role) {
    const g = { ...DEFAULTS, ...(design.global || {}) };
    const o = (design.roles && design.roles[role]) || {};
    return { ...g, ...(o.params || {}), size: g.size };
  }
  function sourceFor(design, role) {
    const o = (design.roles && design.roles[role]) || {};
    return { pack: o.pack || design.pack, variant: o.pack ? o.variant : (o.variant || design.variant) };
  }

  // A glow needs empty room around the shape. The whole design shares one canvas/shape ratio, because Windows
  // has a single cursor size: the canvas grows (to a multiple of 16) and the shape keeps its on-screen size.
  function layout(design, size) {
    const S0 = { ...DEFAULTS, ...(design.global || {}) }.size; size = size || S0;
    let need = 1;
    for (const role of ROLES) {
      const p = paramsFor(design, role); if (!p.glow) continue;
      // the shape-hugging halo needs a margin; the round disc needs its diameter (it may sit off-centre at the tip)
      if (p.glowMode === 'shape') need = Math.max(need, 1 + 2 * (p.glowBlur * 1.2 + 1) / BASE_SIZE);
      // the disc is centred on the visible shape (up to ~0.2 box off the box centre) or on the hotspot (up to 0.5)
      else need = Math.max(need, p.glowBlur / 10 + (p.glowPos === 'tip' ? 1 : 0.4));
    }
    if (need <= 1) return { canvas: size, shape: size };
    const C0 = Math.min(256, Math.ceil(S0 * need / 16) * 16);
    const canvas = Math.max(8, Math.round(size * C0 / S0));
    return { canvas, shape: Math.min(size, canvas / need) };
  }
  const canvasSize = design => layout(design).canvas;

  // Render a role → { frames:[canvas], delays:[ms], hot:[x,y], animated }. `size` is the shape size; the canvas may be larger.
  async function renderRole(design, role, size) {
    const p = paramsFor(design, role); const lay = layout(design, size || p.size); const S = lay.shape, C = lay.canvas;
    const sref = sourceFor(design, role);
    const key = JSON.stringify([sref, role, p, S, C]);
    if (cache.render.has(key)) return cache.render.get(key);
    const job = (async () => {
      const pack = await getPack(sref.pack); const variant = variantOf(pack, sref.variant);
      const src = await resolveSource(pack, variant, role, p, S);
      if (!src) throw new Error('missing role ' + role);
      const frames = [], delays = [];
      let hot = [0, 0];
      const count = src.badge === 'busy' ? 24 : src.frames.length;
      const done = await Promise.all(Array.from({ length: count }, (_, i) =>
        drawFrame(src.frames[Math.min(i, src.frames.length - 1)], src, pack, variant, p, S, C, i / count)));
      for (const r of done) { frames.push(r.canvas); hot = r.hot; delays.push(src.badge === 'busy' ? 42 / p.speed : src.delay / p.speed); }
      return { frames, delays, hot, animated: frames.length > 1 };
    })();
    cache.render.set(key, job);
    if (cache.render.size > 1500) cache.render.delete(cache.render.keys().next().value);
    job.catch(() => cache.render.delete(key));
    return job;
  }

  /* ---------------- encoders ---------------- */
  function u16(a, o, v) { a[o] = v & 255; a[o + 1] = v >> 8 & 255; }
  function u32(a, o, v) { a[o] = v & 255; a[o + 1] = v >> 8 & 255; a[o + 2] = v >> 16 & 255; a[o + 3] = v >>> 24 & 255; }

  function dib(canvas) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const maskRow = Math.ceil(w / 32) * 4;
    const out = new Uint8Array(40 + w * h * 4 + maskRow * h);
    u32(out, 0, 40); u32(out, 4, w); u32(out, 8, h * 2); u16(out, 12, 1); u16(out, 14, 32); u32(out, 16, 0); u32(out, 20, w * h * 4 + maskRow * h);
    let o = 40;
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; out[o++] = px[i + 2]; out[o++] = px[i + 1]; out[o++] = px[i]; out[o++] = px[i + 3];
    }
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] === 0) out[o + (x >> 3)] |= 0x80 >> (x & 7);
      if (x === w - 1) o += maskRow;
    }
    return out;
  }

  // images: [{canvas, hot:[x,y]}]
  function encodeCur(images) {
    const blobs = images.map(im => dib(im.canvas));
    const total = 6 + 16 * images.length + blobs.reduce((s, b) => s + b.length, 0);
    const out = new Uint8Array(total);
    u16(out, 0, 0); u16(out, 2, 2); u16(out, 4, images.length);
    let off = 6 + 16 * images.length;
    images.forEach((im, i) => {
      const e = 6 + i * 16, w = im.canvas.width, h = im.canvas.height;
      out[e] = w >= 256 ? 0 : w; out[e + 1] = h >= 256 ? 0 : h; out[e + 2] = 0; out[e + 3] = 0;
      u16(out, e + 4, im.hot[0]); u16(out, e + 6, im.hot[1]); u32(out, e + 8, blobs[i].length); u32(out, e + 12, off);
      out.set(blobs[i], off); off += blobs[i].length;
    });
    return out;
  }

  function chunk(id, data) {
    const pad = data.length & 1;
    const out = new Uint8Array(8 + data.length + pad);
    for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
    u32(out, 4, data.length); out.set(data, 8); return out;
  }
  function concat(parts) { const n = parts.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
  const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0) & 127);

  // frames: [ [ {canvas, hot} per size ] ], delays ms
  function encodeAni(frames, delays, title) {
    const icons = frames.map(f => chunk('icon', encodeCur(f)));
    const anih = new Uint8Array(36);
    const jif = delays.map(d => clamp(Math.round(d / (1000 / 60)), 1, 255));
    u32(anih, 0, 36); u32(anih, 4, frames.length); u32(anih, 8, frames.length); u32(anih, 28, jif[0]); u32(anih, 32, 1); // AF_ICON only: per-frame timing goes in 'rate', there is no 'seq ' chunk
    const parts = [];
    if (title) parts.push(concat([ascii('LIST'), (() => { const inam = chunk('INAM', ascii(title + '\0')); const b = new Uint8Array(4); u32(b, 0, inam.length + 4); return b; })(), ascii('INFO'), chunk('INAM', ascii(title + '\0'))]));
    parts.push(chunk('anih', anih));
    if (!jif.every(j => j === jif[0])) { const r = new Uint8Array(jif.length * 4); jif.forEach((j, i) => u32(r, i * 4, j)); parts.push(chunk('rate', r)); }
    const fram = concat([ascii('fram'), ...icons]);
    parts.push(concat([ascii('LIST'), (() => { const b = new Uint8Array(4); u32(b, 0, fram.length); return b; })(), fram]));
    const body = concat([ascii('ACON'), ...parts]);
    const hdr = new Uint8Array(8); hdr.set(ascii('RIFF')); u32(hdr, 4, body.length);
    return concat([hdr, body]);
  }

  const sizeSet = S => [...new Set([S, Math.round(S * 1.25), Math.round(S * 1.5), S * 2].map(v => Math.min(256, v)))];

  // Builds every Windows file for a design: [{role, ext, bytes}]
  // Builds every Windows file for a design: [{role, ext, bytes}].
  // Each file holds exactly the pixel sizes Windows will ask for — the cursor size at each display scale in `scales`
  // (1 = 100 %, 1.5 = 150 % …). Offering Windows several unrelated sizes let it pick different ones for different
  // shapes (a giant hand next to a normal arrow), so nothing else goes in.
  async function buildFiles(design, onProgress, scales) {
    const S = { ...DEFAULTS, ...(design.global || {}) }.size;
    const list = [...new Set((scales && scales.length ? scales : [1]).map(k => Math.round(S * k)))].sort((a, b) => a - b);
    const fits = (v, i) => i === 0 || layout(design, v).canvas <= 256;
    const sizes = list.filter(fits), aniSizes = sizes;
    const files = [];
    let n = 0;
    for (const role of ROLES) {
      const per = [];
      const anim = !!(await renderRole(design, role, sizes[0])).animated;
      for (const sz of (anim ? aniSizes : sizes)) per.push(await renderRole(design, role, sz));
      if (per[0].animated) {
        const frames = per[0].frames.map((_, i) => per.map(r => ({ canvas: r.frames[Math.min(i, r.frames.length - 1)], hot: r.hot })));
        files.push({ role, ext: 'ani', bytes: encodeAni(frames, per[0].delays, design.name || 'CURSORA') });
      } else {
        files.push({ role, ext: 'cur', bytes: encodeCur(per.map(r => ({ canvas: r.frames[0], hot: r.hot }))) });
      }
      onProgress && onProgress(++n / ROLES.length, role);
      await new Promise(r => setTimeout(r));
    }
    return files;
  }

  /* ---------------- decoders (importing .cur/.ani/.ico/.png files) ---------------- */
  function rd16(b, o) { return b[o] | b[o + 1] << 8; }
  function rd32(b, o) { return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0; }

  async function decodeIcoEntry(bytes) {
    const n = rd16(bytes, 4); let best = null;
    for (let i = 0; i < n; i++) {
      const e = 6 + i * 16; const w = bytes[e] || 256, h = bytes[e + 1] || 256;
      const hx = rd16(bytes, e + 4), hy = rd16(bytes, e + 6), len = rd32(bytes, e + 8), off = rd32(bytes, e + 12);
      if (!best || w > best.w) best = { w, h, hx, hy, data: bytes.subarray(off, off + len) };
    }
    if (!best) throw new Error('empty');
    const d = best.data; const c = mkCanvas(best.w, best.h); const x = c.getContext('2d');
    if (d[0] === 0x89 && d[1] === 0x50) {
      const im = await loadImage(URL.createObjectURL(new Blob([d], { type: 'image/png' }))); x.drawImage(im, 0, 0, best.w, best.h);
    } else {
      const w = rd32(d, 4), h = rd32(d, 8) / 2, bpp = rd16(d, 14), hdr = rd32(d, 0);
      const img = x.createImageData(w, h); const px = img.data;
      const ncol = bpp <= 8 ? (rd32(d, 32) || 1 << bpp) : 0; const pal = hdr; const dataOff = hdr + ncol * 4;
      const rowBytes = Math.ceil(w * bpp / 32) * 4; const maskOff = dataOff + rowBytes * h; const maskRow = Math.ceil(w / 32) * 4;
      let anyAlpha = false;
      for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
        const row = dataOff + (h - 1 - y) * rowBytes; const i = (y * w + xx) * 4; let r, g, b, a = 255;
        if (bpp === 32) { b = d[row + xx * 4]; g = d[row + xx * 4 + 1]; r = d[row + xx * 4 + 2]; a = d[row + xx * 4 + 3]; if (a) anyAlpha = true; }
        else if (bpp === 24) { b = d[row + xx * 3]; g = d[row + xx * 3 + 1]; r = d[row + xx * 3 + 2]; }
        else { const bit = xx * bpp; const v = (d[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1); b = d[pal + v * 4]; g = d[pal + v * 4 + 1]; r = d[pal + v * 4 + 2]; }
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
      }
      if (bpp !== 32 || !anyAlpha) for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
        const m = d[maskOff + (h - 1 - y) * maskRow + (xx >> 3)] & (0x80 >> (xx & 7)); if (m) px[(y * w + xx) * 4 + 3] = 0;
      }
      x.putImageData(img, 0, 0);
    }
    return { canvas: c, hot: [best.hx / best.w, best.hy / best.h] };
  }

  async function decodeAny(bytes) {
    const id = String.fromCharCode(...bytes.subarray(0, 4));
    if (id === 'RIFF') {
      const frames = []; let rate = 6, rates = null;
      const walk = (o, end) => {
        while (o + 8 <= end) {
          const cid = String.fromCharCode(...bytes.subarray(o, o + 4)); const len = rd32(bytes, o + 4); const body = o + 8;
          if (cid === 'LIST') walk(body + 4, body + len);
          else if (cid === 'anih') rate = rd32(bytes, body + 28) || 6;
          else if (cid === 'rate') { rates = []; for (let i = 0; i < len / 4; i++) rates.push(rd32(bytes, body + i * 4)); }
          else if (cid === 'icon') frames.push(bytes.subarray(body, body + len));
          o = body + len + (len & 1);
        }
      };
      walk(12, bytes.length);
      const dec = []; for (const f of frames) dec.push(await decodeIcoEntry(f));
      return { frames: dec.map(d => d.canvas), hot: dec[0].hot, delays: dec.map((_, i) => ((rates && rates[i]) || rate) * 1000 / 60) };
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const im = await loadImage(URL.createObjectURL(new Blob([bytes], { type: 'image/png' })));
      const c = mkCanvas(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0); return { frames: [c], hot: [0, 0], delays: [0] };
    }
    const r = await decodeIcoEntry(bytes); return { frames: [r.canvas], hot: r.hot, delays: [0] };
  }

  // Turns decoded files into an in-memory pack ({role: decoded}). Frames are stored as PNG data URLs.
  function packFromDecoded(id, name, byRole) {
    const roles = {}; const sq = c => { const S = Math.max(c.width, c.height); const o = mkCanvas(S); o.getContext('2d').drawImage(c, 0, 0); return o; };
    for (const [role, d] of Object.entries(byRole)) {
      const urls = d.frames.map(c => sq(c).toDataURL('image/png'));
      const c0 = d.frames[0], k = Math.max(c0.width, c0.height); const hot = [d.hot[0] * c0.width / k, d.hot[1] * c0.height / k];
      roles[role] = urls.length > 1 ? { frames: urls, delay: d.delays[0] || 50, hot } : { src: urls[0], hot };
    }
    for (const role of ROLES) if (!roles[role]) roles[role] = { ref: roles.Arrow ? 'Arrow' : Object.keys(roles)[0] };
    return registerPack({ id, name, kind: 'files', base: '', fit: 1, user: true, tags: ['mine'], variants: [{ id: 'default', name: 'Default', dir: '', polarity: 'dark', swatch: ['#000', '#fff'] }], roles });
  }

  /* ---------------- helpers for the UI ---------------- */
  function cssCursor(r, frameIndex = 0, max = 128) {
    let c = r.frames[frameIndex % r.frames.length]; let [hx, hy] = r.hot;
    if (c.width > max) { const k = max / c.width; const s = mkCanvas(max); s.getContext('2d').drawImage(c, 0, 0, max, max); c = s; hx = Math.round(hx * k); hy = Math.round(hy * k); }
    return `url(${c.toDataURL('image/png')}) ${hx} ${hy}, auto`;
  }

  // Designs saved before v2 had only the outline-hugging glow (glowBlur in px): keep them looking the same.
  function migrateDesign(d) {
    if (!d || d.v >= 2) return d;
    const fix = o => { if (o && (o.glow != null || o.glowBlur != null) && o.glowMode == null) { o.glowMode = 'shape'; if (o.glowBlur == null) o.glowBlur = 6; if (o.glowColor == null) o.glowColor = '#7dd3fc'; if (o.glowStrength == null) o.glowStrength = 1.3; } };
    fix(d.global); for (const r of Object.values(d.roles || {})) fix(r.params);
    d.v = 2; return d;
  }

  function newDesign(pack, variant) { return { v: 2, name: '', pack, variant, global: {}, roles: {} }; }

  window.CursoraEngine = {
    ROLES, ROLE_INFO, ANIMATED, DEFAULTS, loadIndex, getPack, registerPack, renderRole, buildFiles, encodeCur, encodeAni,
    decodeAny, packFromDecoded, cssCursor, newDesign, migrateDesign, paramsFor, sourceFor, variantOf, clone, sizeSet, layout, canvasSize,
    clearCache: () => cache.render.clear(),
  };
})();
