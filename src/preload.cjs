const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('railwaySaves', {
  load: (slot, kind) => ipcRenderer.invoke('save:load', slot, kind),
  save: (slot, world, kind) => ipcRenderer.invoke('save:write', slot, world, kind),
});
