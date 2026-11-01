const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {assetRoot}=require('./assets.cjs');
const busy=state=>Boolean(state&&['starting','recording','stopping'].includes(state.phase));

/** One menu instance backs the app's Recording menu, the actual tray popup and
 * the toolbar's More button. Locale/theme changes cannot replace its stop item. */
function createRecordingControls({electron,root,parent,onStop,onShow,onQuit}){
 const {BrowserWindow,Menu,Tray,nativeImage,globalShortcut,ipcMain,screen}=electron;
 let state=null,window=null,shortcutAvailable=false;
 const page=pathToFileURL(path.join(root,'desktop/recording.html')).href;
 const trusted=event=>Boolean(window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&event.senderFrame.url===page);
 const snapshot=()=>({...state,shortcutAvailable,shortcut:'Ctrl+Shift+F9'});
 const showProject=()=>{window?.hide();onShow(state?.projectId)};
 const stop=()=>{
  if(!busy(state)||state.phase==='stopping')return {accepted:false,state:snapshot()};
  try{onStop(state.projectId,state.id)}catch(error){
   update({...state,phase:'failed',error:error instanceof Error?error.message:String(error)});
   return {accepted:false,state:snapshot()};
  }
  return {accepted:true};
 };
 const menu=Menu.buildFromTemplate([
  {id:'recording-show',label:'显示录制控制栏',click:()=>show()},
  {id:'recording-stop',label:'停止并保存录制',enabled:false,click:stop},
  {id:'recording-project',label:'返回录屏工程',click:showProject},
  {type:'separator'},{label:'显示 OpenTake Standard',click:showProject},
  {label:'退出 OpenTake Standard',click:onQuit},
 ]);
 const tray=new Tray(nativeImage.createFromPath(path.join(assetRoot(root),'opentake-icon-512.png')).resize({width:20,height:20}));
 tray.setToolTip('OpenTake Standard');tray.setContextMenu(menu);tray.on('double-click',()=>busy(state)?show():showProject());
 function show(){
  if(!window||window.isDestroyed()){
   const owner=parent&&!parent.isDestroyed()?parent:undefined;
   const area=(owner?screen.getDisplayMatching(owner.getBounds()):screen.getPrimaryDisplay()).workArea;
   // A normal owned window stays above Standard without a global overlay layer.
   // Show it on Standard's display and activate it so the first click is usable.
   window=new BrowserWindow({title:'OpenTake 录制控制',icon:path.join(assetRoot(root),'opentake-icon-512.png'),width:540,height:190,resizable:false,maximizable:false,minimizable:true,autoHideMenuBar:true,
    parent:owner,show:false,focusable:true,x:area.x+Math.max(0,Math.floor((area.width-540)/2)),y:area.y+72,
    alwaysOnTop:false,skipTaskbar:false,backgroundColor:'#20242b',
    webPreferences:{preload:path.join(root,'desktop/recording-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
   window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   window.webContents.on('will-navigate',(event,url)=>{if(url!==page)event.preventDefault()});
   window.webContents.on('did-finish-load',()=>window?.webContents.send('recording:state',snapshot()));
   window.on('close',event=>{if(busy(state)){event.preventDefault();window.hide()}});
   window.on('closed',()=>{window=null});
   void window.loadURL(page);
  }
  if(window.isMinimized())window.restore();
  window.show();window.focus();window.webContents.focus();
 }
 function update(next){
  if(!next||typeof next.id!=='string'||typeof next.projectId!=='string')return;
  const previousId=state?.id,previousPhase=state?.phase;
  state={...next};
  const item=menu.getMenuItemById('recording-stop');
  item.enabled=busy(state)&&state.phase!=='stopping';
  item.label=state.phase==='stopping'?'正在保存录制…':'停止并保存录制';
  menu.getMenuItemById('recording-show').enabled=true;
  tray.setToolTip(busy(state)?`OpenTake 正在${state.phase==='stopping'?'保存':'录制'}：${String(state.sourceName||'').slice(0,90)}`:'OpenTake Standard');
  // On Windows the native tray refreshes its cached menu from this same object.
  tray.setContextMenu(menu);
  // The source dialog restores focus to Standard after startup. Activate once
  // more when the native recorder is actually ready, then leave user focus alone.
  if(busy(state)&&(previousId!==state.id||!window||(state.phase==='recording'&&previousPhase!=='recording')))show();
  if(window&&!window.isDestroyed())window.webContents.send('recording:state',snapshot());
 }
 ipcMain.handle('recording:state',event=>{if(!trusted(event))throw Error('无效录制控制窗口');return snapshot()});
 ipcMain.handle('recording:stop',event=>{if(!trusted(event))throw Error('无效录制控制窗口');return stop()});
 ipcMain.handle('recording:project',event=>{if(!trusted(event))throw Error('无效录制控制窗口');showProject()});
 ipcMain.handle('recording:menu',event=>{if(!trusted(event))throw Error('无效录制控制窗口');tray.popUpContextMenu(menu)});
 shortcutAvailable=globalShortcut.register('CommandOrControl+Shift+F9',stop);
 return {menu,update,show,stop,get busy(){return busy(state)},get state(){return state},
  dispose(){globalShortcut.unregister('CommandOrControl+Shift+F9');state=null;window?.destroy();tray.destroy();for(const key of ['state','stop','project','menu'])ipcMain.removeHandler('recording:'+key)},
 };
}
module.exports={createRecordingControls,busy};
