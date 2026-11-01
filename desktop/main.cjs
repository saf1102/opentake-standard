const {installFileDialogBridge}=require('./file-dialogs.cjs');
const {app, BrowserWindow, Menu, dialog, desktopCapturer, ipcMain, session, shell, screen, systemPreferences} = require('electron');
const {spawn} = require('node:child_process');
const {recordServiceEvent}=require('./diagnostics.cjs');
const {waitForService}=require('./service-startup.cjs');
const {killTree,buildTarget} = require('./platform.cjs');
const path = require('node:path');
const fs = require('node:fs');
const {APP_NAME, APP_ID, IS_WINDOWS_OFFLINE, sameOrigin, userDataPath, rememberedPort} = require('./policy.cjs');
const {distributionEnvironment}=require('./distribution.cjs');
const {createRecordingControls} = require('./recording-controls.cjs');
const {applicationMenu}=require('./menu.cjs');
const {assetRoot}=require('./assets.cjs');
const {SOURCE_OPTIONS,captureSources,installCaptureSourceBridge}=require('./capture-sources.cjs');
const metadata=require('../package.json');
app.setName(APP_NAME);
app.setPath('userData', userDataPath(app.getPath('appData')));
app.setAppUserModelId(APP_ID);
let win, child, origin, closing = false;
let recordingControls, quitAfterRecording = false;
const root = path.resolve(__dirname, '..');
const assets=assetRoot(root);
app.setAboutPanelOptions({applicationName:APP_NAME,applicationVersion:metadata.version,iconPath:path.join(assets,'opentake-icon-512.png'),copyright:'OpenTake contributors',credits:'AGPL-3.0-only · 开源许可与第三方署名见应用内关于页面。'});
const trusted = event => Boolean(win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && sameOrigin(event.senderFrame.url, origin));
function stopService() {
 if (!child?.pid) return;
 // The service owns a separate process group, including media workers. Never kill unrelated tools.
 if(child.connected)child.disconnect();
 const owned=child;const timer=setTimeout(()=>{if(owned.exitCode===null)killTree(owned.pid);},2000);timer.unref();
}
function permissions() {
 const ses = session.defaultSession;
 ses.setPermissionCheckHandler((contents, permission, requestingOrigin) => contents === win?.webContents && sameOrigin(requestingOrigin, origin) && ['display-capture','media'].includes(permission));
 ses.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === win?.webContents && sameOrigin(details.requestingUrl || contents.getURL(), origin) && ['display-capture','media'].includes(permission)));
 ses.setDisplayMediaRequestHandler(async (request, callback) => {
  if (!win || request.frame !== win.webContents.mainFrame || !sameOrigin(request.securityOrigin, origin) || !request.userGesture) return callback({});
  try {
   const sources = await desktopCapturer.getSources({types:['window','screen'],thumbnailSize:{width:0,height:0}});
   if (!sources.length) return callback({});
   const result = await dialog.showMessageBox(win,{type:'question',title:'选择录制内容',message:'选择要录制的窗口或屏幕',detail:'只录制你准备展示的内容。',buttons:[...sources.map(s=>s.name),'取消'],cancelId:sources.length,noLink:true});
   const source = sources[result.response]; callback(source ? {video:source} : {});
  } catch { callback({}); }
 }, {useSystemPicker:false});
 ipcMain.handle('standard:screen-help', async event => {
  if (!trusted(event)) throw Error('无效窗口');
  if(process.platform==='win32'){await dialog.showMessageBox(win,{type:'info',title:'屏幕录制',message:'请在录制窗口中选择要共享的屏幕或窗口。',detail:'如果被系统或组织策略阻止，请检查 Windows 的屏幕捕获权限。'});return;}
  const result = await dialog.showMessageBox(win,{type:'info',title:'开启屏幕录制权限',message:'请允许 OpenTake Standard 录制屏幕',detail:'打开「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」，允许 OpenTake Standard，然后退出并重新打开。开发模式下名称可能显示为 Electron。',buttons:['打开系统设置','稍后'],cancelId:1});
  if (result.response === 0) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
 });
 ipcMain.handle('standard:screen-status', event => {
  if (!trusted(event)) throw Error('无效窗口');
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown';
 });
}
async function start() {
 if(process.platform==='win32')buildTarget();
 const profile = app.getPath('userData');
 fs.mkdirSync(profile,{recursive:true});
 const env = distributionEnvironment({...process.env,ELECTRON_RUN_AS_NODE:'1',
  OPENTAKE_STANDARD_USER_DATA:profile,
  LINKREADER_SYSTEM_SETTINGS_FILE:process.env.LINKREADER_SYSTEM_SETTINGS_FILE || path.join(profile,'system-settings.json'),
  LINKREADER_AGENT_SETTINGS_FILE:process.env.LINKREADER_AGENT_SETTINGS_FILE || path.join(profile,'agent-settings.json')},
  {bundled:IS_WINDOWS_OFFLINE,profile,videos:app.getPath('videos'),resources:app.isPackaged&&IS_WINDOWS_OFFLINE?process.resourcesPath:undefined});
 let previous;try{previous=JSON.parse(fs.readFileSync(path.join(profile,'startup.json'),'utf8'))}catch{}
 child = spawn(process.execPath,[path.join(__dirname,'service.mjs'),app.isPackaged?'production':'development',String(rememberedPort(previous))],{cwd:root,env,detached:true,stdio:['ignore','inherit','inherit','ipc']});
 if(process.platform==='win32')installCaptureSourceBridge(child,async()=>captureSources(await desktopCapturer.getSources(SOURCE_OPTIONS),screen.getAllDisplays().map(display=>String(display.id))));
 installFileDialogBridge(child,dialog,()=>win);
 recordServiceEvent(profile,'desktop-service-start');
 try{origin = await waitForService(child,{onPhase:stage=>recordServiceEvent(profile,'startup-phase',{stage})});}
 catch(error){recordServiceEvent(profile,'startup-failed',{error});throw error;}
 child.on('exit',(code,signal)=>{recordServiceEvent(profile,'desktop-service-exit',{code,signal});if(!closing){if(recordingControls?.state)recordingControls.update({...recordingControls.state,phase:'failed',error:'本机服务已退出；原始录制文件保留。'});dialog.showErrorBox('本机服务已退出',`退出码：${code??'未知'}${signal?`，信号：${signal}`:''}。请退出并重新打开 OpenTake Standard。已有工程仍保存在磁盘。\n故障记录：${path.join(profile,'diagnostics','service-events.jsonl')}`);app.quit()}});
 win = new BrowserWindow({title:APP_NAME,width:1320,height:900,minWidth:640,minHeight:620,backgroundColor:'#202827',icon:path.join(assets,'opentake-icon-512.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 if(process.platform==='win32')win.on('page-title-updated',event=>event.preventDefault());
 if(process.platform==='darwin')app.dock.setIcon(path.join(assets,'opentake-icon-512.png'));
 permissions();
 require('./client-update.cjs').installUpdateIPC({app,ipcMain,trusted,root,getOrigin:()=>origin});
 if(process.platform==='win32'){
  recordingControls=createRecordingControls({electron:require('electron'),root,parent:win,
   onStop:(projectId,id)=>{
    if(!child?.connected)throw Error('本机录制服务未连接，请保留录制文件并重新打开程序。');
    child.send({recordingStop:{projectId,id}});
   },
   onShow:projectId=>{if(!win||win.isDestroyed())return;if(projectId)void win.loadURL(origin+'/screen-motion/projects/'+encodeURIComponent(projectId));if(win.isMinimized())win.restore();win.show();win.focus()},
   onQuit:()=>app.quit(),
  });
  child.on('message',message=>{
   const state=message?.recordingControl;
   if(!state||!['starting','recording','stopping','saved','failed'].includes(state.phase))return;
   recordingControls.update(state);
   if(quitAfterRecording&&!recordingControls.busy)app.quit();
  });
  win.on('close',event=>{if(closing)return;event.preventDefault();if(recordingControls?.busy){quitAfterRecording=true;recordingControls.stop()}else app.quit()});
 }
 win.webContents.on('will-navigate',(event,url)=>{if(!sameOrigin(url,origin))event.preventDefault()});
 win.webContents.setWindowOpenHandler(({url})=>{if(sameOrigin(url,origin))void win.loadURL(url);return {action:'deny'}});
 Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu({platform:process.platform,app,recordingMenu:recordingControls?.menu})));
 await win.loadURL(origin);
 if(process.env.OPENTAKE_UPDATE_READY){const file=process.env.OPENTAKE_UPDATE_READY;setTimeout(async()=>{try{const r=await fetch(origin+'/api/upgrade/preferences');if(!r.ok||win.isDestroyed()||child.exitCode!==null)return;if(!await win.webContents.executeJavaScript('Boolean(document.getElementById("root")?.children.length)'))return;fs.writeFileSync(file,JSON.stringify({pid:process.pid,version:app.getVersion()}));}catch{}},10000);}
 // Local diagnostic state contains no credentials; used to identify this exact runtime.
 fs.writeFileSync(path.join(profile,'startup.json'),JSON.stringify({pid:process.pid,servicePid:child.pid,url:origin,packaged:app.isPackaged,appId:APP_ID,version:metadata.version}));
}
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{win?.show();win?.focus()});
 app.whenReady().then(start).catch(error=>{dialog.showErrorBox('OpenTake Standard 无法启动',error.message);app.quit()});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{if(recordingControls?.busy){event.preventDefault();quitAfterRecording=true;recordingControls.stop();return}closing=true;stopService()});
 app.on('will-quit',()=>recordingControls?.dispose());
 process.on('SIGTERM',()=>app.quit());process.on('SIGINT',()=>app.quit());
}
