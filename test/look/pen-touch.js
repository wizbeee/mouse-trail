// 터치(손가락·펜)로 쓰기를 숨은 창에서 확인 — 화면·마우스를 건드리지 않음: npx electron test/look/pen-touch.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 600, height: 300, show: false, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, 'look-preload.js'), contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, '..', '..', 'index.html'));
  const js = (c) => win.webContents.executeJavaScript(c);
  await js(`mtTest.display({originX:0,originY:0,width:600,height:300,scaleFactor:1})`);
  await js(`mtTest.settings({enabled:true,active:true,glow:'170,140,255',maxLife:60,shape:'laser',laserColor:'red'})`);
  await js(`mtTest.pen({ on: true, escOk: true, endKey: '' })`);
  await js(`window.__ev = []; for (const t of ['pointerdown','pointermove','pointerup','pointercancel']) addEventListener(t, e => __ev.push(t + ':' + e.pointerType))`);
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const touch = (type, x, y) => dbg.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', 100, 200);
  for (let i = 1; i <= 25; i++) { await touch('touchMove', 100 + i * 14, 200 - Math.round(60 * Math.sin(i / 5))); await sleep(12); }
  await touch('touchEnd');
  await sleep(200);
  const r = JSON.parse(await js(`JSON.stringify({ pts: penStrokes.map(s => s.pts.length), cancel: __ev.filter(e => e.startsWith('pointercancel')).length, moves: __ev.filter(e => e.startsWith('pointermove')).length, kinds: [...new Set(__ev)] })`));
  console.log('TOUCH', JSON.stringify(r));
  console.log(r.pts.length === 1 && r.pts[0] > 20 && r.cancel === 0 ? 'TOUCH 통과 — 손가락으로 끌면 선이 이어짐' : 'TOUCH 실패 — 선이 끊김(획 ' + JSON.stringify(r.pts) + ', 취소 ' + r.cancel + '회)');
  app.quit();
});
