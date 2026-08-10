const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  cdCommand: (cmd, arg) => ipcRenderer.invoke('cd-command', cmd, arg)
});
