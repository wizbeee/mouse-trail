const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pb', {
  toggle:  ()       => ipcRenderer.send('penbtn:toggle'),
  move:    (dx, dy) => ipcRenderer.send('penbtn:move', dx, dy),
  moved:   ()       => ipcRenderer.send('penbtn:moved'),
  onState: (cb)     => ipcRenderer.on('penbtn:state', (_, s) => cb(s)),
});
