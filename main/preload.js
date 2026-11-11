'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, ...a) => ipcRenderer.invoke(c, ...a);

contextBridge.exposeInMainWorld('cursora', {
  win: a => inv('win', a),
  onWinState: cb => ipcRenderer.on('win:state', (e, s) => cb(s)),
  onUpdate: cb => ipcRenderer.on('update', (e, s) => cb(s)),
  updateDownload: () => inv('update:download'),
  updateInstall: () => inv('update:install'),
  info: () => inv('info'),
  settings: { get: () => inv('settings:get'), set: p => inv('settings:set', p) },
  mine: { get: () => inv('mine:get'), set: l => inv('mine:set', l) },
  url: u => inv('url', u),
  openFolder: () => inv('openFolder'),
  apply: p => inv('cursor:apply', p),
  restore: k => inv('cursor:restore', k),
  current: () => inv('cursor:current'),
  measure: () => inv('cursor:measure'),
  catalog: force => inv('store:catalog', force),
  downloadSet: slug => inv('store:download', slug),
  log: e => inv('log', e),
  openLog: () => inv('openLog'),
  hasBackup: () => inv('cursor:hasBackup'),
  openCursors: () => inv('files:openCursors'),
  openFolderCursors: () => inv('files:openFolderCursors'),
  exportDesign: d => inv('design:export', d),
  importDesign: () => inv('design:import'),
  selftestReport: r => inv('selftest:report', r),
});
