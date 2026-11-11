# Cuts named slice rectangles out of an Inkscape cursor sheet (Adwaita-style "slices" layer) into PNGs + .in hotspot files.
# usage: python3 slice-sheet.py <sheet.svg> <genin.py with HOTSPOTS> <outdir> [px]
import sys, json, re, pathlib, subprocess, time, base64, importlib.util
from playwright.sync_api import sync_playwright
sheet, genin, out = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3]); px = int(sys.argv[4]) if len(sys.argv) > 4 else 96
spec = importlib.util.spec_from_file_location('g', genin); g = importlib.util.module_from_spec(spec)
src = open(genin).read(); hs = re.search(r'HOTSPOTS\s*=\s*(\{.*?\n\})', src, re.S).group(1)
HOT = eval(hs)
names = ['left_ptr', 'question_arrow', 'left_ptr_watch', 'watch', 'crosshair', 'xterm', 'pencil', 'circle', 'crossed_circle', 'sb_v_double_arrow', 'sb_h_double_arrow',
         'fd_double_arrow', 'bd_double_arrow', 'fleur', 'center_ptr', 'hand2', 'help', 'v_double_arrow', 'h_double_arrow', 'size_fdiag', 'size_bdiag', 'move', 'all-scroll', 'cross', 'tcross']
svgtext = open(sheet, encoding='utf8').read()
out.mkdir(parents=True, exist_ok=True); (out / f'{px}x{px}').mkdir(exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox']); pg = b.new_page()
    pg.set_content('<html><body style="margin:0"></body></html>')
    res = pg.evaluate("""async ([text, names, hot, px]) => {
      const host = document.createElement('div'); host.innerHTML = text; document.body.append(host);
      const svg = host.querySelector('svg');
      const ids = []; for (const n of names) { if (svg.getElementById(n)) ids.push([n, 1]); else { let k = 0; while (svg.getElementById(`${n}_${String(k + 1).padStart(4, '0')}`)) k++; if (k) ids.push([n, k]); } }
      const box = id => { const el = svg.getElementById(id); const bb = el.getBBox(); const m = svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
        const p = new DOMPoint(bb.x, bb.y).matrixTransform(m), q = new DOMPoint(bb.x + bb.width, bb.y + bb.height).matrixTransform(m); return [p.x, p.y, q.x - p.x, q.y - p.y]; };
      const tasks = []; for (const [n, k] of ids) for (let i = 1; i <= k; i++) { const id = k === 1 && svg.getElementById(n) ? n : `${n}_${String(i).padStart(4, '0')}`; tasks.push([n, id, box(id)]); }
      for (const g of svg.querySelectorAll('g')) { const l = g.getAttribute('inkscape:label'); if (l === 'slices' || l === 'hotspots' || l === 'labels' || l === 'bg') g.setAttribute('style', 'display:none'); }
      const base = new XMLSerializer().serializeToString(svg);
      const outp = [];
      for (const [n, id, [x, y, w, h]] of tasks) {
        const s = base.replace(/<svg([^>]*)>/, (m, a) => '<svg' + a.replace(/\\s(width|height|viewBox)="[^"]*"/g, '') + ` viewBox="${x} ${y} ${w} ${h}" width="${px}" height="${px}">`);
        const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); await im.decode();
        const c = document.createElement('canvas'); c.width = c.height = px; c.getContext('2d').drawImage(im, 0, 0, px, px);
        outp.push([n, id, c.toDataURL('image/png').split(',')[1]]);
      }
      return outp; }""", [svgtext, names, HOT, px])
    b.close()
lines = {}
for n, id, data in res:
    fn = f'{px}x{px}/{id}.png'; (out / fn).write_bytes(base64.b64decode(data))
    h = HOT.get(n) or [12, 12]
    lines.setdefault(n, []).append(f"{px} {round(h[0]*px/24)} {round(h[1]*px/24)} {fn}" + (f" {50 if n in ('watch','left_ptr_watch') else 0}" if len(h) > 2 or n in ('watch','left_ptr_watch') else ''))
for n, ls in lines.items(): (out / f'{n}.in').write_text('\n'.join(ls) + '\n')
print(len(res), 'slices ->', out, sorted(lines))
