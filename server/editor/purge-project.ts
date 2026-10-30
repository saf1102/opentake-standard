import fs from 'node:fs';
import path from 'node:path';
/** Delete only a real project directory immediately inside this library's trash. Never follow media references. */
export async function purgeProjectDirectory(trash:string,dir:string,deletedAt:number|undefined){
 if(!deletedAt)throw Error('只能彻底删除回收站中的工程');
 const root=fs.realpathSync(trash),target=path.resolve(dir);
 if(fs.lstatSync(target).isSymbolicLink()||path.dirname(fs.realpathSync(target))!==root||target===root)throw Error('工程不在回收站目录内');
 await fs.promises.rm(target,{recursive:true,force:false});
}
