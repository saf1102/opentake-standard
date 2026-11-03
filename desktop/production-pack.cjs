const fs=require('node:fs/promises');
const path=require('node:path');
const {writePayloadManifest}=require('./install-payload.cjs');
// This hook touches the generated package only, never a checkout/runtime profile.
async function afterPack(context){
 const root=path.resolve(context.appOutDir),app=path.join(root,'resources','app');
 const removed=[];
 async function visit(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name),relative=path.relative(app,file).split(path.sep).join('/');
   if(entry.isSymbolicLink())throw Error('Production package contains a link: '+relative);
   const parts=relative.split('/');
   const discard=parts[0]==='node_modules'&&(entry.name.endsWith('.map')||/\.d\.(?:ts|cts|mts)$/.test(entry.name)||/\.(?:test|spec)\./.test(entry.name)||entry.isDirectory()&&['test','tests','__tests__','__mocks__','__snapshots__','.cache','.vite','.vite-temp'].includes(entry.name));
   if(discard){const checked=path.resolve(file);if(!checked.startsWith(app+path.sep))throw Error('Invalid cleanup target');await fs.rm(checked,{recursive:entry.isDirectory(),force:true});removed.push(relative)}
   else if(entry.isDirectory())await visit(file);
  }
 }
 await visit(app);
 const publicDir=path.join(app,'public');try{await fs.access(publicDir);throw Error('Duplicate public assets must not be packaged')}catch(error){if(error.code!=='ENOENT')throw error}
 for(const file of ['dist/index.html','dist/opentake-icon-512.png','dist/openscreen/linkreader.html','dist/openscreen/wallpapers/wallpaper1.jpg','desktop/main.cjs','server/editor/openscreen-export.ts'])await fs.access(path.join(app,file));
 const evidence=path.resolve(context.packager.projectDir,'../evidence/production-pack.json');
 await fs.mkdir(path.dirname(evidence),{recursive:true});
 await fs.writeFile(evidence,JSON.stringify({removed,staticAssetsSingleCopy:true,iconResourceEditing:true},null,2));
}
// electron-builder's Windows resource editing happens after afterPack. This hook
// runs after icon/version editing even when Authenticode signing is disabled.
async function finalizePayload(context){
 const payload=await writePayloadManifest(path.resolve(context.appOutDir));
 const evidence=path.resolve(context.packager.projectDir,'../evidence/production-pack.json');
 const prior=JSON.parse(await fs.readFile(evidence,'utf8'));
 await fs.writeFile(evidence,JSON.stringify({...prior,payload},null,2));
}
module.exports={afterPack,finalizePayload};
