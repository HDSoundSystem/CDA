const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  cdCommand: (cmd) => ipcRenderer.invoke('cd-command', cmd)
});
