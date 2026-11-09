const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {reconcileAfterInstall,receiptMatches}=require('./client-update.cjs');
const newer=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false};
test('Windows installer relaunch marks the update finished only for that version or newer',()=>{
 const s={status:'installing',version:'1.1.4',step:2,installer:'C:\\x\\OpenTake-Standard-Setup-1.1.4-x64.exe',totalBytes:9};
 assert.deepEqual(reconcileAfterInstall(s,'1.1.4',newer),{...s,status:'completed',step:3,installer:undefined});
 assert.equal(reconcileAfterInstall(s,'1.1.5',newer).status,'completed');
 // Installer failed and the old version came back: keep the state so the user sees what happened.
 assert.equal(reconcileAfterInstall(s,'1.1.3',newer),null);
 for(const other of [{...s,status:'prepared'},{...s,status:'completed'},{status:'installing'},null])assert.equal(reconcileAfterInstall(other,'1.1.4',newer),null);
});
test('receipt check skips files packaging leaves out (tests, test-support)',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-'));
 try{const blob=b=>crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
  fs.mkdirSync(path.join(root,'server/test-support'),{recursive:true});fs.writeFileSync(path.join(root,'server/a.ts'),'a');
  const files={'server/a.ts':blob(Buffer.from('a')),'server/test-support/fake-cli.ts':'0'.repeat(40),'server/a.test.ts':'0'.repeat(40)};
  fs.writeFileSync(path.join(root,'release-source.json'),JSON.stringify({repository:'saf1102/opentake-standard',version:'1.1.3',files}));
  assert.equal(receiptMatches(root,'1.1.3'),true);
  fs.writeFileSync(path.join(root,'server/a.ts'),'edited');assert.equal(receiptMatches(root,'1.1.3'),false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
