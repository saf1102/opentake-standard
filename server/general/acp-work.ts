/** ACP 只能读取工程内路径：把共用说明书放入工程，不另造出片工具或验收流程。 */
import fs from 'node:fs';
import path from 'node:path';
import {KIT_DIR} from './kit-env.ts';
import {acpPathInside} from './acp.ts';
export function prepareAcpGuide(projectDir:string,styleId:string):string{
 if(!/^[a-z0-9-]+$/.test(styleId))throw Error('风格编号不正确');
 const parent=path.join(projectDir,'work','.opentake');
 if(!acpPathInside(projectDir,parent))throw Error('工程工具目录不能指向工程之外');
 fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'guide-'));
 const copy=(source:string,target:string)=>{
  if(!fs.existsSync(source))return;
  fs.cpSync(source,target,{recursive:true,filter:input=>!fs.lstatSync(input).isSymbolicLink()&&!path.basename(input).startsWith('._')});
 };
 copy(path.join(KIT_DIR,'HF.md'),path.join(root,'HF.md'));
 copy(path.join(KIT_DIR,'hf','skills'),path.join(root,'hf','skills'));
 copy(path.join(KIT_DIR,'styles',styleId),path.join(root,'styles',styleId));
 return root;
}
