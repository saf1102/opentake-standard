import fs from 'node:fs';
import path from 'node:path';
import {ExportSettingsSchema, type ExportSettings} from '../src/types/editor.ts';
import {isFilmExportPreset} from '../src/studio/export-settings.ts';
/** Project-local: stable across ports and app restarts. Never treat a broken read as an empty preference. */
export function readExportPreferences(dir:string):ExportSettings|null {
  const file=path.join(dir,'exports','.preferences.json');
  if(!fs.existsSync(file))return null;
  const settings=ExportSettingsSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));
  return isFilmExportPreset(settings.preset)?settings:null;
}
export function writeExportPreferences(dir:string,value:unknown) {
  const settings=ExportSettingsSchema.parse(value);
  // 通用剪辑与录屏任务也会调用此入口；草稿不能覆盖成片选择。
  if(!isFilmExportPreset(settings.preset))return readExportPreferences(dir);
  const folder=path.join(dir,'exports');fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,'.preferences.json'),tmp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(settings,null,2));fs.renameSync(tmp,file);return settings;
}
