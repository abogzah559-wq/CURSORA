'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_ROOT = path.join(__dirname, '..');
const SELFTEST = process.argv.includes('--selftest');
const RESTORE_ARG = process.argv.find(a => a.startsWith('--restore'));

protocol.registerSchemesAsPrivileged([{ scheme: 'cursora', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const PRIMARY = SELFTEST || RESTORE_ARG || app.requestSingleInstanceLock();
if (!PRIMARY) app.quit();

let win = null;
const dataDir = () => app.getPath('userData');
const winApi = () => require('./windows')(dataDir());

/* ---------------- tiny JSON store ---------------- */
function store(name, def) {
  const file = () => path.join(dataDir(), name + '.json');
  return {
    get() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return def; } },
    set(v) { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(v, null, 1)); return v; },
  };
}
const settings = store('settings', { lang: 'ar', accent: '#a5b4fc', favorites: [], applied: null, motion: true, previewBg: 'dark' });
const mine = store('my-designs', []);

/* ---------------- window ---------------- */
function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1040, minHeight: 680, frame: false, show: false,
    backgroundColor: '#09090b', title: 'CURSORA', icon: path.join(APP_ROOT, 'build', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('cursora://app/ui/index.html' + (SELFTEST ? '?selftest=1' : ''));
  win.once('ready-to-show', () => { if (!SELFTEST) win.show(); });
  win.on('maximize', () => win.webContents.send('win:state', { max: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { max: false }));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('cursora://')) e.preventDefault(); });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  if (!PRIMARY) return;
  protocol.handle('cursora', req => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(APP_ROOT, rel));
    if (!file.startsWith(APP_ROOT) || !/^(ui|packs)[\\/]/.test(path.relative(APP_ROOT, file))) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  if (RESTORE_ARG) { // used by the uninstaller: --restore=windows | --restore=backup
    try { await winApi().restore(RESTORE_ARG.split('=')[1] || 'windows'); } catch {}
    return app.quit();
  }
  createWindow();
  if (!SELFTEST) require('./updater')(() => win);
});
app.on('window-all-closed', () => app.quit());

/* ---------------- IPC ---------------- */
ipcMain.handle('win', (e, a) => {
  if (!win) return;
  if (a === 'close') win.close();
  else if (a === 'min') win.minimize();
  else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  return { max: win.isMaximized() };
});
ipcMain.handle('info', () => ({ version: app.getVersion(), platform: process.platform, supportUrl: { ar: 'https://7krh-hub.pages.dev/ar/support/', en: 'https://7krh-hub.pages.dev/en/support/' }, repo: 'https://github.com/abogzah559-wq/CURSORA', folder: winApi().ROOT }));
ipcMain.handle('settings:get', () => settings.get());
ipcMain.handle('settings:set', (e, patch) => settings.set({ ...settings.get(), ...patch }));
ipcMain.handle('mine:get', () => mine.get());
ipcMain.handle('mine:set', (e, list) => mine.set(list));
ipcMain.handle('url', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('openFolder', () => { const d = winApi().ROOT; fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });

ipcMain.handle('cursor:apply', async (e, payload) => {
  const r = await winApi().apply(payload);
  settings.set({ ...settings.get(), applied: { name: payload.name, design: payload.design, at: Date.now() } });
  return r;
});
ipcMain.handle('cursor:restore', async (e, kind) => {
  const r = await winApi().restore(kind);
  settings.set({ ...settings.get(), applied: null });
  return r;
});
ipcMain.handle('cursor:current', () => winApi().readCurrent());
let storeApi = null; const store2 = () => (storeApi = storeApi || require('./store')(dataDir()));
ipcMain.handle('store:catalog', (e, force) => store2().catalog(!!force));
ipcMain.handle('store:download', (e, slug) => store2().download(String(slug)));
ipcMain.handle('cursor:measure', () => winApi().measure().catch(() => null));
const logFile = () => path.join(dataDir(), 'cursora.log');
ipcMain.handle('log', (e, entry) => {
  try {
    const f = logFile(); if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, JSON.stringify(entry) + '\n');
  } catch {}
});
ipcMain.handle('openLog', () => { const f = logFile(); if (!fs.existsSync(f)) fs.writeFileSync(f, ''); shell.openPath(f); });
ipcMain.handle('cursor:hasBackup', () => winApi().hasBackup());

ipcMain.handle('files:openCursors', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Cursors', extensions: ['cur', 'ani', 'ico', 'png'] }] });
  if (r.canceled) return [];
  return r.filePaths.map(p => ({ name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) }));
});
ipcMain.handle('files:openFolderCursors', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled) return null;
  const dir = r.filePaths[0];
  const files = fs.readdirSync(dir).filter(f => /\.(cur|ani)$/i.test(f)).slice(0, 60);
  let inf = ''; const infF = fs.readdirSync(dir).find(f => /\.inf$/i.test(f)); if (infF) inf = fs.readFileSync(path.join(dir, infF), 'latin1');
  return { name: path.basename(dir), inf, files: files.map(f => ({ name: f, bytes: new Uint8Array(fs.readFileSync(path.join(dir, f))) })) };
});
ipcMain.handle('design:export', async (e, design) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: (design.name || 'cursor') + '.cursora', filters: [{ name: 'CURSORA', extensions: ['cursora'] }] });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, JSON.stringify({ cursora: 1, design }, null, 1)); return true;
});
ipcMain.handle('design:import', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'CURSORA', extensions: ['cursora', 'json'] }] });
  if (r.canceled) return null;
  const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  return j.design || j;
});

/* ---------------- self-test (CI on a real Windows runner) ---------------- */
ipcMain.handle('selftest:report', async (e, report) => {
  const out = process.env.CURSORA_SELFTEST_OUT || path.join(dataDir(), 'selftest.json');
  try {
    if (report.files && process.env.CURSORA_DUMP) {
      const dump = (name, size, files) => { const d = path.join(process.env.CURSORA_DUMP, name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'size.txt'), String(size)); for (const f of files) fs.writeFileSync(path.join(d, `${f.role}.${f.ext}`), Buffer.from(f.bytes)); };
      dump('glow-selftest', report.size, report.files);
      for (const x of report.extra || []) dump(x.name, x.size, x.files);
    }
    delete report.extra;
    if (report.files) {
      const api = winApi();
      report.before = await api.readCurrent();
      report.apply = await api.apply({ name: 'SelfTest', files: report.files, size: report.size || 48 });
      // apply the same design again: new file names, and the previous files get cleaned up without touching the live ones
      await new Promise(r => setTimeout(r, 50));
      report.apply2 = await api.apply({ name: 'SelfTest', files: report.files, size: report.size || 48 });
      report.verify = await api.verify();
      report.measure = await api.measure();
      await new Promise(r => setTimeout(r, 800)); // old files are removed in the background
      report.leftovers = fs.readdirSync(report.apply2.dir).length; // 17 cursor files + scheme.txt
      report.restore = await api.restore('backup');
      report.after = await api.readCurrent();
      report.ok = report.ok && Object.entries(report.verify).filter(([k]) => require('./windows').ROLES.includes(k)).every(([, v]) => v.ok && v.exists)
        && report.verify.CursorBaseSize === (report.size || 48) && report.after.Arrow === report.before.Arrow
        && report.apply.dir === report.apply2.dir && report.leftovers === 18
        && !!(report.measure && report.measure.Arrow && report.measure.Arrow.img > 0 && report.measure.Hand.vis[1] > 0);
      report.files = report.files.map(f => ({ role: f.role, ext: f.ext, size: f.bytes.length }));
    }
  } catch (err) { report.ok = false; report.error = String(err && err.stack || err); }
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  app.exit(report.ok ? 0 : 1);
});
