// 꼬리 모양 비교 그림: npx electron test/look/look.js <저장 폴더>
// 같은 곡선을 1.0.0 과 지금 판(얇게·보통·굵게, 테두리 켬)으로 어두운/흰 바탕에 그려 한 장씩 저장
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', '..', 'renderer.js'), path.join(__dirname, 'renderer-now.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CASES = [
  { name: '1.0.0',           r: 'renderer-1.0.0.js', s: {} },
  { name: 'thin',            r: 'renderer-now.js', s: { thick: 1.0 } },
  { name: 'normal',          r: 'renderer-now.js', s: { thick: 1.8 } },
  { name: 'thick',           r: 'renderer-now.js', s: { thick: 3.0 } },
  { name: 'thick-outline',   r: 'renderer-now.js', s: { thick: 3.0, outline: true } },
];

app.on('window-all-closed', () => {});   // 그림마다 창을 닫아도 끝나지 않게
app.whenReady().then(async () => {
  for (const bg of ['#1b1b22', '#ffffff']) {
    for (const c of CASES) {
      const win = new BrowserWindow({ width: 520, height: 260, show: false, useContentSize: true,
        webPreferences: { preload: path.join(__dirname, 'look-preload.js'), contextIsolation: true, offscreen: false } });
      const page = path.join(out, `page-${c.name}-${bg.slice(1)}.html`);
      fs.copyFileSync(path.join(__dirname, c.r), path.join(out, c.r));
      fs.writeFileSync(page, `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${bg}}
canvas{display:block;position:absolute;top:0;left:0}#toast{display:none}</style></head>
<body><canvas id="c"></canvas><canvas id="fx"></canvas><div id="toast"></div><script src="${c.r}"></script></body></html>`);
      await win.loadFile(page);
      await win.webContents.executeJavaScript(`mtTest.display({originX:0,originY:0,width:520,height:260,scaleFactor:2})`);
      await win.webContents.executeJavaScript(`mtTest.settings(${JSON.stringify({ enabled: true, active: true, glow: '170,140,255', maxLife: 120, ...c.s })})`);
      // 물결 모양으로 쓸기 — 실제 커서처럼 8ms 간격
      for (let i = 0; i <= 70; i++) {
        const x = 30 + i * 6.5, y = 130 + Math.sin(i / 9) * 70;
        await win.webContents.executeJavaScript(`mtTest.cursor({x:${x},y:${y}})`);
        await sleep(8);
      }
      await sleep(16);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(out, `${bg === '#ffffff' ? 'white' : 'dark'}-${c.name}.png`), img.toPNG());
      win.destroy();
    }
  }
  // 한 장으로 모으기: 줄 = 경우, 칸 = 어두운/흰 바탕
  const cell = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(out, f)).toString('base64');
  const rows = CASES.map(c => `<tr><th>${c.name}</th><td><img width=520 src="${cell('dark-' + c.name + '.png')}"></td><td><img width=520 src="${cell('white-' + c.name + '.png')}"></td></tr>`).join('');
  const html = `<html><body style="margin:0;background:#888;font:600 14px sans-serif"><table cellspacing=4>${rows}</table></body></html>`;
  fs.writeFileSync(path.join(out, 'grid.html'), html);
  const g = new BrowserWindow({ width: 1180, height: 1380, show: false });
  await g.loadFile(path.join(out, 'grid.html'));
  await sleep(300);
  fs.writeFileSync(path.join(out, 'grid.png'), (await g.webContents.capturePage()).toPNG());
  app.quit();
});
