import fs from 'node:fs';import path from 'node:path';import {projectFolder,atomicJson} from '../editor/store.ts';import {ScreenEditSchema,type ScreenProject} from './legacy-screen.ts';import {screenDocuments} from './screen-project.ts';
/** Only the earlier Standard editor format is upgraded. Backups precede every mutation. */
export function migrateLegacyScreen(id:string){const dir=projectFolder(id),legacy=path.join(dir,'screen-project.json'),marker=path.join(dir,'.standard-openscreen-v7.json');if(!fs.existsSync(legacy)||fs.existsSync(marker))return false;
 const p=JSON.parse(fs.readFileSync(legacy,'utf8')) as ScreenProject;ScreenEditSchema.parse(p.edit);const file=path.join(dir,'project.json');const current=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):undefined;
 const backup=path.join(dir,'backups','standard-screen-before-openscreen');fs.mkdirSync(backup,{recursive:true});for(const name of ['screen-project.json','project.json'])if(fs.existsSync(path.join(dir,name))&&!fs.existsSync(path.join(backup,name)))fs.copyFileSync(path.join(dir,name),path.join(backup,name),fs.constants.COPYFILE_EXCL);
 // A newer v7 editor's work wins over the old Standard cache.
 if(current&&current.revision!==p.revision){atomicJson(marker,{preservedNewerDocument:true});return false}
 const docs=screenDocuments(p,path.join(dir,'source.mp4'),fs.statSync(path.join(dir,'source.mp4')).size);const docPath=path.join(dir,docs.ref.relativePath);if(fs.existsSync(docPath)&&!fs.existsSync(path.join(backup,'project.openscreen')))fs.copyFileSync(docPath,path.join(backup,'project.openscreen'),fs.constants.COPYFILE_EXCL);
 atomicJson(docPath,docs.document);atomicJson(path.join(path.dirname(docPath),'document.json'),docs.ref);atomicJson(file,{...docs.project,standardKind:'screen'});atomicJson(marker,{migratedAt:Date.now(),backup:'backups/standard-screen-before-openscreen'});return true;
}
