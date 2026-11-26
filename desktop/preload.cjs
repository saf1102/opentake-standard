const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('standardDesktop',Object.freeze({
 downloadPro:(...args)=>args.length?Promise.resolve({error:'无效的下载请求。'}):ipcRenderer.invoke('standard:pro-download'),
 updateRestart:()=>ipcRenderer.invoke('standard:update-restart'),
 updateStatus:()=>ipcRenderer.invoke('standard:update-status'),
 updateStart:release=>ipcRenderer.invoke('standard:update-start',release),
 updateCancel:()=>ipcRenderer.invoke('standard:update-cancel'),
 screenStatus:()=>ipcRenderer.invoke('standard:screen-status'),
 screenHelp:()=>ipcRenderer.invoke('standard:screen-help'),
}));
