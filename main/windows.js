// Windows cursor scheme management: writes files to a folder that survives uninstall,
// registers a real cursor scheme in HKCU and refreshes the system cursors instantly.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ROLES = ['Arrow', 'Help', 'AppStarting', 'Wait', 'Crosshair', 'IBeam', 'NWPen', 'No', 'SizeNS', 'SizeWE',
  'SizeNWSE', 'SizeNESW', 'SizeAll', 'UpArrow', 'Hand', 'Pin', 'Person'];

const WINDOWS_DEFAULT = {
  Arrow: '%SystemRoot%\\cursors\\aero_arrow.cur', Help: '%SystemRoot%\\cursors\\aero_helpsel.cur',
  AppStarting: '%SystemRoot%\\cursors\\aero_working.ani', Wait: '%SystemRoot%\\cursors\\aero_busy.ani',
  Crosshair: '', IBeam: '', NWPen: '%SystemRoot%\\cursors\\aero_pen.cur', No: '%SystemRoot%\\cursors\\aero_unavail.cur',
  SizeNS: '%SystemRoot%\\cursors\\aero_ns.cur', SizeWE: '%SystemRoot%\\cursors\\aero_ew.cur',
  SizeNWSE: '%SystemRoot%\\cursors\\aero_nwse.cur', SizeNESW: '%SystemRoot%\\cursors\\aero_nesw.cur',
  SizeAll: '%SystemRoot%\\cursors\\aero_move.cur', UpArrow: '%SystemRoot%\\cursors\\aero_up.cur',
  Hand: '%SystemRoot%\\cursors\\aero_link.cur', Pin: '%SystemRoot%\\cursors\\aero_pin.cur', Person: '%SystemRoot%\\cursors\\aero_person.cur',
};

const ROOT = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CursoraCursors');

const psq = s => "'" + String(s).replace(/'/g, "''") + "'";

function runPS(script) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `cursora-${process.pid}-${Date.now()}.ps1`);
    fs.writeFileSync(file, '﻿' + script, 'utf8'); // BOM so PowerShell 5 reads Unicode names correctly
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        fs.rm(file, () => {});
        if (err) return reject(new Error((stderr || err.message).trim()));
        resolve(stdout.trim());
      });
  });
}

const SPI_PS = `
Add-Type -Namespace Cursora -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError=true)] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);
'@
`;

function regScript(values, schemeName, size) {
  const lines = [SPI_PS, `$k = 'HKCU:\\Control Panel\\Cursors'`];
  for (const role of ROLES) lines.push(`Set-ItemProperty -Path $k -Name ${psq(role)} -Value ${psq(values[role] || '')} -Type ExpandString`);
  lines.push(`Set-ItemProperty -Path $k -Name '(default)' -Value ${psq(schemeName)}`);
  lines.push(`Set-ItemProperty -Path $k -Name 'Scheme Source' -Value ${schemeName === 'Windows Default' ? 2 : 1} -Type DWord`);
  if (size) {
    lines.push(`Set-ItemProperty -Path $k -Name 'CursorBaseSize' -Value ${size | 0} -Type DWord`);
    // undocumented SPI used by the Settings app to change the cursor size live (Win10 1903+)
    lines.push(`[void][Cursora.Native]::SystemParametersInfo(0x2029, 0, [IntPtr]${size | 0}, 0x01)`);
  }
  lines.push(`[void][Cursora.Native]::SystemParametersInfo(0x57, 0, [IntPtr]::Zero, 0x03)`);
  lines.push(`'ok'`);
  return lines.join('\n');
}

async function readCurrent() {
  const out = await runPS(`$k = Get-ItemProperty -Path 'HKCU:\\Control Panel\\Cursors'
$o = @{}
foreach ($n in @(${ROLES.map(psq).join(',')}, '(default)', 'Scheme Source', 'CursorBaseSize')) { $o[$n] = $k.$n }
$raw = Get-Item 'HKCU:\\Control Panel\\Cursors'
foreach ($n in @(${ROLES.map(psq).join(',')})) { $o[$n] = $raw.GetValue($n, '', 'DoNotExpandEnvironmentNames') }
$o | ConvertTo-Json -Compress`);
  return JSON.parse(out || '{}');
}

const safe = s => (String(s || 'CURSORA').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'CURSORA').slice(0, 60);

module.exports = function create(dataDir) {
  const backupFile = path.join(dataDir, 'original-cursors.json');

  async function ensureBackup() {
    if (fs.existsSync(backupFile)) return;
    const cur = await readCurrent();
    fs.writeFileSync(backupFile, JSON.stringify(cur, null, 1));
  }

  async function apply({ name, files, size }) {
    if (process.platform !== 'win32') throw new Error('Windows only');
    await ensureBackup();
    const schemeName = 'CURSORA - ' + safe(name);
    const dir = path.join(ROOT, safe(name));
    const tmp = dir + '.tmp-' + Date.now();
    fs.mkdirSync(tmp, { recursive: true });
    const values = {};
    for (const f of files) {
      const fn = `${f.role}.${f.ext}`;
      fs.writeFileSync(path.join(tmp, fn), Buffer.from(f.bytes));
      values[f.role] = path.join(dir, fn);
    }
    // swap the folder in place (a stale copy may still be in use by Windows — rename it away first)
    if (fs.existsSync(dir)) { const old = dir + '.old-' + Date.now(); try { fs.renameSync(dir, old); fs.rm(old, { recursive: true, force: true }, () => {}); } catch { fs.rmSync(dir, { recursive: true, force: true }); } }
    fs.renameSync(tmp, dir);
    fs.writeFileSync(path.join(dir, 'scheme.txt'), ROLES.map(r => values[r] || '').join(','));
    // register as a named scheme so it also shows in Windows' own Mouse settings
    await runPS(`$s='HKCU:\\Control Panel\\Cursors\\Schemes'; if (!(Test-Path $s)) { New-Item -Path $s -Force | Out-Null }
Set-ItemProperty -Path $s -Name ${psq(schemeName)} -Value ${psq(ROLES.map(r => values[r] || '').join(','))} -Type ExpandString`);
    await runPS(regScript(values, schemeName, size));
    return { dir, scheme: schemeName };
  }

  async function restore(kind) {
    if (process.platform !== 'win32') throw new Error('Windows only');
    if (kind === 'backup' && fs.existsSync(backupFile)) {
      const b = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      const values = {}; for (const r of ROLES) values[r] = b[r] || '';
      await runPS(regScript(values, b['(default)'] || 'Windows Default', b.CursorBaseSize || 32));
      return 'backup';
    }
    await runPS(regScript(WINDOWS_DEFAULT, 'Windows Default', 32));
    return 'windows';
  }

  async function verify() {
    // Loads every file of the active scheme the way Windows does; used by the self-test.
    return JSON.parse(await runPS(`${SPI_PS}
Add-Type -Namespace Cursora -Name Load -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr LoadCursorFromFile(string f);
'@
$raw = Get-Item 'HKCU:\\Control Panel\\Cursors'
$r = @{}
foreach ($n in @(${ROLES.map(psq).join(',')})) { $p = $raw.GetValue($n, ''); $h = if ($p) { [Cursora.Load]::LoadCursorFromFile($p) } else { [IntPtr]::Zero }; $r[$n] = @{ path = $p; ok = ($h -ne [IntPtr]::Zero); exists = ($p -and (Test-Path $p)) } }
$r['(default)'] = $raw.GetValue('(default)', '')
$r['CursorBaseSize'] = $raw.GetValue('CursorBaseSize', 0)
$r | ConvertTo-Json -Compress -Depth 4`));
  }

  return { apply, restore, readCurrent, verify, hasBackup: () => fs.existsSync(backupFile), ROOT };
};
module.exports.ROLES = ROLES;
module.exports.WINDOWS_DEFAULT = WINDOWS_DEFAULT;
