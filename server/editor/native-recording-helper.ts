import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function windowsRecordingHelper(){
  const folder=fileURLToPath(new URL('../../native/windows/',import.meta.url));
  const executable=path.join(folder,'wgc-capture.exe');
  const manifestFile=path.join(folder,'build.json');
  if(!fs.existsSync(executable)||!fs.existsSync(manifestFile))throw Error('Windows 采集组件缺失，请重新构建或使用完整的 Windows 目录程序；现有工程已保留。');
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const actual=crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  if(manifest.kind!=='opentake-wgc-clock-v2'||manifest.containerTiming!=='native-finalized-v1'||manifest.binarySha256!==actual)throw Error('Windows 采集组件校验失败，请重新构建；未开始录制。');
  return executable;
}
