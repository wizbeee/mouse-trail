// 펜 단추 시험용: 부른 것을 기록만 함
const { contextBridge, ipcRenderer } = require('electron');
const calls = [];
let stateCb = null;
contextBridge.exposeInMainWorld('pb', {
  toggle: () => calls.push('toggle'),
  move: (dx, dy) => calls.push('move'),
  moved: () => calls.push('moved'),
  onState: (cb) => { stateCb = cb; },
});
contextBridge.exposeInMainWorld('pbTest', { calls: () => calls.slice(), state: (s) => stateCb && stateCb(s) });
