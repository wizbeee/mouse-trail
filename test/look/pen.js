// 레이저 펜·안내 띠를 숨은 창에서 확인(발주자 화면·마우스를 건드리지 않음): npx electron test/look/pen.js <폴더>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fail = 0;
const check = (n, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${info}`); };
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  // 실제 index.html 을 그대로 쓰되 preload 만 시험용으로
  const win = new BrowserWindow({ width: 600, height: 300, show: false, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, 'look-preload.js'), contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(path.join(root, 'index.html'));
  const js = (c) => win.webContents.executeJavaScript(c);
  await js(`mtTest.display({originX:0,originY:0,width:600,height:300,scaleFactor:1})`);
  await js(`mtTest.settings({enabled:true,active:true,glow:'170,140,255',maxLife:60,shape:'laser',laserColor:'red'})`);

  await js(`mtTest.pen({ on: true, escOk: false, endKey: 'Ctrl+Shift+F12' })`);
  const msg = await js(`document.getElementById('penMsg').textContent`);
  check('Esc 를 못 잡으면 띠에 다른 끝내는 방법 안내', /다른 프로그램/.test(msg) && /Ctrl\+Shift\+F12/.test(msg), msg);
  await js(`mtTest.pen({ on: true, escOk: true, endKey: 'Ctrl+Shift+F12' })`);
  check('Esc 를 잡으면 Esc 안내', /Esc로 끝내기/.test(await js(`document.getElementById('penMsg').textContent`)));
  check('펜 동안 띠가 보임', await js(`getComputedStyle(document.getElementById('penBar')).display`) === 'flex');

  // 숨은 창 안에서만 끌기(운영체제 마우스는 움직이지 않음)
  const send = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  send('mouseDown', 100, 200);
  for (let i = 1; i <= 30; i++) { send('mouseMove', 100 + i * 12, 200 - Math.round(60 * Math.sin(i / 6))); await sleep(10); }
  send('mouseUp', 460, 150);
  // 입력이 다 처리될 때까지(펜을 뗐고 점이 다 들어옴) 기다림
  for (let i = 0; i < 100; i++) {
    if (await js(`!penDown && penStrokes.length > 0 && penStrokes[0].pts.length > 25`)) break;
    await sleep(50);
  }
  await sleep(100);
  // 숨은 창의 화면 캡처는 마지막으로 그려진 장면이 늦게 나와서, 판단은 펜의 실제 상태로 함
  const st1 = JSON.parse(await js(`JSON.stringify({ down: penDown, pts: penStrokes.map(s => s.pts.length) })`));
  check('끌어 쓴 선이 한 획으로 들어옴', !st1.down && st1.pts.length === 1 && st1.pts[0] > 25, JSON.stringify(st1));
  check('쓴 직후 그리는 중', await js(`drawPen(performance.now())`) === true);
  await sleep(1800);
  check('2초 안에는 그대로', await js(`penStrokes.length`) === 1);
  await sleep(900);
  check('2.5초 뒤 사라짐', await js(`(drawPen(performance.now()), penStrokes.length)`) === 0);
  fs.writeFileSync(path.join(out, 'pen-hidden.png'), (await win.webContents.capturePage()).toPNG());
  await js(`mtTest.pen({ on: false, escOk: false })`);
  check('펜 끝나면 띠 숨김', await js(`getComputedStyle(document.getElementById('penBar')).display`) === 'none');
  console.log(fail ? `PEN ${fail}개 실패` : 'PEN 모두 통과');
  app.quit();
});
