#!/usr/bin/env python3
"""CURSORA: import prebuilt Xcursor themes (binary files in <theme>/cursors/) into packs/.

Runs after scripts/import-packs.mjs and appends its packs to packs/index.json.
Usage: python3 scripts/import-xcursor.py <sources-dir>
"""
import json, os, struct, sys, shutil
from PIL import Image

SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '../src')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'packs')

ROLES = ['Arrow', 'Help', 'AppStarting', 'Wait', 'Crosshair', 'IBeam', 'NWPen', 'No', 'SizeNS', 'SizeWE',
         'SizeNWSE', 'SizeNESW', 'SizeAll', 'UpArrow', 'Hand', 'Pin', 'Person']
CANDIDATES = {
    'Arrow': ['left_ptr', 'default', 'arrow', 'top_left_arrow'],
    'Help': ['question_arrow', 'help', 'left_ptr_help', 'whats_this'],
    'AppStarting': ['left_ptr_watch', 'progress', 'half-busy'],
    'Wait': ['wait', 'watch'],
    'Crosshair': ['crosshair', 'cross', 'tcross'],
    'IBeam': ['xterm', 'text', 'ibeam'],
    'NWPen': ['pencil', 'draft', 'pen'],
    'No': ['circle', 'not-allowed', 'crossed_circle', 'no-drop', 'forbidden', 'dnd_no_drop'],
    'SizeNS': ['sb_v_double_arrow', 'size_ver', 'ns-resize', 'v_double_arrow', 'row-resize'],
    'SizeWE': ['sb_h_double_arrow', 'size_hor', 'ew-resize', 'h_double_arrow', 'col-resize'],
    'SizeNWSE': ['size_fdiag', 'nwse-resize', 'bd_double_arrow'],
    'SizeNESW': ['size_bdiag', 'nesw-resize', 'fd_double_arrow'],
    'SizeAll': ['fleur', 'move', 'size_all', 'all-scroll'],
    'UpArrow': ['center_ptr', 'up-arrow', 'up_arrow', 'sb_up_arrow'],
    'Hand': ['hand2', 'pointer', 'pointing_hand', 'hand'],
    'Pin': ['pin'],
    'Person': ['person'],
}
ANIMATED = {'AppStarting', 'Wait'}
MAX_FRAMES = 36


def read_xcursor(path):
    """Returns the frames of the largest nominal size: [(PIL.Image, xhot, yhot, delay)]."""
    with open(path, 'rb') as f:
        b = f.read()
    if b[:4] != b'Xcur':
        raise ValueError('not an Xcursor file')
    _, hdr, _, ntoc = struct.unpack_from('<4sIII', b, 0)
    toc = [struct.unpack_from('<III', b, hdr + i * 12) for i in range(ntoc)]
    imgs = [(sub, pos) for typ, sub, pos in toc if typ == 0xfffd0002]
    if not imgs:
        raise ValueError('no images')
    best = max(sub for sub, _ in imgs)
    out = []
    for sub, pos in imgs:
        if sub != best:
            continue
        _, _, _, _, w, h, xh, yh, delay = struct.unpack_from('<IIIIIIIII', b, pos)
        px = b[pos + 36: pos + 36 + w * h * 4]
        # Xcursor stores premultiplied ARGB (little-endian → BGRA bytes)
        im = Image.frombuffer('RGBA', (w, h), px, 'raw', 'BGRA', 0, 1).copy()
        im.putdata([(min(255, r * 255 // a), min(255, g * 255 // a), min(255, bb * 255 // a), a) if a else (0, 0, 0, 0)
                    for r, g, bb, a in im.getdata()])
        out.append((im, xh, yh, delay))
    return out


def find(cursors_dir, cand):
    p = os.path.join(cursors_dir, cand)
    if not os.path.exists(p):
        return None
    p = os.path.realpath(p)
    return p if os.path.isfile(p) else None


def import_pack(pid, name, author, license_, url, tags, desc, variants):
    """variants: [{id, name, dir (theme dir with cursors/), polarity, swatch}]"""
    shutil.rmtree(os.path.join(OUT, pid), ignore_errors=True)
    v0 = os.path.join(SRC, variants[0]['dir'], 'cursors')
    roles, found = {}, {}
    for role in ROLES:
        for cand in CANDIDATES[role]:
            f = find(v0, cand)
            if not f:
                continue
            try:
                frames = read_xcursor(f)
            except Exception as e:  # noqa
                print('  skip', pid, cand, e)
                continue
            if role in ANIMATED and len(frames) < 2:
                continue
            if role not in ANIMATED:
                frames = frames[:1]
            found[role] = cand
            break
    for v in variants:
        cdir = os.path.join(SRC, v['dir'], 'cursors')
        for role, cand in found.items():
            f = find(cdir, cand)
            frames = read_xcursor(f) if f else None
            if not frames:
                raise SystemExit(f'{pid}/{v["id"]}: missing {cand}')
            if role not in ANIMATED:
                frames = frames[:1]
            orig_n = len(frames)
            if len(frames) > MAX_FRAMES:
                step = len(frames) / MAX_FRAMES
                frames = [frames[int(i * step)] for i in range(MAX_FRAMES)]
            names = []
            for i, (im, xh, yh, delay) in enumerate(frames):
                S = max(im.width, im.height)
                sq = Image.new('RGBA', (S, S), (0, 0, 0, 0)); sq.paste(im, (0, 0))
                fn = f'{cand}-{i:02d}.png' if len(frames) > 1 else f'{cand}.png'
                os.makedirs(os.path.join(OUT, pid, v['id']), exist_ok=True)
                sq.save(os.path.join(OUT, pid, v['id'], fn), optimize=True)
                names.append(fn)
            if v is variants[0]:
                im, xh, yh, delay = frames[0]
                S = max(im.width, im.height)
                hot = [round(xh / S, 4), round(yh / S, 4)]
                roles[role] = ({'frames': names, 'delay': (frames[0][3] or 40) * orig_n / len(frames), 'hot': hot}
                               if len(names) > 1 else {'src': names[0], 'hot': hot})
    for role in ROLES:
        if role in roles:
            continue
        if role in ('Pin', 'Person', 'Help'):
            roles[role] = {'compose': 'Arrow', 'badge': role.lower()}
        elif role in ('AppStarting', 'Wait'):
            roles[role] = {'compose': 'Arrow', 'badge': 'busy'}
        else:
            roles[role] = {'ref': 'Arrow'}
    pack = {'id': pid, 'name': name, 'author': author, 'license': license_, 'url': url, 'tags': tags, 'desc': desc, 'kind': 'files',
            'variants': [{'id': v['id'], 'name': v['name'], 'dir': v['id'], 'polarity': v['polarity'], 'swatch': v['swatch']} for v in variants],
            'roles': {r: roles[r] for r in ROLES}}
    with open(os.path.join(OUT, pid, 'pack.json'), 'w') as fh:
        json.dump(pack, fh, indent=1, ensure_ascii=False)
    native = [r for r in ROLES if 'src' in roles[r] or 'frames' in roles[r]]
    print(f'{pid:16} {len(native):2} /17 native  variants={len(variants)}')
    return pid


def V(vid, name, d, pol, sw):
    return {'id': vid, 'name': name, 'dir': d, 'polarity': pol, 'swatch': sw}


NZ = 'alvatip_Nordzy-cursors/xcursors/'
nordzy_vs = [V('dark', 'Nord Dark', NZ + 'Nordzy-cursors', 'dark', ['#2e3440', '#eceff4']),
             V('white', 'Nord White', NZ + 'Nordzy-cursors-white', 'light', ['#eceff4', '#2e3440'])]
for flavour, pol in [('mocha', 'dark'), ('latte', 'light')]:
    for col, sw in [('dark', '#1e1e2e'), ('light', '#eff1f5'), ('mauve', '#cba6f7'), ('pink', '#f5c2e7'), ('blue', '#89b4fa'),
                    ('teal', '#94e2d5'), ('green', '#a6e3a1'), ('peach', '#fab387'), ('red', '#f38ba8'), ('yellow', '#f9e2af')]:
        if flavour == 'latte' and col not in ('dark', 'light'):
            continue
        nordzy_vs.append(V(f'cat-{flavour}-{col}', f'Catppuccin {flavour.title()} {col.title()}', NZ + f'Nordzy-catppuccin-{flavour}-{col}',
                           'light' if col == 'light' else ('dark' if col == 'dark' else 'color'), [sw, '#ffffff' if col != 'light' else '#1e1e2e']))

DD = 'linuxdeepin_deepin-icon-theme/'
added = [
    import_pack('nordzy', 'Nordzy', 'alvatip', 'GPL-3.0', 'https://github.com/guillaumeboehm/Nordzy-cursors', ['dark', 'light', 'color', 'rounded'],
                {'ar': 'ناعم ومدوّر بألوان Nord و Catppuccin الهادئة', 'en': 'Soft and round, Nord & Catppuccin palettes'}, nordzy_vs),
    import_pack('nordic', 'Nordic', 'Eliver Lara', 'GPL-3.0', 'https://github.com/EliverLara/Nordic', ['dark'],
                {'ar': 'غامق بألوان الشمال الباردة', 'en': 'Dark with cool northern tones'},
                [V('default', 'Nordic', 'EliverLara_Nordic/kde/cursors/Nordic-cursors', 'dark', ['#2e3440', '#88c0d0'])]),
    import_pack('dracula', 'Dracula', 'Dracula Theme', 'GPL-3.0', 'https://github.com/dracula/gtk', ['dark', 'color'],
                {'ar': 'بنفسجي غامق من ثيم دراكولا الشهير', 'en': 'Dark purple, from the Dracula theme'},
                [V('default', 'Dracula', 'dracula_gtk/kde/cursors/Dracula-cursors', 'dark', ['#282a36', '#bd93f9'])]),
    import_pack('deepin-bloom', 'Deepin Bloom', 'Deepin Technology', 'GPL-3.0', 'https://github.com/linuxdeepin/deepin-icon-theme', ['dark', 'light', 'color'],
                {'ar': 'ماوس نظام Deepin الرسمي بنسخه الأربع', 'en': 'The official Deepin cursors, four styles'},
                [V('bloom', 'Bloom', DD + 'bloom', 'light', ['#ffffff', '#1a1a1a']), V('bloom-dark', 'Bloom Dark', DD + 'bloom-dark', 'dark', ['#1a1a1a', '#ffffff']),
                 V('fantacy', 'Fantasy', DD + 'bloom-fantacy', 'color', ['#7c6cff', '#ffffff']), V('vintage', 'Vintage', DD + 'vintage', 'light', ['#f2f2f2', '#333333'])]),
    import_pack('yaru', 'Yaru', 'Canonical / Ubuntu', 'CC-BY-SA-4.0', 'https://github.com/ubuntu/yaru', ['light', 'classic'],
                {'ar': 'ماوس أوبونتو الرسمي', 'en': 'The official Ubuntu cursor'},
                [V('default', 'Yaru', 'ubuntu_yaru/icons/Yaru', 'light', ['#ffffff', '#2c2c2c'])]),
    import_pack('breeze-adapta', 'Breeze Adapta', 'mustafaozhan', 'LGPL-3.0', 'https://github.com/mustafaozhan/Breeze-Adapta-Cursor', ['dark', 'color'],
                {'ar': 'غامق بلمسة تركوازية من ثيم Adapta', 'en': 'Dark with an Adapta teal touch'},
                [V('default', 'Adapta', 'mustafaozhan_Breeze-Adapta-Cursor', 'dark', ['#263238', '#00bcd4'])]),
]

idx_file = os.path.join(OUT, 'index.json')
idx = json.load(open(idx_file))
for pid in added:
    if pid not in idx['packs']:
        idx['packs'].append(pid)
json.dump(idx, open(idx_file, 'w'))


# ---- duplicates: same shapes in different colours become variants of one pack; exact look-alikes are dropped
def load(pid):
    return json.load(open(os.path.join(OUT, pid, 'pack.json')))


def save(p):
    json.dump(p, open(os.path.join(OUT, p['id'], 'pack.json'), 'w'), indent=1, ensure_ascii=False)


def merge(target, src, label):
    t, f = load(target), load(src)
    for v in f['variants']:
        nid = f'{src}-{v["id"]}'
        shutil.copytree(os.path.join(OUT, src, v['dir']), os.path.join(OUT, target, nid), dirs_exist_ok=True)
        t['variants'].append({**v, 'id': nid, 'dir': nid, 'name': label})
    t['author'] = ', '.join(dict.fromkeys([t['author'], f['author']]))
    save(t)
    drop(src, target)


def drop(pid, alias_to):
    shutil.rmtree(os.path.join(OUT, pid), ignore_errors=True)
    idx = json.load(open(idx_file))
    idx['packs'] = [x for x in idx['packs'] if x != pid]
    idx.setdefault('aliases', {})[pid] = alias_to
    json.dump(idx, open(idx_file, 'w'))


merge('nordic', 'dracula', 'Dracula')
merge('nordic', 'breeze-adapta', 'Adapta')
n = load('nordic'); n.update(desc={'ar': 'نفس التصميم بثلاث أجواء غامقة: Nordic و Dracula و Adapta', 'en': 'One design, three dark moods: Nordic, Dracula, Adapta'},
                         tags=['dark', 'color'], license='GPL-3.0 / LGPL-3.0'); save(n)
drop('yaru', 'notwaita')          # Yaru is Adwaita-based, same shapes as Notwaita
drop('deepin-v20', 'deepin-bloom')  # a recreation of the official Deepin cursors we now ship
print('packs:', len(json.load(open(idx_file))['packs']))
