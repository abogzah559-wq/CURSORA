#!/usr/bin/env python3
"""Builds CURSORA's "Discover" catalog from the rw-designer.com cursor library.

Every set is checked automatically before it can appear in the app:
  * complete      – at least 8 Windows roles, including arrow, link, text and busy/working
  * high quality  – 48 px or larger, or 32 px with smooth (anti-aliased) edges; old pixel-art sets are left out
  * not a repeat  – shapes are compared with every other set and with the bundled packs; only the best of a
                    group of look-alikes is kept
Then the survivors are ranked (popularity, rating, size, smoothness, rich/dark colours).

The catalog only stores metadata (names, authors, licences, ids). Cursor images stay on rw-designer.com:
the app shows their previews from there and downloads a set only when the user asks for it.

Usage: python ci/catalog.py build <out-dir>
"""
import concurrent.futures as cf
import colorsys
import io
import json
import math
import os
import re
import struct
import sys
import threading
import time
import zipfile

import requests
from PIL import Image, ImageDraw

BASE = 'https://www.rw-designer.com'
UA = {'User-Agent': 'CURSORA-catalog/1.0'}
ROLE_CLASS = {
    'curarrow': 'Arrow', 'curhelp': 'Help', 'curwork': 'AppStarting', 'curbusy': 'Wait', 'curprec': 'Crosshair',
    'curtext': 'IBeam', 'curpen': 'NWPen', 'curhand': 'NWPen', 'curunav': 'No', 'curvert': 'SizeNS', 'curhorz': 'SizeWE',
    'curnwse': 'SizeNWSE', 'curnesw': 'SizeNESW', 'curmove': 'SizeAll', 'curalt': 'UpArrow', 'curlink': 'Hand',
    'curpin': 'Pin', 'curperson': 'Person',
}
CORE = ['Arrow', 'Hand', 'IBeam']

session = requests.Session()
session.headers.update(UA)
lock = threading.Lock()
THUMBS = {}  # slug -> list of small RGBA images, only for the review sheets
log_lines = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    with lock:
        log_lines.append(line)
        print(line, flush=True)


def get(url, binary=False, tries=4):
    for i in range(tries):
        try:
            r = session.get(url, timeout=40)
            if r.status_code == 200:
                return r.content if binary else r.text
            if r.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(2 + i * 3)
    return None


# ---------------------------------------------------------------- listing
def list_page(start):
    html = get(f'{BASE}/cursor-library/set-{start}')
    if not html:
        return []
    out = []
    for m in re.finditer(r'<div class="itemteaser">(.*?)</div></div>', html, re.S):
        blk = m.group(1)
        slug = re.search(r'href="/cursor-set/([^"]+)"', blk)
        if not slug:
            continue
        name = re.search(r'<span class="setname">(.*?)</span>', blk)
        author = re.search(r'class="name" href="[^"]*">(.*?)</a>', blk)
        dl = re.search(r'title="(\d+) downloads', blk)
        out.append({'slug': slug.group(1), 'name': unescape(name.group(1)) if name else slug.group(1),
                    'author': unescape(author.group(1)) if author else '', 'downloads': int(dl.group(1)) if dl else 0,
                    'top': 'toprated' in blk})
    time.sleep(0.3)
    return out


def unescape(s):
    import html
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()


# ---------------------------------------------------------------- set page
def set_page(slug):
    html = get(f'{BASE}/cursor-set/{slug}')
    time.sleep(0.3)
    if not html:
        return None
    lic = re.search(r'under the <strong>(.*?)</strong>', html)
    members = []
    for m in re.finditer(r'<div id="cellcu(\d+)" class="itemteaser ([^"]*)"><a class="download" href="/cursor-download/\d+/([^"]+)"', html):
        cls = [c for c in m.group(2).split() if c.startswith('cur')]
        members.append({'id': int(m.group(1)), 'cls': cls[0] if cls else '', 'file': requests.utils.unquote(m.group(3))})
    rating = re.search(r'class="rat-img"><span class="(\w+)"', html)
    return {'license': unescape(lic.group(1)) if lic else '', 'members': members, 'rating': rating.group(1) if rating else ''}


def map_roles(members):
    roles = {}
    for mem in members:
        role = ROLE_CLASS.get(mem['cls'])
        if role and role not in roles:
            roles[role] = mem
    return roles


# ---------------------------------------------------------------- decoding
def dib_to_image(d, w, h):
    hdr = struct.unpack_from('<I', d, 0)[0]
    W, H2, _, bpp = struct.unpack_from('<iiHH', d, 4)
    W = W or w
    H = abs(H2) // 2 or h
    ncol = struct.unpack_from('<I', d, 32)[0] if len(d) > 36 else 0
    if bpp <= 8 and not ncol:
        ncol = 1 << bpp
    pal_off = hdr
    data_off = hdr + (ncol * 4 if bpp <= 8 else 0)
    row = ((W * bpp + 31) // 32) * 4
    mask_off = data_off + row * H
    mrow = ((W + 31) // 32) * 4
    px = bytearray(W * H * 4)
    any_alpha = False
    for y in range(H):
        src = data_off + (H - 1 - y) * row
        for x in range(W):
            i = (y * W + x) * 4
            if bpp == 32:
                b, g, r, a = d[src + x * 4: src + x * 4 + 4]
                if a:
                    any_alpha = True
            elif bpp == 24:
                b, g, r = d[src + x * 3: src + x * 3 + 3]
                a = 255
            else:
                bit = x * bpp
                v = (d[src + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1)
                b, g, r = d[pal_off + v * 4: pal_off + v * 4 + 3]
                a = 255
            px[i:i + 4] = bytes((r, g, b, a))
    if bpp != 32 or not any_alpha:
        for y in range(H):
            for x in range(W):
                mo = mask_off + (H - 1 - y) * mrow + (x >> 3)
                if mo < len(d) and d[mo] & (0x80 >> (x & 7)):
                    px[(y * W + x) * 4 + 3] = 0
    return Image.frombytes('RGBA', (W, H), bytes(px)), bpp


def decode_ico(b):
    """Returns (largest image RGBA, its size, bpp, (hx, hy) normalised)."""
    n = struct.unpack_from('<H', b, 4)[0]
    best = None
    for i in range(n):
        w, h, _, _, hx, hy, ln, off = struct.unpack_from('<BBBBHHII', b, 6 + i * 16)
        w = w or 256
        h = h or 256
        if not best or w > best[0]:
            best = (w, h, hx, hy, b[off:off + ln])
    w, h, hx, hy, d = best
    if d[:4] == b'\x89PNG':
        im = Image.open(io.BytesIO(d)).convert('RGBA')
        bpp = 32
    else:
        im, bpp = dib_to_image(d, w, h)
    return im, im.width, bpp, (hx / im.width, hy / im.height)


def decode_cursor(b):
    """Static or animated cursor → (first frame RGBA, size, bpp, hot, frame count)."""
    if b[:4] == b'RIFF':
        frames = []
        def walk(o, end):
            while o + 8 <= end:
                cid = b[o:o + 4]
                ln = struct.unpack_from('<I', b, o + 4)[0]
                body = o + 8
                if cid == b'LIST':
                    walk(body + 4, body + ln)
                elif cid == b'icon':
                    frames.append(b[body:body + ln])
                o = body + ln + (ln & 1)
        walk(12, len(b))
        if not frames:
            raise ValueError('empty ani')
        im, size, bpp, hot = decode_ico(frames[0])
        return im, size, bpp, hot, len(frames)
    im, size, bpp, hot = decode_ico(b)
    return im, size, bpp, hot, 1


# ---------------------------------------------------------------- metrics
def shape_hash(im):
    a = im.getchannel('A')
    bb = a.point(lambda v: 255 if v > 60 else 0).getbbox()
    if not bb:
        return '0' * 256
    g = a.crop(bb).resize((16, 16), Image.BILINEAR)
    return ''.join('1' if v > 100 else '0' for v in g.getdata())


def colour_stats(ims):
    sats, lums, hues = [], [], []
    for im in ims:
        small = im.resize((32, 32), Image.BILINEAR)
        for r, g, b, a in small.getdata():
            if a < 200:
                continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            lums.append(l)
            if l > 0.08 and l < 0.92:
                sats.append(s)
                if s > 0.25:
                    hues.append(h)
    if not lums:
        return {'lum': 0.5, 'sat': 0, 'hue': None}
    hue = None
    if len(hues) > len(lums) * 0.1:
        x = sum(math.cos(h * 2 * math.pi) for h in hues)
        y = sum(math.sin(h * 2 * math.pi) for h in hues)
        hue = (math.atan2(y, x) / (2 * math.pi)) % 1
    return {'lum': sum(lums) / len(lums), 'sat': (sum(sats) / len(sats)) if sats else 0, 'hue': hue}


def smoothness(im):
    a = list(im.getchannel('A').getdata())
    vis = [v for v in a if v > 0]
    if not vis:
        return 0
    return sum(1 for v in vis if 12 < v < 243) / len(vis)


def analyse(entry, page):
    roles = map_roles(page['members'])
    have = set(roles)
    if len(have) < 8 or not all(r in have for r in CORE) or not ({'Wait', 'AppStarting'} & have):
        return None, 'incomplete'
    raw = get(f'{BASE}/cursor-downloadset/{entry["slug"]}.zip', binary=True)
    time.sleep(0.3)
    if not raw:
        return None, 'no-zip'
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        return None, 'bad-zip'
    names = {n.lower(): n for n in z.namelist()}
    decoded = {}
    animated = 0
    for role, mem in roles.items():
        n = names.get(mem['file'].lower())
        if not n:
            continue
        try:
            im, size, bpp, hot, nf = decode_cursor(z.read(n))
        except Exception:
            continue
        decoded[role] = (im, size, bpp, hot, nf)
        animated += nf > 1
    if not all(r in decoded for r in CORE):
        return None, 'undecodable'
    arrow = decoded['Arrow']
    core_sizes = [decoded[r][1] for r in CORE]
    smooth = sum(smoothness(decoded[r][0]) for r in CORE) / 3
    col = colour_stats([decoded[r][0] for r in CORE])
    # 48 px and up: crisp at any size. 32 px: only with smooth (anti-aliased) edges — old pixel-art sets stay out
    if min(core_sizes) < 32:
        return None, 'small'
    if smooth < (0.06 if min(core_sizes) >= 48 else 0.15):
        return None, 'jaggy' if min(core_sizes) >= 48 else 'small'
    # every shape of the core must actually be visible and not a stretched blob
    for r in CORE:
        bb = decoded[r][0].getchannel('A').point(lambda v: 255 if v > 60 else 0).getbbox()
        if not bb or (bb[2] - bb[0]) < decoded[r][1] * 0.15:
            return None, 'empty-shape'
    item = {
        **entry, 'license': page['license'], 'rating': page['rating'],
        'roles': {r: {'id': m['id'], 'file': m['file']} for r, m in roles.items()},
        'size': min(core_sizes), 'hd': min(core_sizes) >= 48, 'smooth': round(smooth, 3), 'animated': animated,
        'lum': round(col['lum'], 3), 'sat': round(col['sat'], 3), 'hue': None if col['hue'] is None else round(col['hue'], 3),
        'hash': {r: shape_hash(decoded[r][0]) for r in CORE},
        'hot': [round(v, 3) for v in arrow[3]],
    }
    thumbs = []
    for r in ['Arrow', 'Hand', 'IBeam', 'Wait' if 'Wait' in decoded else 'AppStarting', 'SizeAll', 'No']:
        if r in decoded:
            im = decoded[r][0].copy(); im.thumbnail((48, 48), Image.LANCZOS); thumbs.append(im)
    with lock:
        THUMBS[entry['slug']] = thumbs
    return item, 'ok'


def score(it):
    s = math.log10(1 + it['downloads']) * 2.0
    s += 2.5 if it['top'] else 0
    s += {'r5': 2, 'r4': 1.2, 'r3': 0.4}.get(it['rating'][:2], 0)
    s += min(it['size'], 128) / 64 + (1.5 if it['size'] >= 48 else 0)
    s += it['smooth'] * 3
    s += it['animated'] * 0.4
    # rich, dark colours rank higher; washed-out mid greys lower
    s += (1 - it['lum']) * 1.5 + it['sat'] * 1.5
    if 0.35 < it['lum'] < 0.65 and it['sat'] < 0.15:
        s -= 1
    return round(s, 3)


def hamming(a, b):
    return sum(x != y for x, y in zip(a, b))


def dedupe(items, bundled):
    kept = []
    for it in sorted(items, key=lambda x: -x['score']):
        dup = False
        for ref in kept + bundled:
            d = sum(hamming(it['hash'][r], ref['hash'][r]) for r in CORE if r in ref['hash']) / 3
            same_colour = ref.get('hue') is None or it['hue'] is None or abs((it['hue'] - ref['hue'] + 0.5) % 1 - 0.5) < 0.06
            if d < 14 or (d < 24 and same_colour and abs(it['lum'] - ref.get('lum', it['lum'])) < 0.15):
                dup = True
                if ref in kept:
                    ref.setdefault('alts', []).append(it['slug'])
                break
        if not dup:
            kept.append(it)
    return kept


def main():
    mode, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    limit = int(os.environ.get('CATALOG_LIMIT', '0'))
    first = get(f'{BASE}/cursor-library/set-0') or ''
    last = max([int(x) for x in re.findall(r'/cursor-library/set-(\d+)', first)] or [0])
    starts = list(range(0, last + 1, 40))
    if limit:
        starts = starts[:max(1, limit // 40)]
    log('listing pages', len(starts))
    entries = []
    with cf.ThreadPoolExecutor(3) as ex:
        for r in ex.map(list_page, starts):
            entries.extend(r)
    seen = set()
    entries = [e for e in entries if not (e['slug'] in seen or seen.add(e['slug']))]
    log('sets', len(entries))

    stats = {}
    items = []

    def work(e):
        page = set_page(e['slug'])
        if not page:
            return None, 'no-page'
        if len(map_roles(page['members'])) < 8:
            return None, 'incomplete'
        return analyse(e, page)

    with cf.ThreadPoolExecutor(3) as ex:
        for i, (it, why) in enumerate(ex.map(work, entries)):
            stats[why] = stats.get(why, 0) + 1
            if it:
                it['score'] = score(it)
                items.append(it)
            if i % 250 == 0:
                log('progress', i, stats)
    log('analysed', stats)

    bundled = json.load(open(os.path.join(os.path.dirname(__file__), 'bundled-hashes.json'))) if os.path.exists(os.path.join(os.path.dirname(__file__), 'bundled-hashes.json')) else []
    kept = dedupe(items, bundled)
    log('after dedupe', len(kept), 'of', len(items))
    for it in kept:
        it.pop('hash', None)
    # the app only shows the hand-picked sets listed in curated.txt; everything else stays in the review sheets
    cur_file = os.path.join(os.path.dirname(__file__), 'curated.txt')
    published = kept
    if os.path.exists(cur_file):
        picked = [l.strip() for l in open(cur_file, encoding='utf-8') if l.strip() and not l.startswith('#')]
        by_slug = {it['slug']: it for it in kept}
        published = [by_slug[s] for s in picked if s in by_slug]
        log('curated', len(published), 'of', len(picked), 'listed')
    json.dump({'source': 'rw-designer.com', 'built': int(time.time()), 'items': published}, open(os.path.join(out, 'catalog.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump(items and sorted([{k: v for k, v in i.items() if k != 'hash'} for i in items], key=lambda x: -x['score']), open(os.path.join(out, 'all-candidates.json'), 'w'), ensure_ascii=False)
    # review sheets: every kept set, best first, numbered — for a human pass before publishing
    os.makedirs(os.path.join(out, 'review'), exist_ok=True)
    per = 60
    for sheet in range(0, len(kept), per):
        chunk = kept[sheet:sheet + per]
        W, RH = 2 * (6 * 56 + 230), 60
        img = Image.new('RGB', (W, (len(chunk) + 1) // 2 * RH), (24, 24, 28))
        dr = ImageDraw.Draw(img)
        for i, it in enumerate(chunk):
            x0, y0 = (i % 2) * (W // 2), (i // 2) * RH
            dr.text((x0 + 6, y0 + 22), f"{sheet + i:04d} {it['slug'][:26]}", fill=(220, 220, 225))
            for k, th in enumerate(THUMBS.get(it['slug'], [])):
                bg = Image.new('RGBA', (52, 52), (70, 72, 80, 255) if k % 2 else (150, 152, 160, 255))
                bg.alpha_composite(th, ((52 - th.width) // 2, (52 - th.height) // 2))
                img.paste(bg.convert('RGB'), (x0 + 220 + k * 56, y0 + 4))
        img.save(os.path.join(out, 'review', f'sheet-{sheet // per:03d}.png'), optimize=True)
    open(os.path.join(out, 'log.txt'), 'w').write('\n'.join(log_lines))


if __name__ == '__main__':
    main()
