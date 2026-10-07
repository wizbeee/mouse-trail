// 줄어드는 모습 비교: 쓸고 멈춘 뒤 0.1초 간격으로 7장 — npx electron test/look/retract.js <저장 폴더>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', '..', 'renderer.js'), path.join(__dirname, 'renderer-now.js'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CASES = [
  { name: '1.0.0', r: 'renderer-1.0.0.js', s: {} },
  { name: 'now-thin', r: 'renderer-now.js', s: { thick: 1.0 } },
  { name: 'now-thick', r: 'renderer-now.js', s: { thick: 3.0 } },
];
const FRAMES = 7, GAP = 100;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const cells = [];
  for (const c of CASES) {
    fs.copyFileSync(path.join(__dirname, c.r), path.join(out, c.r));
    const page = path.join(out, `r-${c.name}.html`);
    fs.writeFileSync(page, `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#1b1b22}canvas{display:block;position:absolute;top:0;left:0}#toast{display:none}</style></head><body><canvas id="c"></canvas><canvas id="fx"></canvas><div id="toast"></div><script src="${c.r}"></script></body></html>`);
    const win = new BrowserWindow({ width: 360, height: 160, show: false, useContentSize: true,
      webPreferences: { preload: path.join(__dirname, 'look-preload.js'), contextIsolation: true } });
    await win.loadFile(page);
    await win.webContents.executeJavaScript(`mtTest.display({originX:0,originY:0,width:360,height:160,scaleFactor:1})`);
    await win.webContents.executeJavaScript(`mtTest.settings(${JSON.stringify({ enabled: true, active: true, glow: '170,140,255', maxLife: 60, ...c.s })})`);
    // 페이지 안에서 8ms 간격으로 쓸기(왕복 지연 없이)
    await win.webContents.executeJavaScript(`new Promise(r => { let i = 0; const id = setInterval(() => {
      mtTest.cursor({ x: 20 + i * 5, y: 80 + Math.sin(i / 8) * 45 }); if (++i > 62) { clearInterval(id); r(); } }, 8); })`);
    const row = [];
    for (let f = 0; f < FRAMES; f++) {
      const img = await win.webContents.capturePage();
      row.push('data:image/png;base64,' + img.toPNG().toString('base64'));
      await sleep(GAP);
    }
    cells.push({ name: c.name, row });
    win.destroy();
  }
  const head = '<tr><th></th>' + Array.from({ length: FRAMES }, (_, i) => `<th>${i * GAP}ms</th>`).join('') + '</tr>';
  const rows = cells.map(c => `<tr><th>${c.name}</th>${c.row.map(u => `<td><img width=240 src="${u}"></td>`).join('')}</tr>`).join('');
  fs.writeFileSync(path.join(out, 'retract.html'), `<html><body style="margin:0;background:#888;font:600 13px sans-serif"><table cellspacing=3>${head}${rows}</table></body></html>`);
  const g = new BrowserWindow({ width: 1800, height: 560, show: false });
  await g.loadFile(path.join(out, 'retract.html'));
  await sleep(300);
  fs.writeFileSync(path.join(out, 'retract.png'), (await g.webContents.capturePage()).toPNG());
  app.quit();
});
