const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mts', {
  getState: ()            => ipcRenderer.invoke('mts:get-state'),
  set:      (patch)       => ipcRenderer.send('mts:set', patch),
  action:   (name, arg)   => ipcRenderer.invoke('mts:action', name, arg),
  onState:  (cb)          => ipcRenderer.on('mts:state', (_, s) => cb(s)),
});
