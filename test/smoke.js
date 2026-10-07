// 실제 Electron 에서 오버레이가 무엇을 그리는지 확인하는 연기 시험.
// 실행: MT_SMOKE=1 MT_SETTINGS_FILE=<임시 경로> MT_SMOKE_OUT=<그림 저장 폴더> npx electron .
const { screen, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// 캡처 결과가 미리 곱한 알파일 때도, 흰 바탕에 합성될 때도 있어 채도(최대-최소)로 진하기를 잼
const sat = (p) => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
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

  // 2) 빛나는 커서: 멈추고 0.5초 뒤 커서 자리에 빛, 40px 밖은 비어 있음
  await sleep(500);
  g = await grab();
  const c0 = g.at(Q.x, Q.y), far = g.at(Q.x + 40, Q.y + 40);
  check('멈추면 빛나는 커서(은은하게)', sat(c0) > 15 && sat(far) === 0, `center sat=${sat(c0)} far sat=${sat(far)}`);
  fs.writeFileSync(path.join(out, 'halo-soft.png'), g.crop(Q.x, Q.y, 60).toPNG());
  const softS = sat(c0);

  // 3) 발표 모드: 굵게 → 같은 쓸기에서 더 많은 픽셀, 빛은 선명하게(더 진함)
  api.setPresentation(true, true);
  await sleep(150);
  check('발표 모드 설정값', api.settings.thickness === 'thick' && api.settings.halo === 'strong' && api.settings.life === 'long');
  await swipe(Q);
  await sleep(30);
  g = await grab();
  const thickCount = g.countIn(Q.x - 60, Q.y, 20);
  check('굵게가 얇게보다 굵음', thickCount > thinCount * 1.3, `thin=${thinCount} thick=${thickCount}`);
  fs.writeFileSync(path.join(out, 'trail-thick.png'), g.img.toPNG());
  await sleep(600);
  g = await grab();
  check('선명하게가 은은하게보다 진함', sat(g.at(Q.x, Q.y)) > softS, `soft=${softS} strong=${sat(g.at(Q.x, Q.y))}`);
  fs.writeFileSync(path.join(out, 'halo-strong.png'), g.crop(Q.x, Q.y, 60).toPNG());
  api.setPresentation(false, false);
  await sleep(100);
  check('발표 모드 끄면 직전 설정', api.settings.thickness === 'thin' && api.settings.halo === 'soft' && api.settings.life === 'normal');

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
  api.toggleLaser();

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
  check('단축키 4개 등록', Object.values(hs).every(v => v === 'ok'), JSON.stringify(hs));
  const before = api.settings.enabled;
  await new Promise(r => execFile('powershell', ['-NoProfile', '-Command',
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^+{F9}')"], r));
  await sleep(300);
  check('Ctrl+Shift+F9 로 켜기/끄기', api.settings.enabled === !before);
  api.setEnabled(true, false);

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
