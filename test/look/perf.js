// 꼬리 한 번 그리는 데 걸리는 시간(ms) — 4K·150% 에 가깝게 캔버스 2560×1440 DIP, 배율 1.5
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const r of ['renderer-1.0.0.js', 'renderer-now.js']) {
    if (r === 'renderer-now.js') fs.copyFileSync(path.join(__dirname, '..', '..', 'renderer.js'), path.join(out, r));
    else fs.copyFileSync(path.join(__dirname, r), path.join(out, r));
    const page = path.join(out, 'p.html');
    fs.writeFileSync(page, `<!DOCTYPE html><html><body style="margin:0"><canvas id="c"></canvas><canvas id="fx"></canvas><div id="toast"></div><script src="${r}"></script></body></html>`);
    const win = new BrowserWindow({ width: 800, height: 600, show: false, webPreferences: { preload: path.join(__dirname, 'look-preload.js') } });
    await win.loadFile(page);
    await win.webContents.executeJavaScript(`mtTest.display({originX:0,originY:0,width:2560,height:1440,scaleFactor:1.5})`);
    for (const thick of [1, 3]) {
      await win.webContents.executeJavaScript(`mtTest.settings({enabled:true,active:true,glow:'170,140,255',maxLife:120,thick:${thick}})`);
      const ms = await win.webContents.executeJavaScript(`(() => {
        points.length = 0; const t0 = performance.now();
        for (let i = 0; i < 90; i++) points.push({ x: 200 + i * 20, y: 700 + Math.sin(i / 8) * 300, t: t0 - (90 - i) * 8 });
        const s = performance.now(); for (let k = 0; k < 100; k++) drawTrail(); return (performance.now() - s) / 100; })()`);
      console.log(r, 'thick', thick, 'ms/frame', ms.toFixed(2));
    }
    win.destroy();
  }
  app.quit();
});
