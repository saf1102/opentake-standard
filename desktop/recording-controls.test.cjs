const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createRecordingControls}=require('./recording-controls.cjs');
function fixture({stopError}={}){
 const calls={stops:[],projects:[],windows:[],handlers:new Map(),tray:null};
 const parent={isDestroyed:()=>false,getBounds:()=>({x:1920,y:0,width:1320,height:900})};
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.shows=0;this.focuses=0;this.webContents=new EventEmitter();this.webContents.mainFrame={url:''};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=()=>{};this.webContents.focus=()=>{this.contentFocused=true};calls.windows.push(this)}
  async loadURL(url){this.webContents.mainFrame.url=url} isDestroyed(){return false} isMinimized(){return false} show(){this.shows++;this.hidden=false} focus(){this.focuses++} hide(){this.hidden=true} destroy(){this.emit('closed')}
 }
 class Tray extends EventEmitter{constructor(){super();calls.tray=this}setToolTip(){}setContextMenu(menu){this.menu=menu}popUpContextMenu(menu){calls.popup=menu}destroy(){}}
 const Menu={buildFromTemplate:items=>({items,getMenuItemById:id=>items.find(item=>item.id===id)})};
 const controls=createRecordingControls({electron:{BrowserWindow:Window,Tray,Menu,nativeImage:{createFromPath:()=>({resize:()=>({})})},globalShortcut:{register:()=>false,unregister(){}},ipcMain:{handle:(key,fn)=>calls.handlers.set(key,fn),removeHandler:key=>calls.handlers.delete(key)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1080}}),getDisplayMatching:()=>({workArea:{x:1920,y:0,width:1920,height:1080}})}},root:__dirname,parent,onStop:(p,id)=>{if(stopError)throw stopError;calls.stops.push([p,id])},onShow:id=>calls.projects.push(id),onQuit(){}});
 return {controls,calls,parent};
}
test('actual tray and app menu retain the same stop item through recording state transitions',()=>{
 const {controls,calls,parent}=fixture();try{
  const menu=calls.tray.menu;assert.equal(menu,controls.menu);assert.ok(menu.getMenuItemById('recording-stop'));assert.equal(menu.getMenuItemById('recording-stop').enabled,false);
  for(const phase of ['starting','recording']){
   controls.update({id:'take',projectId:'project',sourceName:'中文 测试',phase});
   assert.equal(calls.tray.menu,menu);assert.equal(menu.getMenuItemById('recording-stop').enabled,true);
  }
  const window=calls.windows[0];assert.equal(window.options.parent,parent);assert.equal(window.options.alwaysOnTop,false);assert.equal(window.options.focusable,true);
  assert.ok(window.options.x>=1920&&window.options.x+540<=3840);assert.equal(window.shows,2);assert.equal(window.focuses,2);assert.equal(window.contentFocused,true);
  controls.update({id:'take',projectId:'project',phase:'recording'});assert.equal(window.focuses,2,'repeated state must not steal focus during capture');
  menu.getMenuItemById('recording-stop').click();assert.deepEqual(calls.stops,[['project','take']]);
  controls.update({id:'take',projectId:'project',phase:'stopping'});menu.getMenuItemById('recording-stop').click();assert.equal(calls.stops.length,1);
  controls.update({id:'take',projectId:'project',phase:'saved'});assert.equal(menu.getMenuItemById('recording-stop').enabled,false);assert.equal(calls.tray.menu,menu);
 }finally{controls.dispose()}
});
test('toolbar IPC requires its own local main frame and its More action opens the real tray menu',()=>{
 const {controls,calls}=fixture();try{
  controls.update({id:'take',projectId:'project',phase:'recording'});
  const window=calls.windows[0],event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
  assert.throws(()=>calls.handlers.get('recording:stop')({sender:{},senderFrame:{url:'https://example.com'}}),/无效/);
  calls.handlers.get('recording:menu')(event);assert.equal(calls.popup,calls.tray.menu);
  calls.handlers.get('recording:project')(event);assert.deepEqual(calls.projects,['project']);assert.equal(window.hidden,true);
  calls.tray.menu.getMenuItemById('recording-show').click();assert.equal(window.hidden,false);assert.equal(window.focuses,2);
  calls.handlers.get('recording:stop')(event);assert.deepEqual(calls.stops,[['project','take']]);
  assert.equal(calls.handlers.get('recording:state')(event).shortcutAvailable,false);
  let prevented=false;window.emit('close',{preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(window.hidden,true);
 }finally{controls.dispose()}
});
test('a disconnected recording service returns an explicit failure to every stop entry',()=>{
 const {controls}=fixture({stopError:new Error('service disconnected')});try{
  controls.update({id:'take',projectId:'project',phase:'recording'});
  const result=controls.stop();assert.equal(result.accepted,false);assert.equal(result.state.phase,'failed');
  assert.equal(result.state.error,'service disconnected');assert.equal(controls.menu.getMenuItemById('recording-stop').enabled,false);
 }finally{controls.dispose()}
});
