import json, sys, os, subprocess, time, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = b.new_page(); pg.goto('http://127.0.0.1:8765/tools/analyze.html')
        res = pg.evaluate('analyze()')
        b.close()
finally:
    srv.terminate()
TARGET = 0.62
for pid, r in res.items():
    pj = root / 'packs' / pid / 'pack.json'; p = json.loads(pj.read_text())
    p['bbox'] = r['bbox']
    a = r['bbox'].get('Arrow')
    if a:
        h = max(a[3]-a[1], (a[2]-a[0]))
        p['fit'] = round(min(1.6, max(0.45, TARGET / h)), 3) if pid != 'google-dot' else round(min(1.6, max(0.3, 0.42 / h)), 3)
    for v in p['variants']:
        if v['id'] in r.get('variants', {}): v.update(r['variants'][v['id']])
    pj.write_text(json.dumps(p, indent=1))
    print(f"{pid:16} fit={p.get('fit')} arrow={a} err={r['errors'][:3]}")
json.dump({k: v['hashes'] for k, v in res.items()}, open('/tmp/hashes.json', 'w'))
