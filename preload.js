const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mt', {
  onCursor:      (cb) => ipcRenderer.on('cursor',       (_, pt) => cb(pt)),
  onDisplayInfo: (cb) => ipcRenderer.on('display-info', (_, d)  => cb(d)),
  onSettings:    (cb) => ipcRenderer.on('settings',     (_, s)  => cb(s)),
  onToast:       (cb) => ipcRenderer.on('toast',        (_, t)  => cb(t)),
  onLocate:      (cb) => ipcRenderer.on('locate',       (_, l)  => cb(l)),
  onClick:       (cb) => ipcRenderer.on('click',        (_, c)  => cb(c)),
  onPen:         (cb) => ipcRenderer.on('pen',          (_, on) => cb(on)),
  penEnd:        ()   => ipcRenderer.send('pen-end'),
});
