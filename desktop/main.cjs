const {app, BrowserWindow, Menu, dialog, desktopCapturer, ipcMain, session, shell, systemPreferences} = require('electron');
const {spawn} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const {APP_NAME, APP_ID, sameOrigin, userDataPath, rememberedPort} = require('./policy.cjs');
app.setName(APP_NAME);
app.setPath('userData', userDataPath(app.getPath('appData')));
app.setAppUserModelId(APP_ID);
let win, child, origin, closing = false;
const root = path.resolve(__dirname, '..');
const trusted = event => Boolean(win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && sameOrigin(event.senderFrame.url, origin));
function stopService() {
 if (!child?.pid) return;
 // The service owns a separate process group, including media workers. Never kill unrelated tools.
 try { process.kill(-child.pid, 'SIGTERM'); } catch {}
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
  const result = await dialog.showMessageBox(win,{type:'info',title:'开启屏幕录制权限',message:'请允许 OpenTake Standard 录制屏幕',detail:'打开「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」，允许 OpenTake Standard，然后退出并重新打开。开发模式下名称可能显示为 Electron。',buttons:['打开系统设置','稍后'],cancelId:1});
  if (result.response === 0) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
 });
 ipcMain.handle('standard:screen-status', event => {
  if (!trusted(event)) throw Error('无效窗口');
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown';
 });
}
async function start() {
 const profile = app.getPath('userData');
 fs.mkdirSync(profile,{recursive:true});
 const env = {...process.env,ELECTRON_RUN_AS_NODE:'1',
  LINKREADER_SYSTEM_SETTINGS_FILE:process.env.LINKREADER_SYSTEM_SETTINGS_FILE || path.join(profile,'system-settings.json'),
  LINKREADER_AGENT_SETTINGS_FILE:process.env.LINKREADER_AGENT_SETTINGS_FILE || path.join(profile,'agent-settings.json')};
 let previous;try{previous=JSON.parse(fs.readFileSync(path.join(profile,'startup.json'),'utf8'))}catch{}
 child = spawn(process.execPath,[path.join(__dirname,'service.mjs'),app.isPackaged?'production':'development',String(rememberedPort(previous))],{cwd:root,env,detached:true,stdio:['ignore','inherit','inherit','ipc']});
 origin = await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('本机服务启动超时，请检查依赖安装。')),60000);
  child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('本机服务未能启动。'))});
  child.on('message',message=>{if(message?.ready&&/^http:\/\/127\.0\.0\.1:\d+$/.test(message.ready)){clearTimeout(timer);resolve(message.ready)}});
 });
 child.on('exit',()=>{if(!closing){dialog.showErrorBox('本机服务已退出','请退出并重新打开 OpenTake Standard。已有工程仍保存在磁盘。');app.quit()}});
 win = new BrowserWindow({title:APP_NAME,width:1320,height:900,minWidth:640,minHeight:620,backgroundColor:'#202827',icon:path.join(root,'public/opentake-icon-512.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 if(process.platform==='darwin')app.dock.setIcon(path.join(root,'public/opentake-icon-512.png'));
 permissions();
 win.webContents.on('will-navigate',(event,url)=>{if(!sameOrigin(url,origin))event.preventDefault()});
 win.webContents.setWindowOpenHandler(({url})=>{if(sameOrigin(url,origin))void win.loadURL(url);return {action:'deny'}});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:APP_NAME,submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));
 await win.loadURL(origin);
 // Local diagnostic state contains no credentials; used to identify this exact runtime.
 fs.writeFileSync(path.join(profile,'startup.json'),JSON.stringify({pid:process.pid,servicePid:child.pid,url:origin,packaged:app.isPackaged,appId:APP_ID}));
}
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{win?.show();win?.focus()});
 app.whenReady().then(start).catch(error=>{dialog.showErrorBox('OpenTake Standard 无法启动',error.message);app.quit()});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{closing=true;stopService()});
 process.on('SIGTERM',()=>app.quit());process.on('SIGINT',()=>app.quit());
}
