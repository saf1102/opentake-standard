const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('standardDesktop',Object.freeze({
 updateRestart:()=>ipcRenderer.invoke('standard:update-restart'),
 updateStatus:()=>ipcRenderer.invoke('standard:update-status'),
 updateStart:release=>ipcRenderer.invoke('standard:update-start',release),
 updateCancel:()=>ipcRenderer.invoke('standard:update-cancel'),
 screenStatus:()=>ipcRenderer.invoke('standard:screen-status'),
 screenHelp:()=>ipcRenderer.invoke('standard:screen-help'),
}));
