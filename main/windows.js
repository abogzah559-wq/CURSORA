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

const MEASURE_PS = `
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class CursoraMeasure {
  [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr h, IntPtr id);
  [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr h, int cx, int cy, int step, IntPtr br, int flags);
  [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr h, out ICONINFO ii);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int n, ref BITMAP bm);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public bool fIcon; public int x; public int y; public IntPtr mask; public IntPtr color; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int type, w, h, wb; public short planes, bpp; public IntPtr bits; }
  public static string Measure(int id) {
    IntPtr h = LoadCursor(IntPtr.Zero, (IntPtr)id); if (h == IntPtr.Zero) return "null";
    ICONINFO ii; GetIconInfo(h, out ii); BITMAP bm = new BITMAP(); int w = 0;
    if (ii.color != IntPtr.Zero) { GetObject(ii.color, Marshal.SizeOf(bm), ref bm); w = bm.w; } else { GetObject(ii.mask, Marshal.SizeOf(bm), ref bm); w = bm.w; }
    if (ii.color != IntPtr.Zero) DeleteObject(ii.color); if (ii.mask != IntPtr.Zero) DeleteObject(ii.mask);
    int S = Math.Max(64, w + 8); var a = new Bitmap(S, S); var b = new Bitmap(S, S);
    using (var g = Graphics.FromImage(a)) { g.Clear(Color.White); var dc = g.GetHdc(); DrawIconEx(dc, 0, 0, h, 0, 0, 0, IntPtr.Zero, 3); g.ReleaseHdc(dc); }
    using (var g = Graphics.FromImage(b)) { g.Clear(Color.Black); var dc = g.GetHdc(); DrawIconEx(dc, 0, 0, h, 0, 0, 0, IntPtr.Zero, 3); g.ReleaseHdc(dc); }
    int x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (int y = 0; y < S; y++) for (int x = 0; x < S; x++) { Color p = a.GetPixel(x, y), q = b.GetPixel(x, y);
      if (!(p.R == 255 && p.G == 255 && p.B == 255) || !(q.R == 0 && q.G == 0 && q.B == 0)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    a.Dispose(); b.Dispose();
    return "{\\"img\\":" + w + ",\\"vis\\":[" + (x1 >= 0 ? x1 - x0 + 1 : 0) + "," + (y1 >= 0 ? y1 - y0 + 1 : 0) + "]}";
  }
}
'@
$ids = [ordered]@{ Arrow=32512; IBeam=32513; Wait=32514; Crosshair=32515; UpArrow=32516; SizeNWSE=32642; SizeNESW=32643; SizeWE=32644; SizeNS=32645; SizeAll=32646; No=32648; Hand=32649; AppStarting=32650; Help=32651; Pin=32671; Person=32672 }
$parts = foreach ($n in $ids.Keys) { '"' + $n + '":' + [CursoraMeasure]::Measure($ids[$n]) }
'{' + ($parts -join ',') + '}'
`;

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
    fs.mkdirSync(dir, { recursive: true });
    // every apply gets new file names: Windows keeps cursors cached by path, so re-applying an edited design
    // under the same name would otherwise keep showing the old shapes
    const stamp = Date.now().toString(36);
    const values = {};
    for (const f of files) {
      const fn = `${f.role}-${stamp}.${f.ext}`;
      fs.writeFileSync(path.join(dir, fn), Buffer.from(f.bytes));
      values[f.role] = path.join(dir, fn);
    }
    fs.writeFileSync(path.join(dir, 'scheme.txt'), ROLES.map(r => values[r] || '').join(','));
    size = Math.max(32, Math.min(256, Math.round(size || 32)));
    // register as a named scheme so it also shows in Windows' own Mouse settings
    await runPS(`$s='HKCU:\\Control Panel\\Cursors\\Schemes'; if (!(Test-Path $s)) { New-Item -Path $s -Force | Out-Null }
Set-ItemProperty -Path $s -Name ${psq(schemeName)} -Value ${psq(ROLES.map(r => values[r] || '').join(','))} -Type ExpandString`);
    await runPS(regScript(values, schemeName, size));
    // files of the previous apply of this design are no longer referenced (best effort: skip anything still locked)
    const keep = new Set(Object.values(values).map(v => path.basename(v)).concat('scheme.txt'));
    for (const n of fs.readdirSync(dir)) if (!keep.has(n)) fs.rm(path.join(dir, n), { recursive: true, force: true }, () => {});
    for (const n of fs.readdirSync(ROOT)) if (/\.(old|tmp)-\d+$/.test(n)) fs.rm(path.join(ROOT, n), { recursive: true, force: true }, () => {});
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

  // What Windows really draws right now for each system cursor: loaded image size and visible bounding box.
  async function measure() {
    if (process.platform !== 'win32') return null;
    return JSON.parse(await runPS(MEASURE_PS));
  }

  return { apply, restore, readCurrent, verify, measure, hasBackup: () => fs.existsSync(backupFile), ROOT };
};
module.exports.ROLES = ROLES;
module.exports.WINDOWS_DEFAULT = WINDOWS_DEFAULT;
