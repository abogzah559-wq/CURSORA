import sys, subprocess, time, pathlib, json
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
roles = sys.argv[1].split(','); S = int(sys.argv[2]); out = sys.argv[3]; first = len(sys.argv) > 4
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = b.new_page(); pg.on('console', lambda m: print('console:', m.text))
        pg.goto('http://127.0.0.1:8765/tools/sheet.html')
        w, h = pg.evaluate(f'sheet({json.dumps(roles)}, {S}, {"true" if first else "false"})')
        pg.set_viewport_size({'width': w, 'height': h}); pg.screenshot(path=out, full_page=True); b.close()
finally: srv.terminate()
