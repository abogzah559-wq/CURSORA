# Applies each dumped cursor set through the registry exactly like the app does, then measures
# what Windows really draws for every system cursor (loaded image size + visible bounding box).
param([string]$Root, [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Runtime.InteropServices;
public static class CM {
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, IntPtr id);
  [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr h, int cx, int cy, int step, IntPtr br, int flags);
  [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr h, out ICONINFO ii);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("gdi32.dll")] public static extern int GetObject(IntPtr h, int n, ref BITMAP bm);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct ICONINFO { public bool fIcon; public int x; public int y; public IntPtr mask; public IntPtr color; }
  [StructLayout(LayoutKind.Sequential)] public struct BITMAP { public int type, w, h, wb; public short planes, bpp; public IntPtr bits; }
  public static int[] Measure(int id) {
    IntPtr h = LoadCursor(IntPtr.Zero, (IntPtr)id);
    ICONINFO ii; GetIconInfo(h, out ii);
    BITMAP bm = new BITMAP(); int w = 0, hh = 0;
    if (ii.color != IntPtr.Zero) { GetObject(ii.color, Marshal.SizeOf(bm), ref bm); w = bm.w; hh = bm.h; }
    else { GetObject(ii.mask, Marshal.SizeOf(bm), ref bm); w = bm.w; hh = bm.h / 2; }
    if (ii.color != IntPtr.Zero) DeleteObject(ii.color); if (ii.mask != IntPtr.Zero) DeleteObject(ii.mask);
    int S = 300; var a = new Bitmap(S, S); var b = new Bitmap(S, S);
    using (var g = Graphics.FromImage(a)) { g.Clear(Color.White); var dc = g.GetHdc(); DrawIconEx(dc, 0, 0, h, 0, 0, 0, IntPtr.Zero, 3); g.ReleaseHdc(dc); }
    using (var g = Graphics.FromImage(b)) { g.Clear(Color.Black); var dc = g.GetHdc(); DrawIconEx(dc, 0, 0, h, 0, 0, 0, IntPtr.Zero, 3); g.ReleaseHdc(dc); }
    int x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (int y = 0; y < S; y++) for (int x = 0; x < S; x++) {
      Color p = a.GetPixel(x, y), q = b.GetPixel(x, y);
      bool on = !(p.R == 255 && p.G == 255 && p.B == 255) || !(q.R == 0 && q.G == 0 && q.B == 0);
      if (on) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return new int[] { w, hh, x1 >= 0 ? x1 - x0 + 1 : 0, y1 >= 0 ? y1 - y0 + 1 : 0 };
  }
}
'@
$ids = [ordered]@{ Arrow=32512; IBeam=32513; Wait=32514; Crosshair=32515; UpArrow=32516; SizeNWSE=32642; SizeNESW=32643; SizeWE=32644; SizeNS=32645; SizeAll=32646; No=32648; Hand=32649; AppStarting=32650; Help=32651; Pin=32671; Person=32672 }
$k = 'HKCU:\Control Panel\Cursors'
$res = @()
foreach ($set in Get-ChildItem $Root -Directory) {
  $size = [int](Get-Content (Join-Path $set.FullName 'size.txt'))
  foreach ($base in @($size, 48)) {
    foreach ($f in Get-ChildItem $set.FullName -File | Where-Object { $_.Extension -in '.cur', '.ani' }) { Set-ItemProperty $k -Name $f.BaseName -Value $f.FullName -Type ExpandString }
    Set-ItemProperty $k -Name 'CursorBaseSize' -Value $base -Type DWord
    [void][CM]::SystemParametersInfo(0x2029, 0, [IntPtr]$base, 0x01)
    [void][CM]::SystemParametersInfo(0x57, 0, [IntPtr]::Zero, 0x03)
    Start-Sleep -Milliseconds 300
    $row = [ordered]@{ set = $set.Name; fileSize = $size; base = $base; smCursor = [CM]::GetSystemMetrics(13) }
    foreach ($n in $ids.Keys) { $m = [CM]::Measure($ids[$n]); $row[$n] = "$($m[0])x$($m[1]) vis $($m[2])x$($m[3])" }
    $res += [pscustomobject]$row
  }
}
$res | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $Out
$res | Format-List | Out-String -Width 300 | Write-Host
