// Browser preview bridge: used only when the UI runs outside Electron (design/testing).
if (!window.cursora) {
  const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} return v; };
  window.cursora = {
    mock: true,
    win: async () => ({ max: false }), onWinState: () => {},
    info: async () => ({ version: 'dev', platform: 'web', supportUrl: { ar: 'https://7krh-hub.pages.dev/ar/support/', en: 'https://7krh-hub.pages.dev/en/support/' }, repo: 'https://github.com/abogzah559-wq/CURSORA' }),
    settings: { get: async () => ls('cs.settings', { lang: 'ar', accent: '#a5b4fc', favorites: [], applied: null, motion: true }), set: async p => put('cs.settings', { ...ls('cs.settings', {}), ...p }) },
    mine: { get: async () => ls('cs.mine', []), set: async l => put('cs.mine', l) },
    url: async u => window.open(u, '_blank'), openFolder: async () => {},
    apply: async p => { await new Promise(r => setTimeout(r, 500)); const s = ls('cs.settings', {}); put('cs.settings', { ...s, applied: { name: p.name, design: p.design, at: Date.now() } }); return { mock: true }; },
    restore: async () => { const s = ls('cs.settings', {}); put('cs.settings', { ...s, applied: null }); return 'windows'; },
    current: async () => ({}), measure: async () => null, log: async () => {}, openLog: async () => {}, hasBackup: async () => true,
    openCursors: async () => [], openFolderCursors: async () => null,
    exportDesign: async d => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ cursora: 1, design: d })])); a.download = (d.name || 'cursor') + '.cursora'; a.click(); return true; },
    importDesign: async () => null, selftestReport: async r => console.log('SELFTEST ' + JSON.stringify({ ...r, files: (r.files || []).length })),
  };
}
