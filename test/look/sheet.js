// 연기 시험 그림 여러 장을 한 장으로: npx electron test/look/sheet.js <폴더> <파일1> <파일2> ... → <폴더>/sheet.png
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const [dir, ...files] = process.argv.slice(2);
app.whenReady().then(async () => {
  const cells = files.map(f => `<figure style="margin:0;text-align:center"><div style="background:#1b1b22;padding:6px"><img height=220 src="data:image/png;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}"></div><figcaption>${f}</figcaption></figure>`).join('');
  fs.writeFileSync(path.join(dir, 'sheet.html'), `<html><body style="margin:8px;background:#ddd;font:600 13px sans-serif;display:flex;flex-wrap:wrap;gap:8px">${cells}</body></html>`);
  const w = new BrowserWindow({ width: 1500, height: 560, show: false });
  await w.loadFile(path.join(dir, 'sheet.html'));
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(dir, 'sheet.png'), (await w.webContents.capturePage()).toPNG());
  app.quit();
});
