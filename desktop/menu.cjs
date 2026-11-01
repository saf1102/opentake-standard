function applicationMenu({platform,app,recordingMenu}){
 const about={label:'关于 OpenTake Standard',click:()=>app.showAboutPanel()};
 if(platform==='darwin')return [{label:'OpenTake Standard',submenu:[about,{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}];
 return [...(recordingMenu?[{label:'录制',submenu:recordingMenu}]:[]),
  {label:'编辑',role:'editMenu'},{label:'查看',role:'viewMenu'},{label:'窗口',role:'windowMenu'},
  {label:'帮助',submenu:[about,{type:'separator'},{label:'退出',role:'quit'}]}];
}
module.exports={applicationMenu};
