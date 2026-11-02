import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {defaultProjectRoot,validateDirectory} from '../system-settings.ts';
import type {GeneralProject} from '../../src/general/general-contract.ts';
type Document={path:string;text:string;sha256:string};
const hash=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
const excluded=new Set(['node_modules','.git','.opentake','__pycache__']);
const safePath=(value:string)=>typeof value==='string' && /^(versions|work)\//.test(value) && !/[\\:\0]/.test(value) && path.posix.normalize(value)===value && !value.split('/').some(part=>part==='..'||part==='.'||excluded.has(part));
export function generalBackupDocuments(dir:string):Document[]{
  const out:Document[]=[];
  const visit=(folder:string)=>{if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(entry.isSymbolicLink()||excluded.has(entry.name))continue;const file=path.join(folder,entry.name);if(entry.isDirectory())visit(file);else if(entry.isFile()&&/\.(json|html?|css|[cm]?js|tsx?|jsx|md|txt|svg)$/i.test(entry.name)){const text=fs.readFileSync(file,'utf8');out.push({path:path.relative(dir,file).split(path.sep).join('/'),text,sha256:hash(text)})}}};
  for(const folder of ['versions','work']){const base=path.join(dir,folder);if(fs.existsSync(base)&&fs.lstatSync(base).isSymbolicLink())throw Error('工程备份不支持链接目录：'+folder);visit(base)}return out;
}
export function checkedGeneralDocuments(value:unknown):Document[]{
  if(!Array.isArray(value))throw Error('通用工程备份文档无效');
  const seen=new Set<string>();
  return value.map((item:Document)=>{if(!item||!safePath(item.path)||seen.has(item.path.toLowerCase())||typeof item.text!=='string'||hash(item.text)!==item.sha256)throw Error('通用工程备份校验失败');seen.add(item.path.toLowerCase());return item});
}
export async function restoreGeneralBackup(item:{projectId:string;sourceDir:string;text:string;generalDocuments:Document[]}){
  const {scanGeneral,saveGeneral,fileUrl}=await import('./store.ts');
  const original=JSON.parse(item.text) as GeneralProject;
  if(original.kind!=='general'||original.id!==item.projectId||typeof original.name!=='string'||!original.inputs||!Array.isArray(original.inputs.media)||!Array.isArray(original.versions)||!Array.isArray(original.messages))throw Error('通用工程备份格式无效');
  const documents=checkedGeneralDocuments(item.generalDocuments);
  const sourceDir=scanGeneral(true).find(row=>row.project.id===item.projectId)?.dir||item.sourceDir;
  if(!fs.existsSync(sourceDir)||fs.lstatSync(sourceDir).isSymbolicLink())throw Error('原工程目录缺失，无法恢复素材');
  const realSource=fs.realpathSync(sourceDir);
  const requireFile=(relative:string)=>{const file=path.resolve(sourceDir,relative);if(!file.startsWith(path.resolve(sourceDir)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()||!fs.realpathSync(file).startsWith(realSource+path.sep))throw Error('原素材或成片缺失，无法恢复：'+relative)};
  for(const media of original.inputs.media){if(media.file)requireFile(path.join('media',media.file));else{const found=fs.readdirSync(path.join(sourceDir,'media')).find(name=>path.parse(name).name===media.id);if(!found)throw Error('原素材缺失，无法恢复：'+media.name);requireFile(path.join('media',found))}}
  for(const version of original.versions){const prefix=fileUrl(original.id,'');if(!version.videoUrl.startsWith(prefix))throw Error('备份中的成片地址无效');requireFile(decodeURIComponent(version.videoUrl.slice(prefix.length).split('?')[0]))}
  const root=defaultProjectRoot();validateDirectory(root);
  const stem=original.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').slice(0,50)+' · 恢复副本';
  let name=stem;for(let n=2;fs.existsSync(path.join(root,name));n++)name=stem+' '+n;
  const dir=path.join(root,name),id=crypto.randomUUID(),oldUrl=`/api/general/projects/${original.id}/`,newUrl=`/api/general/projects/${id}/`;
  const rewriteText=(text:string)=>text.replaceAll(oldUrl,newUrl).replaceAll(sourceDir.split(path.sep).join('/'),dir.split(path.sep).join('/')).replaceAll(JSON.stringify(sourceDir).slice(1,-1),JSON.stringify(dir).slice(1,-1));
  const restored=JSON.parse(rewriteText(item.text)) as GeneralProject & {deletedAt?:string};
  restored.id=id;restored.name=name;restored.createdAt=new Date().toISOString();delete restored.deletedAt;delete restored.exportTask;
  // No running process or agent session belongs to the restored copy.
  if(restored.run&&['running','stopping','needs-network'].includes(restored.run.state)){restored.run.state='stopped';restored.run.error='已从备份恢复，请检查工程后手动继续';restored.run.queued=0}
  fs.mkdirSync(dir);
  try{
    for(const folder of ['media','versions','work','review']){
      const from=path.join(sourceDir,folder),to=path.join(dir,folder);
      if(fs.existsSync(from)){if(fs.lstatSync(from).isSymbolicLink())throw Error('原工程包含链接目录：'+folder);await fs.promises.cp(from,to,{recursive:true,filter:file=>!fs.lstatSync(file).isSymbolicLink()&&!path.relative(from,file).split(path.sep).some(part=>excluded.has(part))})}else fs.mkdirSync(to);
    }
    fs.mkdirSync(path.join(dir,'agent'));
    for(const document of documents){const file=path.join(dir,document.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,rewriteText(document.text))}
    return saveGeneral(dir,restored,{restoring:true});
  }catch(error){if(path.dirname(path.resolve(dir))===path.resolve(root))fs.rmSync(dir,{recursive:true,force:true});throw error}
}
