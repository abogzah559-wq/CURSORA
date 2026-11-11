import sys, os, requests
mode, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
H = {'User-Agent': 'CURSORA-catalog/1.0'}
if mode == 'explore':
    for name, url in [('list.html', 'https://www.rw-designer.com/cursor-library/set-0'), ('set.html', 'https://www.rw-designer.com/cursor-set/hypnospace'),
                      ('list_top.html', 'https://www.rw-designer.com/cursor-library/sets-top-rated')]:
        r = requests.get(url, headers=H, timeout=30); open(os.path.join(out, name), 'wb').write(r.content); print(name, r.status_code, len(r.content))
    r = requests.get('https://www.rw-designer.com/cursor-downloadset/hypnospace.zip', headers=H, timeout=60)
    open(os.path.join(out, 'set.zip'), 'wb').write(r.content); print('zip', r.status_code, len(r.content), r.headers.get('content-type'))
