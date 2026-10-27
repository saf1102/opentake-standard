const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('standardDesktop',Object.freeze({
 screenStatus:()=>ipcRenderer.invoke('standard:screen-status'),
 screenHelp:()=>ipcRenderer.invoke('standard:screen-help'),
}));
