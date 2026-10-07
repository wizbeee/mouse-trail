// 모양 비교용: 실제 IPC 대신 페이지에서 직접 값을 넣는다
const { contextBridge } = require('electron');
const h = {};
const reg = (k) => (cb) => { h[k] = cb; };
contextBridge.exposeInMainWorld('mt', {
  onCursor: reg('cursor'), onDisplayInfo: reg('display'), onSettings: reg('settings'),
  onToast: reg('toast'), onLocate: reg('locate'), onClick: reg('click'), onPen: reg('pen'), penEnd: () => {},
});
contextBridge.exposeInMainWorld('mtTest', {
  cursor: (p) => h.cursor && h.cursor(p),
  settings: (s) => h.settings && h.settings(s),
  display: (d) => h.display && h.display(d),
  click: (c) => h.click && h.click(c),
  pen: (on) => h.pen && h.pen(on),
});
