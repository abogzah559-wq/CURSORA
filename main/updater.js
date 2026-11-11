// Quiet in-app updates from the project's GitHub releases. Nothing pops up: the renderer shows a small pill in the
// title bar when a new version exists; one click downloads it (only the changed blocks when possible), a second
// click restarts into it.
'use strict';
const { app, ipcMain } = require('electron');

module.exports = function setupUpdates(getWin) {
  let updater = null;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  if (!app.isPackaged) return;
  const send = (state, extra) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('update', { state, ...extra }); };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('update-available', i => send('available', { version: i.version }));
  updater.on('download-progress', p => send('progress', { percent: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', i => send('ready', { version: i.version }));
  updater.on('error', e => send('error', { message: String((e && e.message) || e).slice(0, 200) }));
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 6 * 3600 * 1000);
  ipcMain.handle('update:download', () => updater.downloadUpdate().catch(e => send('error', { message: String(e.message || e) })));
  ipcMain.handle('update:install', () => updater.quitAndInstall(true, true));
};
