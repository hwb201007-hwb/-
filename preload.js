const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ledgerAPI', { read: () => ipcRenderer.invoke('ledger:read'), write: data => ipcRenderer.invoke('ledger:write', data), path: () => ipcRenderer.invoke('ledger:path') });
