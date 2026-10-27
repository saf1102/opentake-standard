import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// General generation/export intentionally creates detached groups. Track only groups
// created by this service so quitting Standard cannot leave its workers behind.
const groups=new Set();const originalSpawn=childProcess.spawn;
childProcess.spawn=function(...args){const child=originalSpawn.apply(this,args);const options=args[2]||args[1];if(options?.detached&&child.pid){groups.add(child.pid);child.once('close',()=>groups.delete(child.pid));}return child;};
syncBuiltinESMExports();
const {createServer,preview}=await import('vite');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const production=process.argv[2]==='production';
const port=Number(process.argv[3])||3119;
const options={root,configFile:path.join(root,'vite.config.ts'),server:{host:'127.0.0.1',port,strictPort:false,open:false},preview:{host:'127.0.0.1',port,strictPort:false,open:false}};
const server=production?await preview(options):await createServer(options);
if(!production)await server.listen();
const address=server.httpServer.address();
process.send?.({ready:`http://127.0.0.1:${address.port}`});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;for(const pid of groups){try{process.kill(-pid,'SIGTERM')}catch{}}if(production)server.httpServer.close();else await server.close();setTimeout(()=>{for(const pid of groups){try{process.kill(-pid,'SIGKILL')}catch{}}process.exit(0)},1000).unref()}
process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
