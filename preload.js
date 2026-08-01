const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  ejectCd: () => ipcRenderer.send('eject-cd')
});