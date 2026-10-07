// 펜 단추를 숨은 창에서 확인(화면·마우스 안 건드림): npx electron test/look/penbtn.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fail = 0;
const check = (n, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${info}`); };
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 44, height: 44, show: false, frame: false, transparent: true, resizable: false,
    webPreferences: { preload: path.join(__dirname, 'penbtn-preload.js'), contextIsolation: true, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, '..', '..', 'pen-button.html'));
  const js = (c) => win.webContents.executeJavaScript(c);
  const size = await js('[innerWidth, innerHeight]');
  check('창 크기 44×44(단추가 가운데)', size[0] === 44 && size[1] === 44, JSON.stringify(size));
  const send = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, globalX: 1000 + x, globalY: 500 + y, button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [] });
  const settle = async () => { await js('1'); await sleep(80); };
  // 누르기 → 켜기/끄기
  send('mouseDown', 22, 22); send('mouseUp', 22, 22); await settle();
  check('누르면 켜기/끄기', JSON.stringify(await js('pbTest.calls()')) === '["toggle"]', JSON.stringify(await js('pbTest.calls()')));
  // 끌기 → 옮기기만, 켜기/끄기 없음
  send('mouseDown', 22, 22);
  for (let i = 1; i <= 6; i++) { send('mouseMove', 22 + i * 3, 22); await sleep(10); }
  send('mouseUp', 40, 22); await settle();
  const c = await js('pbTest.calls()');
  check('끌면 옮기기만', c.length > 2 && c.includes('move') && c[c.length - 1] === 'moved' && c.filter(x => x === 'toggle').length === 1, JSON.stringify(c));
  // 상태 표시
  await js(`pbTest.state({ on: true, color: '235,50,50' })`);
  check('켜지면 색 채움', await js(`document.getElementById('b').classList.contains('on')`) && /끝내기/.test(await js(`document.getElementById('b').title`)));
  await js(`pbTest.state({ on: false, color: '235,50,50' })`);
  check('꺼지면 원래대로', !(await js(`document.getElementById('b').classList.contains('on')`)));
  console.log(fail ? `PENBTN ${fail}개 실패` : 'PENBTN 모두 통과');
  app.quit();
});
