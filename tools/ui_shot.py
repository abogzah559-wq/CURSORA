import sys, subprocess, time, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
steps = sys.argv[1:]
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = b.new_page(viewport={'width': 1320, 'height': 840}, device_scale_factor=1)
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
        pg.goto('http://127.0.0.1:8766/ui/index.html'); pg.wait_for_timeout(2500)
        for s in steps:
            if s.startswith('js:'): pg.evaluate(s[3:]); pg.wait_for_timeout(1500)
            elif s.startswith('shot:'): pg.screenshot(path=s[5:])
            elif s.startswith('hover:'): pg.hover(s[6:]); pg.wait_for_timeout(600)
            elif s.startswith('click:'): pg.click(s[6:]); pg.wait_for_timeout(1200)
            elif s.startswith('wait:'): pg.wait_for_timeout(int(s[5:]))
        print('\n'.join(errs[:20]))
        b.close()
finally: srv.terminate()
