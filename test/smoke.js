// 실제 Electron 에서 오버레이가 무엇을 그리는지 확인하는 연기 시험.
// 실행: MT_SMOKE=1 MT_SETTINGS_FILE=<임시 경로> MT_SMOKE_OUT=<그림 저장 폴더> npx electron .
const { screen, app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

// 캡처 결과가 미리 곱한 알파일 때도, 흰 바탕에 합성될 때도 있어 채도(최대-최소)로 진하기를 잼
const sat = (p) => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
// 발주자 PC 를 건드리는 부분(실제 키·마우스 보내기, 클릭을 막는 펜 모드, PowerPoint 띄우기)은
// 기본으로 건너뜀. PC 를 아무도 안 쓸 때만 MT_SMOKE_REAL=1 (펜·키) · MT_SMOKE_PPT=1 (슬라이드 쇼) 로 켬.
const REAL = !!process.env.MT_SMOKE_REAL;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };

module.exports = async function smoke(api) {
  const out = process.env.MT_SMOKE_OUT || path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  await sleep(2500);

  const prim = screen.getPrimaryDisplay();
  const win = api.overlays.get(prim.id);
  check('오버레이 수 = 모니터 수', api.overlays.size === screen.getAllDisplays().length, `${api.overlays.size}`);

  // 기준점: 주 화면 가운데에서 조금 왼쪽 위 (실제 커서와 겹치지 않게 먼 곳)
  const b = prim.bounds;
  const Q = { x: b.x + Math.round(b.width * 0.30), y: b.y + Math.round(b.height * 0.35) };

  async function grab() {
    const img = await win.webContents.capturePage();
    const size = img.getSize();
    const bmp = img.toBitmap();   // BGRA
    const k = size.width / b.width;
    const at = (sx, sy) => {
      const x = Math.round((sx - b.x) * k), y = Math.round((sy - b.y) * k);
      const i = (y * size.width + x) * 4;
      return { b: bmp[i], g: bmp[i + 1], r: bmp[i + 2], a: bmp[i + 3] };
    };
    const countIn = (cx, cy, rad) => {
      let c = 0;
      for (let y = Math.round((cy - rad - b.y) * k); y < (cy + rad - b.y) * k; y++)
        for (let x = Math.round((cx - rad - b.x) * k); x < (cx + rad - b.x) * k; x++) {
          if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue;
          if (bmp[(y * size.width + x) * 4 + 3] > 8) c++;
        }
      return c;
    };
    const crop = (cx, cy, r) => img.crop({ x: Math.round((cx - r - b.x) * k), y: Math.round((cy - r - b.y) * k), width: Math.round(2 * r * k), height: Math.round(2 * r * k) });
    // 반경 안에서 가장 진한 픽셀
    const maxIn = (cx, cy, rad) => {
      let best = { a: -1 };
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const p = at(cx + dx, cy + dy); if (p.a > best.a) best = p;
      }
      return best;
    };
    return { img, at, countIn, crop, maxIn, k };
  }

  async function swipe(endAt) {
    // 왼쪽에서 Q 까지 가로로 쓸기 (8ms 간격)
    for (let i = 0; i <= 30; i++) {
      win.webContents.send('cursor', { x: endAt.x - 300 + i * 10, y: endAt.y });
      await sleep(8);
    }
  }

  // 1) 꼬리: 쓸고 바로 찍으면 경로 위에 그림이 있음
  await swipe(Q);
  await sleep(30);
  let g = await grab();
  const thinCount = g.countIn(Q.x - 60, Q.y, 20);
  check('꼬리가 그려짐(얇게)', thinCount > 20, `pixels=${thinCount}`);
  fs.writeFileSync(path.join(out, 'trail-thin.png'), g.img.toPNG());

  // 2) 빛나는 커서: 기본값(끔)이면 멈춰도 빛 없음 = 1.0 모습
  await sleep(1300);
  g = await grab();
  check('기본값은 빛나는 커서 없음(1.0 모습)', sat(g.at(Q.x, Q.y)) === 0, `sat=${sat(g.at(Q.x, Q.y))}`);

  // 은은하게: 움직이는 동안엔 빛 없음, 멈추고 꼬리가 사라진 뒤 빛, 40px 밖은 비어 있음
  api.update({ halo: 'soft' });
  await sleep(50);
  await swipe(Q);
  g = await grab();
  check('움직이는 동안 빛 없음', sat(g.at(Q.x + 12, Q.y + 12)) === 0, `sat=${sat(g.at(Q.x + 12, Q.y + 12))}`);
  await sleep(1300);
  g = await grab();
  const c0 = g.at(Q.x, Q.y), far = g.at(Q.x + 40, Q.y + 40);
  check('멈추면 빛나는 커서(은은하게)', sat(c0) > 15 && sat(far) === 0, `center sat=${sat(c0)} far sat=${sat(far)}`);
  fs.writeFileSync(path.join(out, 'halo-soft.png'), g.crop(Q.x, Q.y, 60).toPNG());
  const softS = sat(c0);

  // 3) 굵게 → 같은 쓸기에서 더 많은 픽셀, 빛은 선명하게(더 진함)
  api.update({ thickness: 'thick', halo: 'strong' });
  await sleep(150);
  await swipe(Q);
  await sleep(30);
  g = await grab();
  const thickCount = g.countIn(Q.x - 60, Q.y, 20);
  check('굵게가 얇게보다 굵음', thickCount > thinCount * 1.3, `thin=${thinCount} thick=${thickCount}`);
  fs.writeFileSync(path.join(out, 'trail-thick.png'), g.img.toPNG());
  await sleep(1300);
  g = await grab();
  check('선명하게가 은은하게보다 진함', sat(g.at(Q.x, Q.y)) > softS, `soft=${softS} strong=${sat(g.at(Q.x, Q.y))}`);
  fs.writeFileSync(path.join(out, 'halo-strong.png'), g.crop(Q.x, Q.y, 60).toPNG());
  api.update({ thickness: 'thin', halo: 'soft' });
  await sleep(100);

  // 4) 레이저 포인터: 빨간 점
  api.toggleLaser();
  await sleep(100);
  win.webContents.send('cursor', { x: Q.x, y: Q.y + 1 });
  await sleep(120);
  g = await grab();
  const lp = g.at(Q.x + 5, Q.y + 1);   // 가운데는 밝은 심, 5px 옆이 빨강
  console.log('k', g.k, 'center', JSON.stringify(g.at(Q.x, Q.y + 1)));
  check('레이저 빨간 점', lp.r - lp.g > 100, JSON.stringify(lp));
  fs.writeFileSync(path.join(out, 'laser.png'), g.crop(Q.x, Q.y, 40).toPNG());
  api.update({ shape: 'trail' });   // 단축키를 한 번 더 누르면 이제 펜이 되므로 직접 되돌림

  // 5) 효과 끔 → 아무것도 안 그림, 커서 찾기는 동작
  api.setEnabled(false, true);
  await sleep(150);
  await swipe(Q);
  await sleep(30);
  g = await grab();
  check('끄면 꼬리 없음', g.countIn(Q.x - 60, Q.y, 20) === 0);
  await sleep(700);   // 안내 문구 사라짐
  const cur = screen.getCursorScreenPoint();
  const curOnPrim = cur.x >= b.x && cur.x < b.x + b.width && cur.y >= b.y && cur.y < b.y + b.height;
  api.locateCursor();
  await sleep(250);
  if (curOnPrim) {
    g = await grab();
    const n = g.countIn(cur.x, cur.y, 200);
    check('효과 꺼도 커서 찾기 동그라미', n > 200, `pixels=${n}`);
    fs.writeFileSync(path.join(out, 'locate.png'), g.img.toPNG());
  } else {
    check('커서 찾기(커서가 다른 화면이라 건너뜀)', true);
  }
  api.setEnabled(true, false);

  // 6) 안내 문구(토스트)
  api.setEnabled(false, true);
  await sleep(120);
  g = await grab();
  fs.writeFileSync(path.join(out, 'toast.png'), g.img.toPNG());
  api.setEnabled(true, false);

  // 7) 단축키 — 등록 상태 + Ctrl+Shift+F9 를 실제로 눌러 켜기/끄기
  const hs = api.hotkeyStatus();
  check('단축키 3개 등록', Object.values(hs).every(v => v === 'ok'), JSON.stringify(hs));
  if (REAL) {
    const before = api.settings.enabled;
    await new Promise(r => execFile('powershell', ['-NoProfile', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^+{F9}')"], r));
    await sleep(300);
    check('Ctrl+Shift+F9 로 켜기/끄기', api.settings.enabled === !before);
    api.setEnabled(true, false);
  }

  // 7-1) 빛나는 커서 크기: 은은하게 지름 72 → 반지름 30px 자리에도 빛이 있음
  api.update({ halo: 'soft', haloStyle: 'fade' });
  await swipe(Q);
  await sleep(1300);
  g = await grab();
  check('빛나는 커서가 더 큼(30px 떨어진 곳에도 빛)', sat(g.at(Q.x + 30, Q.y)) > 0, `sat=${sat(g.at(Q.x + 30, Q.y))}`);
  fs.writeFileSync(path.join(out, 'halo-fade.png'), g.crop(Q.x, Q.y, 70).toPNG());

  // 7-2) 커지며: 나타나는 도중에는 원이 작음 → 바깥쪽이 아직 비어 있음
  api.update({ haloStyle: 'grow' });
  await swipe(Q);
  await sleep(700);   // 0.45초 기다린 뒤 0.25초쯤 — 아직 커지는 중
  g = await grab();
  const growMid = sat(g.at(Q.x + 30, Q.y));
  await sleep(700);
  g = await grab();
  const growEnd = sat(g.at(Q.x + 30, Q.y));
  check('커지며: 처음엔 작았다가 커짐', growMid < growEnd, `중간=${growMid} 끝=${growEnd}`);
  fs.writeFileSync(path.join(out, 'halo-grow.png'), g.crop(Q.x, Q.y, 70).toPNG());

  // 7-3) 퍼지는 원: 고리가 보임(가운데 빛 바깥에 선)
  api.update({ haloStyle: 'ring' });
  await swipe(Q);
  await sleep(1300);
  const ringShots = [];
  for (let i = 0; i < 4; i++) { ringShots.push(await grab()); await sleep(200); }
  const ringVar = new Set(ringShots.map(x => x.countIn(Q.x, Q.y, 60))).size;
  check('퍼지는 원: 멈춰 있는 동안 모양이 바뀜(고리가 퍼짐)', ringVar > 1, `서로 다른 장면 ${ringVar}/4`);
  fs.writeFileSync(path.join(out, 'halo-ring.png'), ringShots[1].crop(Q.x, Q.y, 70).toPNG());
  api.update({ halo: 'off', haloStyle: 'fade' });

  // 7-4) 클릭 파문: 오버레이에 클릭을 보내면 고리가 그려짐(왼쪽 하나, 오른쪽 이중)
  api.update({ clickMark: 'ripple' });
  await sleep(100);
  check('클릭 감지 모듈 불러옴', api.clickAvailable === true);
  const R2 = { x: Q.x + 150, y: Q.y };
  win.webContents.send('click', { x: R2.x, y: R2.y, button: 1 });
  await sleep(120);
  g = await grab();
  const rip = g.countIn(R2.x, R2.y, 40);
  check('왼쪽 클릭 파문', rip > 40, `pixels=${rip}`);
  fs.writeFileSync(path.join(out, 'ripple-left.png'), g.crop(R2.x, R2.y, 45).toPNG());
  await sleep(400);
  win.webContents.send('click', { x: R2.x, y: R2.y, button: 2 });
  await sleep(160);
  g = await grab();
  fs.writeFileSync(path.join(out, 'ripple-right.png'), g.crop(R2.x, R2.y, 45).toPNG());
  await sleep(400);
  g = await grab();
  check('파문은 0.4초 뒤 사라짐', g.countIn(R2.x, R2.y, 40) === 0);

  if (REAL) {
    // 7-5) 레이저 펜: 진짜 마우스로 끌어 쓰기. 오버레이가 받지 못하면 밑의 시험 창이 클릭을 받음 → 실패로 잡힘
    const target = new BrowserWindow({ x: Math.round(Q.x - 200), y: Math.round(Q.y - 120), width: 400, height: 240, show: false, frame: false, backgroundColor: '#ffffff' });
    await target.loadURL('data:text/html,<body style="margin:0;height:100vh" onpointerdown="window.hit=(window.hit||0)+1"></body>');
    target.showInactive();
    await sleep(300);
    const hooksBefore = api.hookEvents();
    api.setPenMode(true);
    await sleep(300);
    check('펜 켜짐', api.penMode === true);
    check('펜 동안 Esc 를 잡음', api.penEscOk === true, '실패면 다른 프로그램(교사 도구함 덮개 도구 등)이 Esc 를 쥐고 있음');
    const p0 = screen.dipToScreenPoint({ x: Q.x - 120, y: Q.y });
    const step = Math.round(screen.dipToScreenPoint({ x: Q.x - 112, y: Q.y }).x - p0.x);   // 8 DIP 의 실제 픽셀
    const ps = `
  Add-Type @"
  using System; using System.Runtime.InteropServices;
  public static class M {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
    public struct POINT { public int X; public int Y; }
  }
  "@
  [M]::SetProcessDPIAware() | Out-Null
  $o = New-Object M+POINT; [M]::GetCursorPos([ref]$o) | Out-Null
  [M]::SetCursorPos(${p0.x}, ${p0.y}) | Out-Null; Start-Sleep -Milliseconds 60
  [M]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 30
  for ($i = 1; $i -le 30; $i++) { [M]::SetCursorPos(${p0.x} + $i * ${step}, ${p0.y} + [int](30 * [Math]::Sin($i / 5))) | Out-Null; Start-Sleep -Milliseconds 12 }
  [M]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 60
  [M]::SetCursorPos($o.X, $o.Y) | Out-Null
  `;
    const psFile = path.join(out, 'drag.ps1');
    fs.writeFileSync(psFile, '\ufeff' + ps, 'utf8');
    await new Promise(r => execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], r));
    await sleep(150);
    g = await grab();
    const penPx = g.countIn(Q.x, Q.y, 140);
    check('레이저 펜으로 쓴 선이 보임', penPx > 300, `pixels=${penPx}`);
    fs.writeFileSync(path.join(out, 'pen.png'), g.crop(Q.x, Q.y, 140).toPNG());
    const hit = await target.webContents.executeJavaScript('window.hit || 0');
    check('펜으로 쓸 때 밑의 프로그램은 클릭을 받지 않음', hit === 0, `밑 창 클릭 ${hit}회`);
    check('클릭 감지 모듈이 실제 클릭을 받음', api.hookEvents() > hooksBefore, `${hooksBefore} → ${api.hookEvents()}`);

    // Esc 로 끝 → 2.5초 뒤 글씨 사라짐
    await new Promise(r => execFile('powershell', ['-NoProfile', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ESC}')"], r));
    await sleep(300);
    check('Esc 로 펜 끝', api.penMode === false);
    g = await grab();
    check('펜을 끝내도 글씨는 잠시 남음', g.countIn(Q.x, Q.y, 140) > 300);
    await sleep(2600);
    g = await grab();
    check('2.5초 뒤 글씨 사라짐', g.countIn(Q.x, Q.y, 140) === 0);
    target.destroy();

    // 단축키 순환: 꼬리 → 레이저 → 펜 → 꼬리
    api.update({ shape: 'trail' });
    api.toggleLaser(); const s1 = api.settings.shape;
    api.toggleLaser(); const s2 = api.penMode;
    api.toggleLaser(); const s3 = api.settings.shape + '/' + api.penMode;
    check('단축키 순환 꼬리→레이저→펜→꼬리', s1 === 'laser' && s2 === true && s3 === 'trail/false', `${s1} ${s2} ${s3}`);
  }
  api.update({ clickMark: 'off' });

  // 7-6) 슬라이드 쇼 자동 켜짐: 진짜 PowerPoint 로 빈 슬라이드 쇼를 잠깐 띄움 (MT_SMOKE_PPT=1 일 때만)
  if (process.env.MT_SMOKE_PPT) {
    api.update({ autoSlideshow: true });
    api.setEnabled(false, false);
    await sleep(2500);   // 감시 PowerShell 준비(Add-Type 컴파일)
    const ppt = `
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Add($false)
$null = $pres.Slides.Add(1, 12)
$null = $pres.SlideShowSettings.Run()
[Console]::Out.WriteLine('STARTED'); [Console]::Out.Flush()
Start-Sleep -Milliseconds 4000
try { $pres.SlideShowWindow.View.Exit() } catch {}
[Console]::Out.WriteLine('ENDED'); [Console]::Out.Flush()
Start-Sleep -Milliseconds 300
try { $pres.Saved = $true; $pres.Close() } catch {}
try { if ($pp.Presentations.Count -eq 0) { $pp.Quit() } } catch {}
`;
    const pf = path.join(out, 'ppt.ps1');
    fs.writeFileSync(pf, '\ufeff' + ppt, 'utf8');
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pf]);
    const exited = new Promise(r => child.on('exit', r));   // 일찍 끝나도 놓치지 않게 먼저 걸어 둠
    let pout = '';
    child.stdout.on('data', d => { pout += d; });
    const waitFor = async (word, ms) => { const t0 = Date.now(); while (!pout.includes(word) && Date.now() - t0 < ms) await sleep(100); return pout.includes(word); };
    const started = await waitFor('STARTED', 30000);
    await sleep(2500);
    check('슬라이드 쇼 시작 → 효과 자동 켜짐', started && api.settings.enabled === true && api.slideActive === true, `started=${started} enabled=${api.settings.enabled}`);
    const ended = await waitFor('ENDED', 15000);
    await sleep(2500);
    check('슬라이드 쇼 끝 → 다시 꺼짐', ended && api.settings.enabled === false && api.slideActive === false, `ended=${ended} enabled=${api.settings.enabled}`);
    await Promise.race([exited, sleep(10000)]);
    // 처음부터 켜져 있었으면 쇼가 끝나도 그대로
    api.setEnabled(true, false);
    api.update({ autoSlideshow: false });
  }

  // 8) 설정 창 화면
  const sw = api.settingsWin;
  check('처음 실행 시 설정 창 열림', !!sw);
  if (sw) {
    await sleep(300);
    fs.writeFileSync(path.join(out, 'settings.png'), (await sw.webContents.capturePage()).toPNG());
    const h = await sw.webContents.executeJavaScript('document.documentElement.scrollHeight');
    console.log('settings scrollHeight', h);
    await sw.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(200);
    fs.writeFileSync(path.join(out, 'settings-bottom.png'), (await sw.webContents.capturePage()).toPNG());
  }

  // 9) 저장 파일
  await sleep(500);
  const saved = JSON.parse(fs.readFileSync(api.SETTINGS_FILE, 'utf8'));
  check('설정 파일 저장됨', saved.firstRunShown === true && saved.enabled === true);

  const fail = results.filter(r => !r.ok).length;
  console.log(`\nSMOKE ${results.length - fail}/${results.length} 통과`);
  app.quit();
};
