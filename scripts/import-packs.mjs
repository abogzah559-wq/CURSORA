// CURSORA pack importer.
// Reads open-source cursor theme sources (cloned into SRC) and normalises them
// into packs/<id>/pack.json + the SVG/PNG files needed for the 17 Windows roles.
// Usage: node scripts/import-packs.mjs <sources-dir>
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.argv[2] || '../src');
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'packs');

export const ROLES = ['Arrow', 'Help', 'AppStarting', 'Wait', 'Crosshair', 'IBeam', 'NWPen', 'No', 'SizeNS', 'SizeWE',
  'SizeNWSE', 'SizeNESW', 'SizeAll', 'UpArrow', 'Hand', 'Pin', 'Person'];

const CANDIDATES = {
  Arrow: ['left_ptr', 'default', 'arrow', 'top_left_arrow'],
  Help: ['question_arrow', 'help', 'left_ptr_help', 'whats_this'],
  AppStarting: ['left_ptr_watch', 'progress'],
  Wait: ['wait', 'watch'],
  Crosshair: ['crosshair', 'cross', 'tcross'],
  IBeam: ['xterm', 'text', 'ibeam'],
  NWPen: ['pencil', 'draft', 'pen'],
  No: ['circle', 'not-allowed', 'crossed_circle', 'no-drop', 'forbidden', 'dnd_no_drop'],
  SizeNS: ['sb_v_double_arrow', 'size_ver', 'ns-resize', 'v_double_arrow', 'row-resize'],
  SizeWE: ['sb_h_double_arrow', 'size_hor', 'ew-resize', 'h_double_arrow', 'col-resize'],
  SizeNWSE: ['size_fdiag', 'nwse-resize', 'bd_double_arrow'],
  SizeNESW: ['size_bdiag', 'nesw-resize', 'fd_double_arrow'],
  SizeAll: ['fleur', 'move', 'size_all', 'all-scroll'],
  UpArrow: ['center_ptr', 'up-arrow', 'up_arrow', 'up', 'sb_up_arrow'],
  Hand: ['hand2', 'pointer', 'pointing_hand', 'hand'],
  Pin: ['pin'],
  Person: ['person'],
};
const ANIMATED = new Set(['AppStarting', 'Wait']);

const r4 = n => Math.round(n * 10000) / 10000;
const exists = p => fs.existsSync(p);
const svgSize = file => {
  const s = fs.readFileSync(file, 'utf8');
  const tag = (s.match(/<svg[\s\S]*?>/) || [''])[0];
  const w = parseFloat((tag.match(/\swidth="([\d.]+)/) || [])[1]);
  if (w) return w;
  const vb = (tag.match(/viewBox="([^"]+)"/) || [])[1];
  return vb ? parseFloat(vb.trim().split(/[\s,]+/)[2]) : 32;
};
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

/* ---------- ful1e5 style: toml configs + colour-key SVG templates ---------- */
function parseToml(file) {
  const out = { fallback: { x: 128, y: 128 }, delay: 40, byName: {} };
  let cur = null;
  const text = fs.readFileSync(file, 'utf8').replace(/=\s*\[([^\]]*)\]/g, (m, a) => '= [' + a.replace(/\s*\n\s*/g, ' ') + ']');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const sec = line.match(/^\[cursors\.(.+)\]$/);
    if (sec) { cur = { key: sec[1], names: [] }; if (sec[1] !== 'fallback_settings') out.list = [...(out.list || []), cur]; continue; }
    if (/^\[/.test(line)) { cur = null; continue; }
    const kv = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (!kv || !cur) continue;
    const [, k, v] = kv;
    if (cur.key === 'fallback_settings') {
      if (k === 'x_hotspot') out.fallback.x = +v; if (k === 'y_hotspot') out.fallback.y = +v;
      if (k === 'x11_delay') out.delay = +v;
    } else {
      if (k === 'png') cur.png = v.replace(/['"]/g, '').replace(/(-\*)?\.png$/, '');
      if (k === 'x_hotspot') cur.x = +v; if (k === 'y_hotspot') cur.y = +v;
      if (k === 'x11_name') cur.names.push(v.replace(/['"]/g, ''));
      if (k === 'x11_symlinks') cur.names.push(...(v.match(/['"]([^'"]+)['"]/g) || []).map(s => s.slice(1, -1)));
    }
  }
  for (const c of out.list || []) {
    const hot = { x: c.x ?? out.fallback.x, y: c.y ?? out.fallback.y, png: c.png };
    for (const n of [c.png, c.key, ...c.names]) if (n && !out.byName[n]) out.byName[n] = hot;
  }
  return out;
}

function importFul1e5({ id, name, repo, svgDir = 'svg', toml, tokens, variants, tags, author, license, desc }) {
  const base = path.join(SRC, repo);
  const conf = parseToml(path.join(base, toml));
  const dir = path.join(base, svgDir);
  const roles = {};
  let canvas = 256;
  for (const f of ['left_ptr.svg', 'default.svg']) if (exists(path.join(dir, f))) { canvas = svgSize(path.join(dir, f)); break; }
  for (const role of ROLES) {
    for (const cand of CANDIDATES[role]) {
      const h = conf.byName[cand];
      const file = h ? h.png : cand;
      if (ANIMATED.has(role)) {
        const fdir = path.join(dir, file);
        if (exists(fdir) && fs.statSync(fdir).isDirectory()) {
          const frames = fs.readdirSync(fdir).filter(f => f.endsWith('.svg')).sort();
          frames.forEach(f => copy(path.join(fdir, f), path.join(OUT, id, 'svg', file, f)));
          const hh = h || conf.fallback;
          roles[role] = { frames: frames.map(f => `${file}/${f}`), delay: conf.delay, hot: [r4(hh.x / canvas), r4(hh.y / canvas)] };
          break;
        }
      } else if (exists(path.join(dir, file + '.svg'))) {
        copy(path.join(dir, file + '.svg'), path.join(OUT, id, 'svg', file + '.svg'));
        const hh = h || conf.fallback;
        roles[role] = { src: `${file}.svg`, hot: [r4(hh.x / canvas), r4(hh.y / canvas)] };
        break;
      }
    }
  }
  return { id, name, author, license, url: `https://github.com/${repo.replace('_', '/')}`, tags, desc, kind: 'tokens', dir: 'svg',
    tokens, variants, roles };
}

/* ---------- xcursorgen-config style (vinceliuice, varlesh, Qogir...) ---------- */
function parseCursorCfg(file, svgW, rule) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim().split(/\s+/)).filter(a => a.length >= 4);
  let best = null;
  for (const [nom, xh, yh, f, delay] of lines) {
    let size = null;
    if (rule === 'scale') { const m = f.match(/^x(\d+)(?:_(\d+))?\//); if (m) size = svgW * parseFloat(m[1] + '.' + (m[2] || '0')); }
    else if (rule === 'dirsize') { const m = f.match(/(\d+)x\d+\//); if (m) size = +m[1]; }
    else if (rule === 'suffix') { const m = f.match(/^[^/]*?_(\d+)\.png$/); if (m && !/_24_\d+\.png$/.test(f)) size = +m[1]; }
    if (size && (!best || size > best.size)) best = { size, x: +xh, y: +yh, delay: delay ? +delay : null };
  }
  return best;
}

function importCfg({ id, name, repo, root, variants, rule, tags, author, license, desc, cfgDir = 'config', frameSep = '-' }) {
  const base = path.join(SRC, repo, root);
  const v0 = path.join(base, variants[0].dir);
  const roles = {};
  for (const role of ROLES) {
    for (const cand of CANDIDATES[role]) {
      const cfg = path.join(base, cfgDir, cand + '.cursor');
      if (ANIMATED.has(role)) {
        const frames = fs.existsSync(v0) ? fs.readdirSync(v0).filter(f => new RegExp(`^${cand}${frameSep}\\d+\\.svg$`).test(f)).sort() : [];
        if (frames.length > 1 && exists(cfg)) {
          const hot = parseCursorCfg(cfg, svgSize(path.join(v0, frames[0])), rule);
          if (!hot) continue;
          roles[role] = { frames, delay: hot.delay || 30, hot: [r4(hot.x / hot.size), r4(hot.y / hot.size)] };
          break;
        }
      } else if (exists(path.join(v0, cand + '.svg')) && exists(cfg)) {
        const hot = parseCursorCfg(cfg, svgSize(path.join(v0, cand + '.svg')), rule);
        if (!hot) continue;
        roles[role] = { src: cand + '.svg', hot: [r4(hot.x / hot.size), r4(hot.y / hot.size)] };
        break;
      }
    }
  }
  const files = new Set(Object.values(roles).flatMap(r => r.frames || [r.src]));
  for (const v of variants) for (const f of files) {
    const from = path.join(base, v.dir, f);
    if (exists(from)) copy(from, path.join(OUT, id, v.id, f));
  }
  return { id, name, author, license, url: `https://github.com/${repo.replace('_', '/')}`, tags, desc, kind: 'files',
    variants: variants.map(v => ({ id: v.id, name: v.name, dir: v.id, polarity: v.polarity, swatch: v.swatch })), roles };
}

/* ---------- Capitaine (spec files, 24 unit grid) ---------- */
function importCapitaine() {
  const id = 'capitaine', base = path.join(SRC, 'keeferrourke_capitaine-cursors', 'src');
  const roles = {};
  const spec = (kind, n) => { const p = path.join(base, 'config', kind, n + '.spec'); return exists(p) ? fs.readFileSync(p, 'utf8').trim().split(/\s+/).map(Number) : null; };
  for (const role of ROLES) for (const cand of CANDIDATES[role]) {
    if (ANIMATED.has(role)) {
      const s = spec('animated', cand); if (!s) continue;
      const frames = Array.from({ length: s[2] }, (_, i) => `${cand}-${String(i).padStart(2, '0')}.svg`);
      roles[role] = { frames, delay: s[3], hot: [r4(s[0] / 24), r4(s[1] / 24)] }; break;
    } else {
      const s = spec('static', cand); if (!s || !exists(path.join(base, 'svg/dark', cand + '.svg'))) continue;
      roles[role] = { src: cand + '.svg', hot: [r4(s[0] / 24), r4(s[1] / 24)] }; break;
    }
  }
  const variants = [{ id: 'dark', name: 'Dark', polarity: 'dark', swatch: ['#1b1b1b', '#ffffff'] }, { id: 'light', name: 'Light', polarity: 'light', swatch: ['#fafafa', '#1b1b1b'] }];
  const files = new Set(Object.values(roles).flatMap(r => r.frames || [r.src]));
  for (const v of variants) for (const f of files) copy(path.join(base, 'svg', v.id, f), path.join(OUT, id, v.id, f));
  return { id, name: 'Capitaine', author: 'Keefer Rourke', license: 'LGPL-3.0', url: 'https://github.com/keeferrourke/capitaine-cursors',
    tags: ['dark', 'light', 'mac'], desc: { ar: 'مستوحى من الماك بلمسة KDE، ناعم وهادئ', en: 'macOS-inspired with a KDE touch' },
    kind: 'files', variants: variants.map(v => ({ ...v, dir: v.id })), roles };
}

/* ---------- Phinger (hotspot rect inside each SVG, spinner rotates) ---------- */
function importPhinger() {
  const id = 'phinger', base = path.join(SRC, 'phisch_phinger-cursors', 'theme');
  const roles = {};
  const hotOf = f => {
    const s = fs.readFileSync(f, 'utf8');
    const g = s.match(/id="hotspot"[^>]*>\s*<rect([^>]*)>/);
    const x = g ? parseFloat((g[1].match(/\sx="([\d.]+)"/) || [0, 0])[1]) : 0;
    const y = g ? parseFloat((g[1].match(/\sy="([\d.]+)"/) || [0, 0])[1]) : 0;
    return [r4((x + 0.5) / 32), r4((y + 0.5) / 32)];
  };
  for (const role of ROLES) for (const cand of CANDIDATES[role]) {
    const f = path.join(base, 'dark', `${cand}_32.svg`);
    if (!exists(f)) continue;
    roles[role] = ANIMATED.has(role) ? { src: `${cand}_32.svg`, spin: 'spinner', spinFrames: 30, delay: 33, hot: hotOf(f) } : { src: `${cand}_32.svg`, hot: hotOf(f) };
    break;
  }
  const variants = [{ id: 'dark', name: 'Dark', polarity: 'dark', swatch: ['#1e1e1e', '#ffffff'] }, { id: 'light', name: 'Light', polarity: 'light', swatch: ['#ffffff', '#1e1e1e'] }];
  for (const v of variants) for (const r of Object.values(roles)) {
    const to = path.join(OUT, id, v.id, r.src); fs.mkdirSync(path.dirname(to), { recursive: true });
    // the Figma export keeps a 1px magenta hotspot marker — strip it
    fs.writeFileSync(to, fs.readFileSync(path.join(base, v.id, r.src), 'utf8').replace(/<g id="hotspot"[\s\S]*?<\/g>/, ''));
  }
  return { id, name: 'Phinger', author: 'Philipp Schaffrath', license: 'CC-BY-SA-4.0', url: 'https://github.com/phisch/phinger-cursors',
    tags: ['dark', 'light', 'playful'], desc: { ar: 'يد مرسومة بأسلوب لطيف وأشكال مميزة', en: 'Friendly hand and distinctive shapes' },
    kind: 'files', variants: variants.map(v => ({ ...v, dir: v.id })), roles };
}

/* ---------- Oreo (template tokens {{ background }} ...) ---------- */
function importOreo() {
  const id = 'oreo', base = path.join(SRC, 'varlesh_oreo-cursors');
  const tdir = path.join(base, 'generator', 'oreo_base_cursors');
  const roles = {};
  for (const role of ROLES) for (const cand of CANDIDATES[role]) {
    const cfg = path.join(base, 'src', 'config', cand + '.cursor');
    if (!exists(cfg)) continue;
    if (ANIMATED.has(role)) {
      const frames = fs.readdirSync(tdir).filter(f => new RegExp(`^${cand}-\\d+\\.svg\\.oreo$`).test(f)).sort();
      if (frames.length < 2) continue;
      const hot = parseCursorCfg(cfg, 32, 'suffix');
      frames.forEach(f => copy(path.join(tdir, f), path.join(OUT, id, 'svg', f.replace('.oreo', ''))));
      roles[role] = { frames: frames.map(f => f.replace('.oreo', '')), delay: hot.delay || 30, hot: [r4(hot.x / hot.size), r4(hot.y / hot.size)] };
      break;
    }
    if (!exists(path.join(tdir, cand + '.svg.oreo'))) continue;
    const hot = parseCursorCfg(cfg, 32, 'suffix');
    copy(path.join(tdir, cand + '.svg.oreo'), path.join(OUT, id, 'svg', cand + '.svg'));
    roles[role] = { src: cand + '.svg', hot: [r4(hot.x / hot.size), r4(hot.y / hot.size)] };
    break;
  }
  const tokens = { fill: '{{ background }}', edge: '{{ label }}', shadow: '{{ shadow }}', shadowOpacity: '{{ shadowopacity }}' };
  const mk = (vid, nm, fill, edge = '#ffffff') => ({ id: vid, name: nm, colors: { fill, edge, shadow: '#000000', shadowOpacity: '0.35' }, swatch: [fill, edge] });
  return { id, name: 'Oreo', author: 'Varlesh', license: 'GPL-2.0', url: 'https://github.com/varlesh/oreo-cursors',
    tags: ['color', 'dark', 'playful'], desc: { ar: 'أشكال دائرية ممتلئة مع أنيميشن لطيف', en: 'Chunky rounded shapes with cute animation' },
    kind: 'tokens', dir: 'svg', tokens,
    variants: [mk('black', 'Black', '#2b2b2b'), mk('spark-dark', 'Spark Dark', '#222222'), mk('white', 'White', '#f2f2f2', '#2b2b2b'),
      mk('blue', 'Blue', '#4E81ED'), mk('purple', 'Purple', '#7E57C2'), mk('pink', 'Pink', '#EE5387'), mk('red', 'Red', '#F44336'), mk('teal', 'Teal', '#009789')],
    roles };
}

/* ---------- Google (prebuilt PNG bitmaps) ---------- */
function importGoogle() {
  const id = 'google-dot', base = path.join(SRC, 'ful1e5_Google_Cursor');
  const conf = parseToml(path.join(base, 'build.toml'));
  const bdir = path.join(base, 'bitmaps');
  const vs = [['GoogleDot-Black', 'black', 'Black', 'dark', ['#000000', '#ffffff']], ['GoogleDot-White', 'white', 'White', 'light', ['#ffffff', '#000000']],
    ['GoogleDot-Blue', 'blue', 'Blue', 'color', ['#1A73E8', '#ffffff']], ['GoogleDot-Red', 'red', 'Red', 'color', ['#C50E1F', '#ffffff']]];
  const v0 = path.join(bdir, vs[0][0]);
  const roles = {};
  for (const role of ROLES) for (const cand of CANDIDATES[role]) {
    const h = conf.byName[cand]; const file = h ? h.png : cand;
    const hh = h || conf.fallback;
    const hot = [r4(hh.x / 200), r4(hh.y / 200)];
    if (ANIMATED.has(role)) {
      const frames = fs.readdirSync(v0).filter(f => new RegExp(`^${file}-\\d+\\.png$`).test(f)).sort()
        .filter(f => vs.every(([d]) => exists(path.join(bdir, d, f))));
      if (frames.length > 1) { roles[role] = { frames: frames.filter((_, i) => i % 2 === 0), delay: 20, hot }; break; }
    } else if (exists(path.join(v0, file + '.png'))) { roles[role] = { src: file + '.png', hot }; break; }
  }
  const files = new Set(Object.values(roles).flatMap(r => r.frames || [r.src]));
  for (const [dir, vid] of vs) for (const f of files) copy(path.join(bdir, dir, f), path.join(OUT, id, vid, f));
  return { id, name: 'Google Dot', author: 'Abdulkaiz Khatri (ful1e5)', license: 'GPL-3.0', url: 'https://github.com/ful1e5/Google_Cursor',
    tags: ['dark', 'light', 'color', 'minimal'], desc: { ar: 'نقطة دائرية بأسلوب جوجل، مختلف تمامًا', en: 'Google-style round dot cursor' },
    kind: 'files', variants: vs.map(([, vid, nm, pol, sw]) => ({ id: vid, name: nm, dir: vid, polarity: pol, swatch: sw })), roles };
}

/* ---------- KDE "scalable" SVG cursors (metadata.json per cursor) ---------- */
function importScalable({ id, name, repo, variants, tags, author, license, desc }) {
  const roles = {}; const v0 = path.join(SRC, repo, variants[0].dir);
  for (const role of ROLES) for (const cand of CANDIDATES[role]) {
    const mf = path.join(v0, cand, 'metadata.json'); if (!exists(mf)) continue;
    const meta = JSON.parse(fs.readFileSync(mf, 'utf8'));
    // some themes name files wait_01.svg while metadata says wait-01.svg
    for (const m of meta) if (!exists(path.join(v0, cand, m.filename))) { const alt = m.filename.replace(/-(\d+)\.svg$/, '_$1.svg'); if (exists(path.join(v0, cand, alt))) m.filename = alt; }
    if (meta.some(m => !exists(path.join(v0, cand, m.filename)))) continue;
    const m0 = meta[0];
    const w = svgSize(path.join(v0, cand, m0.filename));
    const hot = [r4(m0.hotspot_x / w), r4(m0.hotspot_y / w)];
    if (meta.length > 1) roles[role] = { frames: meta.map(m => cand + '/' + m.filename), delay: m0.delay || 30, hot };
    else if (ANIMATED.has(role) && meta.length < 2) continue;
    else roles[role] = { src: cand + '/' + m0.filename, hot };
    break;
  }
  const files = new Set(Object.values(roles).flatMap(r => r.frames || [r.src]));
  for (const v of variants) for (const f of files) copy(path.join(SRC, repo, v.dir, f), path.join(OUT, id, v.id, f));
  return { id, name, author, license, url: `https://github.com/${repo.replace('_', '/')}`, tags, desc, kind: 'files',
    variants: variants.map(v => ({ id: v.id, name: v.name, dir: v.id, polarity: v.polarity, swatch: v.swatch })), roles };
}

/* ---------- Mocu (colour placeholders + hotspot circle + animated attribute lists) ---------- */
function importMocu() {
  const id = 'mocu', dir = path.join(SRC, 'sevmeyer_mocu-xcursor', 'src', 'svg');
  const roles = {};
  const hotOf = s => { const m = s.match(/<circle id="hot"[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"/); return m ? [r4(+m[1] / 24), r4(+m[2] / 24)] : [0, 0]; };
  const clean = s => s.replace(/<circle id="hot"[^>]*\/>/, '');
  for (const role of ROLES) for (const cand of CANDIDATES[role]) {
    const f = path.join(dir, cand + '.svg'); if (!exists(f)) continue;
    const s = fs.readFileSync(f, 'utf8'); const txt = path.join(dir, cand + '.txt');
    if (exists(txt)) { // one line per frame: "<delay> <attr>=<value>" applied to the element with class="anim"
      const lines = fs.readFileSync(txt, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => /^\d/.test(l));
      const frames = lines.map((l, i) => {
        const [, delay, attr, val] = l.match(/^(\d+)\s+([\w-]+)="([^"]*)"/);
        const out = clean(s).replace(/(<[^>]*class="anim"[^>]*?)(\s*\/?>)/, (m, a, end) => a.replace(new RegExp('\\s' + attr + '="[^"]*"'), '') + ` ${attr}="${val}"` + end);
        const fn = `${cand}/${String(i).padStart(2, '0')}.svg`; fs.mkdirSync(path.join(OUT, id, 'svg', cand), { recursive: true });
        fs.writeFileSync(path.join(OUT, id, 'svg', fn), out); return { fn, delay: +delay };
      });
      roles[role] = { frames: frames.map(x => x.fn), delay: frames[0].delay, hot: hotOf(s) };
    } else {
      if (ANIMATED.has(role)) continue;
      fs.mkdirSync(path.join(OUT, id, 'svg'), { recursive: true }); fs.writeFileSync(path.join(OUT, id, 'svg', cand + '.svg'), clean(s));
      roles[role] = { src: cand + '.svg', hot: hotOf(s) };
    }
    break;
  }
  const mk = (vid, nm, fill, edge) => ({ id: vid, name: nm, colors: { fill, edge, shadow: '#000000' }, swatch: [fill, edge] });
  return { id, name: 'Mocu', author: 'Severin Meyer', license: 'CC0-1.0', url: 'https://github.com/sevmeyer/mocu-xcursor', tags: ['dark', 'light', 'minimal', 'classic'],
    desc: { ar: 'صغير وحاد ونظيف جدًا، للي يحب البساطة', en: 'Tiny, crisp and very clean' }, kind: 'tokens', dir: 'svg',
    tokens: { fill: '#fafbfc', edge: '#1a1b1c', shadow: '#0a0b0c' },
    variants: [mk('black', 'Black', '#111111', '#f9f9f9'), mk('white', 'White', '#fcfcfc', '#222222')], roles };
}

/* ---------- prebuilt PNG cursors described by xcursorgen .in files ---------- */
function pngWidth(file) { const b = fs.readFileSync(file); return b.readUInt32BE(16); }
function importPngIn({ id, name, repo, inDir, variants, tags, author, license, desc, url }) {
  const base = path.join(SRC, repo, inDir); const roles = {};
  const parse = n => {
    const f = path.join(base, n + '.in'); if (!exists(f)) return null;
    const ls = fs.readFileSync(f, 'utf8').split(/\r?\n/).map(l => l.trim().split(/\s+/)).filter(a => a.length >= 4);
    const max = Math.max(...ls.map(a => +a[0])); return ls.filter(a => +a[0] === max);
  };
  const fileFor = (v, rel) => path.normalize(path.join(base, v.map ? v.map(rel) : rel));
  for (const role of ROLES) for (const cand of CANDIDATES[role]) {
    const ls = parse(cand); if (!ls) continue;
    if (!variants.every(v => ls.every(l => exists(fileFor(v, l[3]))))) continue;
    const w = pngWidth(fileFor(variants[0], ls[0][3]));
    const hot = [r4(+ls[0][1] / w), r4(+ls[0][2] / w)];
    const rel = l => `${cand}/${path.basename(l[3])}`;
    if (ls.length > 1) roles[role] = { frames: ls.map(rel), delay: +ls[0][4] || 50, hot };
    else if (ANIMATED.has(role)) continue;
    else roles[role] = { src: rel(ls[0]), hot };
    for (const v of variants) for (const l of ls) copy(fileFor(v, l[3]), path.join(OUT, id, v.id, rel(l)));
    break;
  }
  return { id, name, author, license, url, tags, desc, kind: 'files', variants: variants.map(v => ({ id: v.id, name: v.name, dir: v.id, polarity: v.polarity, swatch: v.swatch })), roles };
}

/* ---------- pack list ---------- */
const BIB_TOK = { fill: '#00FF00', edge: '#0000FF', accent: '#FF0000' };
const tv = (id, name, fill, edge, accent) => ({ id, name, colors: { fill, edge, accent: accent || fill }, swatch: [fill, edge] });
const fv = (id, name, dir, polarity, swatch) => ({ id, name, dir, polarity, swatch });

const packs = [
  importFul1e5({ id: 'bibata-modern', name: 'Bibata Modern', repo: 'ful1e5_Bibata_Cursor', svgDir: 'svg/modern', toml: 'configs/normal/x.build.toml',
    author: 'Abdulkaiz Khatri (ful1e5)', license: 'GPL-3.0', tags: ['dark', 'light', 'color', 'rounded'], tokens: BIB_TOK,
    desc: { ar: 'أطراف دائرية ناعمة وحافة واضحة، من أشهر الحزم', en: 'Soft rounded tips with a crisp edge' },
    variants: [tv('classic', 'Classic', '#000000', '#FFFFFF', '#000000'), tv('ice', 'Ice', '#FFFFFF', '#000000', '#FFFFFF'), tv('amber', 'Amber', '#FF8300', '#FFFFFF', '#001524')] }),
  importFul1e5({ id: 'bibata-original', name: 'Bibata Original', repo: 'ful1e5_Bibata_Cursor', svgDir: 'svg/original', toml: 'configs/normal/x.build.toml',
    author: 'Abdulkaiz Khatri (ful1e5)', license: 'GPL-3.0', tags: ['dark', 'light', 'color', 'sharp'], tokens: BIB_TOK,
    desc: { ar: 'نفس روح Bibata لكن بأطراف حادة', en: 'Bibata with sharp tips' },
    variants: [tv('classic', 'Classic', '#000000', '#FFFFFF', '#000000'), tv('ice', 'Ice', '#FFFFFF', '#000000', '#FFFFFF'), tv('amber', 'Amber', '#FF8300', '#FFFFFF', '#001524')] }),
  importFul1e5({ id: 'apple', name: 'macOS', repo: 'ful1e5_apple_cursor', toml: 'configs/x.build.toml', author: 'Abdulkaiz Khatri (ful1e5)', license: 'GPL-3.0',
    tags: ['dark', 'light', 'mac'], tokens: BIB_TOK, desc: { ar: 'شكل الماك بالضبط مع كرة التحميل الملونة', en: 'The macOS look, rainbow wheel included' },
    variants: [tv('black', 'Black', '#000000', '#FFFFFF'), tv('white', 'White', '#FFFFFF', '#000000')] }),
  importFul1e5({ id: 'xcursor-pro', name: 'XCursor Pro', repo: 'ful1e5_XCursor-pro', toml: 'configs/x.build.toml', author: 'Abdulkaiz Khatri (ful1e5)', license: 'GPL-3.0',
    tags: ['dark', 'light', 'color', 'classic'], tokens: BIB_TOK, desc: { ar: 'السهم الكلاسيكي بتصميم عصري ونظيف', en: 'The classic arrow, modernised' },
    variants: [tv('dark', 'Dark', '#000000', '#FFFFFF'), tv('light', 'Light', '#FFFFFF', '#000000'), tv('red', 'Red', '#FF0000', '#FFFFFF')] }),
  importFul1e5({ id: 'fuchsia', name: 'Fuchsia', repo: 'ful1e5_fuchsia-cursor', toml: 'configs/x.build.toml', author: 'Abdulkaiz Khatri (ful1e5)', license: 'GPL-3.0',
    tags: ['color', 'rounded'], tokens: BIB_TOK, desc: { ar: 'مستوحى من نظام Fuchsia، ملون وحيوي', en: 'Inspired by Fuchsia OS' },
    variants: [tv('fuchsia', 'Fuchsia', '#E11C79', '#FFFFFF'), tv('pop', 'Pop', '#F8B572', '#FFFFFF'), tv('red', 'Red', '#FF0000', '#FFFFFF'), tv('amber', 'Amber', '#FFA400', '#FFFFFF')] }),
  importFul1e5({ id: 'banana', name: 'Banana', repo: 'ful1e5_banana-cursor', toml: 'configs/x.build.toml', author: 'Abdulkaiz Khatri (ful1e5)', license: 'GPL-3.0',
    tags: ['color', 'playful'], tokens: { fill: '#FCD900', edge: '#6D3C1B' }, desc: { ar: 'سهم على شكل موزة، مرح وغريب', en: 'A banana-shaped pointer' },
    variants: [tv('banana', 'Banana', '#FCD900', '#6D3C1B'), tv('green', 'Green', '#54F851', '#0C2608'), tv('blue', 'Blue', '#64CDCD', '#0E2026')] }),
  importCapitaine(),
  importPhinger(),
  importOreo(),
  importGoogle(),
  importCfg({ id: 'volantes', name: 'Volantes', repo: 'varlesh_volantes-cursors', root: 'src', rule: 'suffix', author: 'Varlesh', license: 'GPL-2.0',
    tags: ['dark', 'light', 'rounded'], desc: { ar: 'أشكال منفوخة ومدورة جدًا', en: 'Plump, very rounded shapes' },
    variants: [fv('dark', 'Dark', 'volantes_cursors', 'dark', ['#222222', '#ffffff']), fv('light', 'Light', 'volantes_light_cursors', 'light', ['#ffffff', '#222222'])] }),
  importCfg({ id: 'material', name: 'Material', repo: 'varlesh_material-cursors', root: 'src', rule: 'suffix', author: 'Varlesh', license: 'GPL-3.0',
    tags: ['dark', 'light', 'material'], desc: { ar: 'بأسلوب Material Design من قوقل', en: 'Material Design style' },
    variants: [fv('default', 'Default', 'material_cursors', 'dark', ['#424242', '#ffffff']), fv('dark', 'Dark', 'material_dark_cursors', 'dark', ['#111111', '#ffffff']), fv('light', 'Light', 'material_light_cursors', 'light', ['#ffffff', '#424242'])] }),
  importCfg({ id: 'layan', name: 'Layan', repo: 'vinceliuice_Layan-cursors', root: 'src', rule: 'scale', author: 'Vince Liuice', license: 'GPL-3.0',
    tags: ['dark', 'light', 'color'], desc: { ar: 'انحناءات عصرية وحواف واضحة', en: 'Modern curves and clear edges' },
    variants: [fv('default', 'Default', 'svg', 'color', ['#5294e2', '#ffffff']), fv('border', 'Border', 'svg-border', 'dark', ['#2a2a2a', '#ffffff']), fv('white', 'White', 'svg-white', 'light', ['#ffffff', '#2a2a2a'])] }),
  importCfg({ id: 'mcmojave', name: 'McMojave', repo: 'vinceliuice_McMojave-cursors', root: 'src', rule: 'scale', author: 'Vince Liuice', license: 'GPL-3.0',
    tags: ['dark', 'mac'], desc: { ar: 'ستايل ماك موهافي الغامق', en: 'macOS Mojave dark style' },
    variants: [fv('default', 'Mojave', 'svg', 'dark', ['#1e1e1e', '#ffffff'])] }),
  importCfg({ id: 'whitesur', name: 'WhiteSur', repo: 'vinceliuice_WhiteSur-cursors', root: 'src', rule: 'scale', author: 'Vince Liuice', license: 'GPL-3.0',
    tags: ['light', 'mac'], desc: { ar: 'ستايل ماك Big Sur الأبيض', en: 'macOS Big Sur white style' },
    variants: [fv('default', 'Big Sur', 'svg', 'light', ['#ffffff', '#1e1e1e'])] }),
  importCfg({ id: 'graphite', name: 'Graphite', repo: 'vinceliuice_Graphite-cursors', root: 'src', rule: 'scale', author: 'Vince Liuice', license: 'GPL-3.0',
    tags: ['dark', 'light', 'minimal'], desc: { ar: 'رمادي فحمي بسيط وفخم', en: 'Simple charcoal elegance' },
    variants: [fv('dark', 'Dark', 'svg-dark', 'dark', ['#2a2a2a', '#ffffff']), fv('light', 'Light', 'svg-light', 'light', ['#ffffff', '#2a2a2a']), fv('dark-nord', 'Nord Dark', 'svg-dark-nord', 'dark', ['#2e3440', '#eceff4']), fv('light-nord', 'Nord Light', 'svg-light-nord', 'light', ['#eceff4', '#2e3440'])] }),
  importCfg({ id: 'fluent', name: 'Fluent', repo: 'vinceliuice_Fluent-icon-theme', root: 'cursors/src', rule: 'scale', author: 'Vince Liuice', license: 'GPL-3.0',
    tags: ['dark', 'light', 'windows'], desc: { ar: 'بروح ويندوز 11 وتصميم Fluent', en: 'Windows 11 Fluent spirit' },
    variants: [fv('dark', 'Dark', 'svg', 'dark', ['#202020', '#ffffff']), fv('white', 'White', 'svg-white', 'light', ['#ffffff', '#202020'])] }),
  importCfg({ id: 'future', name: 'Future', repo: 'yeyushengfan258_Future-cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['dark', 'light', 'color', 'futuristic'], desc: { ar: 'مستقبلي بخطوط حادة وتفاصيل جريئة', en: 'Futuristic with bold detail' },
    variants: [fv('default', 'Cream', 'svg', 'light', ['#ffffff', '#3a3a3a']), fv('black', 'Black', 'svg-black', 'dark', ['#111111', '#ffffff']), fv('dark', 'White', 'svg-dark', 'dark', ['#2b2b2b', '#ffffff']), fv('cyan', 'Ice', 'svg-cyan', 'color', ['#00bcd4', '#ffffff'])] }),
  importFul1e5({ id: 'breezex', name: 'BreezeX', repo: 'ful1e5_BreezeX_Cursor', toml: 'configs/x.build.toml', author: 'Abdulkaiz Khatri (ful1e5)', license: 'GPL-3.0',
    tags: ['dark', 'light', 'classic'], tokens: { fill: '#00FF00', edge: '#0000FF' }, desc: { ar: 'Breeze من KDE بنسخة موسّعة وحواف ناعمة', en: 'Extended KDE Breeze' },
    variants: [tv('black', 'Black', '#000000', '#FFFFFF'), tv('dark', 'Dark', '#4D4D4D', '#FFFFFF'), tv('light', 'Light', '#FFFFFF', '#4D4D4D'),
      tv('rose-pine', 'Rosé Pine', '#191724', '#e0def4'), tv('rose-pine-dawn', 'Rosé Pine Dawn', '#faf4ed', '#575279')] }),
  importFul1e5({ id: 'notwaita', name: 'Notwaita', repo: 'ful1e5_notwaita-cursor', toml: 'configs/x.build.toml', author: 'Abdulkaiz Khatri (ful1e5)', license: 'LGPL-3.0 / CC-BY-SA-3.0',
    tags: ['dark', 'light', 'classic'], tokens: { fill: '#00FF00', edge: '#0000FF', accent: '#FF0000', edge2: '#FFFF00' }, desc: { ar: 'بروح GNOME الكلاسيكية بلمسة أنظف', en: 'Classic GNOME Adwaita spirit, cleaner' },
    variants: [{ ...tv('black', 'Black', '#000000', '#FFFFFF'), colors: { fill: '#000000', edge: '#FFFFFF', accent: '#000000', edge2: '#FFFFFF' } },
      { ...tv('gray', 'Gray', '#404040', '#FFFFFF'), colors: { fill: '#404040', edge: '#FFFFFF', accent: '#404040', edge2: '#FFFFFF' } },
      { ...tv('white', 'White', '#FFFFFF', '#000000'), colors: { fill: '#FFFFFF', edge: '#000000', accent: '#FFFFFF', edge2: '#000000' } }] }),
  importMocu(),
  importScalable({ id: 'breeze', name: 'Breeze', repo: 'KDE_breeze', author: 'KDE', license: 'GPL-2.0+', tags: ['dark', 'light', 'classic'],
    desc: { ar: 'ماوس KDE الرسمي، متوازن وواضح', en: 'The official KDE cursor' },
    variants: [fv('dark', 'Dark', 'cursors/Breeze/Breeze/cursors_scalable', 'dark', ['#232627', '#fcfcfc']), fv('light', 'Light', 'cursors/Breeze_Light/Breeze_Light/cursors_scalable', 'light', ['#fcfcfc', '#232627'])] }),
  importScalable({ id: 'elementary', name: 'elementary', repo: 'elementary_icons', author: 'elementary', license: 'GPL-3.0', tags: ['dark', 'classic'],
    desc: { ar: 'ماوس نظام elementary OS، ناعم وأنيق', en: 'The elementary OS cursor' },
    variants: [fv('default', 'Default', 'cursors/cursors_scalable', 'dark', ['#1a1a1a', '#ffffff'])] }),
  importCfg({ id: 'numix', name: 'Numix', repo: 'numixproject_numix-cursor-theme', root: 'src', rule: 'scale', author: 'Numix Project', license: 'GPL-3.0',
    tags: ['dark', 'light', 'flat'], desc: { ar: 'مسطّح وحاد بستايل Numix', en: 'Flat and sharp Numix style' },
    variants: [fv('dark', 'Dark', 'dark/svgs', 'dark', ['#2d2d2d', '#ffffff']), fv('light', 'Light', 'light/svgs', 'light', ['#ffffff', '#2d2d2d'])] }),
  importCfg({ id: 'arc-starry', name: 'ArcStarry', repo: 'yeyushengfan258_ArcStarry-Cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['color', 'futuristic'], desc: { ar: 'ألوان ليلية مع لمعة نجوم', en: 'Starry night colours' }, variants: [fv('default', 'Default', 'svg', 'color', ['#3d4cff', '#ffffff'])] }),
  importCfg({ id: 'arc-midnight', name: 'ArcMidnight', repo: 'yeyushengfan258_ArcMidnight-Cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['dark', 'futuristic'], desc: { ar: 'غامق بلون منتصف الليل', en: 'Midnight dark' }, variants: [fv('default', 'Default', 'svg', 'dark', ['#1b1e2b', '#ffffff'])] }),
  importCfg({ id: 'arc-aurora', name: 'ArcAurora', repo: 'yeyushengfan258_ArcAurora-cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['color', 'futuristic'], desc: { ar: 'تدرّجات الشفق القطبي', en: 'Aurora gradients' }, variants: [fv('default', 'Default', 'svg', 'color', ['#2dd4bf', '#ffffff'])] }),
  importCfg({ id: 'polarnight', name: 'Polarnight', repo: 'yeyushengfan258_Polarnight-Cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['dark'], desc: { ar: 'ليل قطبي بألوان Nord', en: 'Polar night, Nord colours' }, variants: [fv('default', 'Default', 'svg', 'dark', ['#2e3440', '#eceff4'])] }),
  importCfg({ id: 'lyra', name: 'Lyra', repo: 'yeyushengfan258_Lyra-Cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['color', 'futuristic'], desc: { ar: 'تسع ألوان جريئة بتصميم واحد مميز', en: 'Nine bold colours, one distinctive design' },
    variants: ['B', 'F', 'G', 'P', 'Q', 'R', 'S', 'X', 'Y'].map(k => fv(k.toLowerCase(), 'Lyra ' + k, `Lyra${k}-svg`, 'color', ['#888', '#fff'])) }),
  importCfg({ id: 'deepin-v20', name: 'Deepin V20', repo: 'yeyushengfan258_DeepinV20-white-cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['light'], desc: { ar: 'بستايل نظام Deepin الأبيض', en: 'Deepin-style white' }, variants: [fv('default', 'White', 'svg', 'light', ['#ffffff', '#333333'])] }),
  importCfg({ id: 'we10x', name: 'We10X', repo: 'yeyushengfan258_We10XOS-cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['light', 'windows'], desc: { ar: 'مستوحى من ويندوز 10X الملغي', en: 'Inspired by Windows 10X' }, variants: [fv('default', 'Default', 'svg', 'light', ['#ffffff', '#1e1e1e'])] }),
  importCfg({ id: 'winsur', name: 'WinSur', repo: 'yeyushengfan258_WinSur-white-cursors', root: 'src', rule: 'scale', author: 'yeyushengfan258', license: 'GPL-3.0',
    tags: ['light', 'mac', 'windows'], desc: { ar: 'خليط بين ويندوز وماك Big Sur', en: 'Windows meets Big Sur' }, variants: [fv('default', 'White', 'svg', 'light', ['#ffffff', '#1e1e1e'])] }),
  importPngIn({ id: 'adwaita', name: 'Adwaita', repo: '_adwaita', inDir: 'default', author: 'GNOME, Manu Mannattil', license: 'LGPL-3.0 / CC-BY-SA-3.0', url: 'https://github.com/manu-mannattil/adwaita-cursors',
    tags: ['dark', 'classic'], desc: { ar: 'ماوس GNOME الكلاسيكي اللي يعرفه الكل', en: 'The classic GNOME cursor' },
    variants: [{ id: 'default', name: 'Black', polarity: 'dark', swatch: ['#000', '#fff'] }, { id: 'red', name: 'Red', polarity: 'color', swatch: ['#c01c28', '#fff'], map: r => '../red/' + r }] }),
  importPngIn({ id: 'cz-hickson', name: 'Hickson', repo: 'charakterziffer_cursor-toolbox', inDir: 'more-themes/cz-Hickson/hotspots', author: 'charakterziffer', license: 'GPL-3.0', url: 'https://github.com/charakterziffer/cursor-toolbox',
    tags: ['dark', 'light', 'minimal', 'classic'], desc: { ar: 'حاد ورسمي بخطوط دقيقة', en: 'Sharp, formal, precise lines' },
    variants: [{ id: 'black', name: 'Black', polarity: 'dark', swatch: ['#000', '#fff'], map: r => r.replace('../pngs/', '../pngs-black/') }, { id: 'white', name: 'White', polarity: 'light', swatch: ['#fff', '#000'], map: r => r.replace('../pngs/', '../pngs-white/') }] }),
].filter(p => Object.keys(p.roles).length >= 8);

// Same shapes, different colours → one pack with several variants (no duplicates in the library).
function mergeInto(targetId, fromId, rename) {
  const t = packs.find(p => p.id === targetId), f = packs.find(p => p.id === fromId);
  if (!t || !f) return;
  for (const v of f.variants) {
    const nv = { ...v, id: fromId + '-' + v.id, dir: fromId + '-' + v.id };
    fs.cpSync(path.join(OUT, fromId, v.dir), path.join(OUT, targetId, nv.dir), { recursive: true });
    t.variants.push(nv);
  }
  t.author = [...new Set([t.author, f.author])].join(', ');
  if (rename) Object.assign(t, rename);
  packs.splice(packs.indexOf(f), 1);
  fs.rmSync(path.join(OUT, fromId), { recursive: true, force: true });
}
mergeInto('arc-starry', 'arc-midnight'); mergeInto('arc-starry', 'arc-aurora'); mergeInto('arc-starry', 'polarnight');
{ const a = packs.find(p => p.id === 'arc-starry'); if (a) Object.assign(a, { name: 'Arc', desc: { ar: 'نفس التصميم بأربع أجواء: نجوم، منتصف الليل، شفق، وليل قطبي', en: 'One design, four moods: starry, midnight, aurora, polar night' }, tags: ['dark', 'light', 'color', 'futuristic'] });
  if (a) a.variants.forEach(v => { v.name = { default: 'Starry', 'arc-midnight-default': 'Midnight', 'arc-aurora-default': 'Aurora', 'polarnight-default': 'Polar Night' }[v.id] || v.name; }); }
// Capitaine is a near-copy of Breeze (it says so itself): keep the original only.
{ const i = packs.findIndex(p => p.id === 'capitaine'); if (i >= 0) { packs.splice(i, 1); fs.rmSync(path.join(OUT, 'capitaine'), { recursive: true, force: true }); } }
mergeInto('we10x', 'winsur');
{ const w = packs.find(p => p.id === 'we10x'); if (w) w.variants.forEach(v => { if (v.id.startsWith('winsur-')) v.name = 'WinSur'; }); }
// near-copies of packs we already have (checked side by side): keep one of each
for (const [gone] of [['breeze'], ['whitesur'], ['mcmojave'], ['adwaita']]) { const i = packs.findIndex(p => p.id === gone); if (i >= 0) { packs.splice(i, 1); fs.rmSync(path.join(OUT, gone), { recursive: true, force: true }); } }
mergeInto('whitesur', 'mcmojave', { name: 'WhiteSur', desc: { ar: 'ستايل الماك الحديث بنسختين: أبيض Big Sur وغامق Mojave', en: 'Modern macOS look: Big Sur white and Mojave dark' }, tags: ['dark', 'light', 'mac'] });


// Every pack should end up with all 17 roles: missing ones are composed by the engine.
for (const p of packs) {
  for (const role of ROLES) if (!p.roles[role]) {
    if (role === 'Pin' || role === 'Person' || role === 'Help') p.roles[role] = { compose: 'Arrow', badge: role.toLowerCase() };
    else if (role === 'AppStarting' || role === 'Wait') p.roles[role] = { compose: 'Arrow', badge: 'busy' };
    else if (role === 'UpArrow') p.roles[role] = { ref: 'Arrow' };
    else if (p.roles.Arrow) p.roles[role] = { ref: 'Arrow' };
  }
}

fs.mkdirSync(OUT, { recursive: true });
for (const p of packs) fs.writeFileSync(path.join(OUT, p.id, 'pack.json'), JSON.stringify(p, null, 1));
// removed/merged packs keep working in saved designs through aliases
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ packs: packs.map(p => p.id), aliases: { capitaine: 'breezex', breeze: 'breezex', whitesur: 'apple', mcmojave: 'apple', adwaita: 'notwaita', 'arc-midnight': 'arc-starry', 'arc-aurora': 'arc-starry', polarnight: 'arc-starry', winsur: 'we10x' } }));
for (const p of packs) {
  const real = ROLES.filter(r => p.roles[r].src || p.roles[r].frames);
  console.log(p.id.padEnd(16), String(real.length).padStart(2), '/17 native', ROLES.filter(r => !(p.roles[r].src || p.roles[r].frames)).join(','));
}
