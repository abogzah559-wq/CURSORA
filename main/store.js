// "Discover": the curated catalog (built by ci/catalog.py, published on the repo's `catalog` branch) and
// downloading a set straight from rw-designer.com when the user asks for it.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { net } = require('electron');

const CATALOG_URL = 'https://raw.githubusercontent.com/abogzah559-wq/CURSORA/catalog/catalog.json';
const SITE = 'https://www.rw-designer.com';
const MAX_ZIP = 25 * 1024 * 1024;

async function fetchBuffer(url, max) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'CURSORA' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const len = +r.headers.get('content-length') || 0;
  if (max && len > max) throw new Error('too large');
  const buf = Buffer.from(await r.arrayBuffer());
  if (max && buf.length > max) throw new Error('too large');
  return buf;
}

// Minimal ZIP reader (central directory; stored and deflated entries). Only cursor files are returned.
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  let total = 0;
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('latin1');
    p += 46 + nlen + xlen + clen;
    if (!/\.(cur|ani)$/i.test(name) || usize > 4 * 1024 * 1024) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.slice(start, start + csize);
    const bytes = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: 8 * 1024 * 1024 }) : null;
    if (!bytes) continue;
    total += bytes.length; if (total > 40 * 1024 * 1024) break;
    out.push({ name: path.basename(name.replace(/\\/g, '/')), bytes: new Uint8Array(bytes) });
  }
  return out;
}

module.exports = function create(dataDir) {
  const cacheFile = path.join(dataDir, 'catalog.json');
  const zipDir = path.join(dataDir, 'discover-cache');

  async function catalog(force) {
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
    const fresh = cached && Date.now() - (cached.fetchedAt || 0) < 12 * 3600 * 1000;
    if (cached && fresh && !force) return cached;
    try {
      const j = JSON.parse((await fetchBuffer(CATALOG_URL, 20 * 1024 * 1024)).toString('utf8'));
      j.fetchedAt = Date.now();
      fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(j));
      return j;
    } catch (e) {
      if (cached) return { ...cached, offline: true };
      throw e;
    }
  }

  async function download(slug) {
    if (!/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(slug)) throw new Error('bad id');
    const f = path.join(zipDir, slug + '.zip');
    let buf = null;
    try { buf = fs.readFileSync(f); } catch {}
    if (!buf) {
      buf = await fetchBuffer(`${SITE}/cursor-downloadset/${slug}.zip`, MAX_ZIP);
      fs.mkdirSync(zipDir, { recursive: true }); fs.writeFileSync(f, buf);
    }
    return readZip(buf);
  }

  return { catalog, download };
};
module.exports.readZip = readZip;
