# A9 시험: PowerPoint 슬라이드 쇼 감지 (2026-10-07 이 PC에서 성공, 1회 확인 약 6ms)
# 빈 프레젠테이션을 만들어 슬라이드 쇼를 잠깐 띄웠다가 닫는다. 실행: powershell -ExecutionPolicy Bypass -File tools/ppt-slideshow-test.ps1
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string Find() {
    string found = "";
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetClassName(h, sb, 256);
      if (sb.ToString() == "screenClass") {
        uint pid; GetWindowThreadProcessId(h, out pid);
        try { var p = System.Diagnostics.Process.GetProcessById((int)pid);
          if (p.ProcessName.ToUpper() == "POWERPNT") { found = "SLIDESHOW pid=" + pid; return false; } } catch {}
      }
      return true;
    }, IntPtr.Zero);
    return found == "" ? "NONE" : found;
  }
}
"@
"before: " + [W]::Find()
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Add($false)
$null = $pres.Slides.Add(1, 12)
$sw = [Diagnostics.Stopwatch]::StartNew()
$null = $pres.SlideShowSettings.Run()
Start-Sleep -Milliseconds 1500
"during: " + [W]::Find()
$t = [Diagnostics.Stopwatch]::StartNew(); for($i=0;$i -lt 20;$i++){ $null=[W]::Find() }; "avg ms per check: " + ($t.ElapsedMilliseconds/20)
$pres.SlideShowWindow.View.Exit()
Start-Sleep -Milliseconds 800
"after: " + [W]::Find()
try { $pres.Saved = $true; $pres.Close() } catch {}; try { if ($pp.Presentations.Count -eq 0) { $pp.Quit() } } catch {}
