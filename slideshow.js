// PowerPoint 슬라이드 쇼 감지 (A9).
// 숨은 PowerShell 하나가 1초마다 슬라이드 쇼 창(창 클래스 screenClass, 프로세스 POWERPNT)을 찾아
// 상태가 바뀔 때만 SHOW / NONE 한 줄을 보낸다. 1회 확인 약 6ms(tools/ppt-slideshow-test.ps1 로 시험).
// 앱이 죽어도 남지 않도록, 부모 프로세스가 사라지면 스스로 끝난다.
const { spawn } = require('child_process');

function script(parentPid) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class MtSlide {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static bool Showing() {
    bool found = false;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(64); GetClassName(h, sb, 64);
      if (sb.ToString() != "screenClass") return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      try {
        if (System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToUpper() == "POWERPNT") { found = true; return false; }
      } catch {}
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$last = $null
while ($true) {
  if (-not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)) { exit }
  $now = [MtSlide]::Showing()
  if ($now -ne $last) {
    if ($now) { [Console]::Out.WriteLine('SHOW') } else { [Console]::Out.WriteLine('NONE') }
    [Console]::Out.Flush()
    $last = $now
  }
  Start-Sleep -Milliseconds 1000
}
`;
}

// onChange(showing: boolean), onFail() — 반환값: stop()
function watchSlideshow(onChange, onFail) {
  const encoded = Buffer.from(script(process.pid), 'utf16le').toString('base64');
  let child;
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) {
    onFail();
    return () => {};
  }
  let stopped = false;
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === 'SHOW') onChange(true);
      else if (line === 'NONE') onChange(false);
    }
  });
  child.on('error', () => { if (!stopped) onFail(); });
  child.on('exit', () => { if (!stopped) onFail(); });
  return () => {
    stopped = true;
    try { child.kill(); } catch (_) {}
  };
}

module.exports = { watchSlideshow };
