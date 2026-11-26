const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const destination='desktop/builtin-runtime';
const files=['agent.mjs','THIRD-PARTY-NOTICES.txt'];
const resource={from:path.resolve(__dirname,'../.build/builtin-runtime'),to:'app/'+destination,filter:files};
function hashes(directory){
 return Object.fromEntries(files.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')]));
}
function record(receiptFile){
 const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
 receipt.builtinRuntime=hashes(resource.from);
 fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n');
}
function matches(root,receipt){
 const actual=hashes(path.join(root,destination));
 return files.every(name=>actual[name]===receipt.builtinRuntime?.[name]);
}
module.exports={destination,resource,record,matches};
