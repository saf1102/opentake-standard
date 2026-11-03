/** Build-time only. Locked official archives; never install into the user's Python. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
export async function prepareWindowsExportRuntimes(root=path.resolve(source,'../runtime-payload')) {
 const lock=JSON.parse(await fs.readFile(path.join(source,'desktop/windows-export-runtime-lock.json'),'utf8'));
 const cache=path.resolve(root,'../runtime-downloads');await fs.mkdir(cache,{recursive:true});
 const python=path.join(root,'python/python.exe');
 for(const item of [lock.node,...lock.pythonPackages]) {
  const archive=path.join(cache,path.basename(new URL(item.url).pathname));let data;
  try{data=await fs.readFile(archive)}catch{}
  if(!data||hash(data)!==item.sha256){const response=await fetch(item.url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error(`Download failed: ${response.status} ${item.url}`);data=Buffer.from(await response.arrayBuffer());if(hash(data)!==item.sha256)throw Error('Runtime archive hash mismatch: '+item.name);await fs.writeFile(archive,data);}
  const node=item===lock.node,destination=path.join(root,node?'export-node':'jianying-python');await fs.mkdir(destination,{recursive:true});
  execFileSync(python,['-I','-X','utf8','-c',`import pathlib,sys,zipfile,stat
archive,dest,mode=sys.argv[1:];root=pathlib.Path(dest).resolve()
with zipfile.ZipFile(archive) as z:
 for info in z.infolist():
  if info.is_dir():continue
  if stat.S_ISLNK(info.external_attr >> 16):raise ValueError('Archive contains a symlink')
  name=info.filename
  if mode=='node':
   if name not in ('node-v${lock.node.version}-win-x64/node.exe','node-v${lock.node.version}-win-x64/LICENSE'):continue
   name=pathlib.PurePosixPath(name).name
  target=(root/name).resolve()
  if not target.is_relative_to(root):raise ValueError('Archive path escapes destination')
  target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(info))
`,archive,destination,node?'node':'wheel'],{windowsHide:true,timeout:60000});
 }
 await fs.copyFile(path.join(source,'desktop/windows-export-runtime-lock.json'),path.join(root,'jianying-python/runtime-lock.json'));
 const origins=JSON.parse(await fs.readFile(path.join(root,'provenance.json'),'utf8'));
 const components=[lock.node,...lock.pythonPackages.map(row=>({...row,licenseFiles:'jianying-python/*dist-info/licenses or LICENSE*'}))];
 origins.components=origins.components.filter(row=>!components.some(item=>item.name===row.name));origins.components.push(...components);
 await fs.writeFile(path.join(root,'provenance.json'),JSON.stringify(origins,null,2));
 console.log('Prepared pinned Windows Jianying dependencies and Node '+lock.node.version);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareWindowsExportRuntimes();
