import platform from './platform.cjs';
import diagnostics from './diagnostics.cjs';
diagnostics.installFatalDiagnostics(process.env.OPENTAKE_STANDARD_USER_DATA);
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// General generation/export intentionally creates detached groups. Track only groups
// created by this service so quitting Standard cannot leave its workers behind.
const groups=new Set();const originalSpawn=childProcess.spawn;
childProcess.spawn=function(...args){const child=originalSpawn.apply(this,args);const options=args[2]||args[1];if(options?.detached&&child.pid){groups.add(child.pid);child.once('close',()=>groups.delete(child.pid));}return child;};
syncBuiltinESMExports();
// Register ownership shutdown before loading Vite/config. A timed-out desktop
// must not leave a service that later opens a listener without its owner.
let server,stopping=false;
async function stop(){if(stopping)return;stopping=true;for(const pid of groups){try{platform.killTree(pid,'SIGTERM')}catch{}}try{if(server?.close)await server.close();else server?.httpServer.close()}catch{}setTimeout(()=>{for(const pid of groups){try{platform.killTree(pid,'SIGKILL')}catch{}}process.exit(0)},1000)}
process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
if(typeof process.send==='function'&&!process.connected)process.exit(0);
const send=value=>{if(process.connected)process.send?.(value,()=>{});};
const phase=stage=>{diagnostics.recordServiceEvent(process.env.OPENTAKE_STANDARD_USER_DATA,'startup-phase',{stage});send({startupPhase:stage});};
phase('runtime');
const {createServer,preview}=await import('vite');
if(stopping)process.exit(0);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const production=process.argv[2]==='production';
const port=Number(process.argv[3])||3119;
const options={root,configFile:path.join(root,'vite.config.ts'),server:{host:'127.0.0.1',port,strictPort:false,open:false},preview:{host:'127.0.0.1',port,strictPort:false,open:false}};
phase('config');
server=production?await preview(options):await createServer(options);
if(stopping){if(server.close)await server.close();else server.httpServer.close();process.exit(0)}
if(!production)await server.listen();
phase('listening');
const address=server.httpServer.address();
send({ready:`http://127.0.0.1:${address.port}`});
diagnostics.recordServiceEvent(process.env.OPENTAKE_STANDARD_USER_DATA,'startup-phase',{stage:'ready'});
