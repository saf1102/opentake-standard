const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('recordingDesktop',Object.freeze({
 getState:()=>ipcRenderer.invoke('recording:state'),
 stop:()=>ipcRenderer.invoke('recording:stop'),
 project:()=>ipcRenderer.invoke('recording:project'),
 menu:()=>ipcRenderer.invoke('recording:menu'),
 onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('recording:state',listener);return()=>ipcRenderer.removeListener('recording:state',listener)},
}));
