const fs=require('node:fs'),path=require('node:path');
const {macAppDirectory,validateMacArch}=require('./platform.cjs');
async function buildUpdateSource({source,npm,arch,run,progress}){
 validateMacArch(arch);
 progress(2);
 await run(npm,['ci'],source);
 await run(npm,['--prefix','vendor/openscreen','ci','--ignore-scripts'],source);
 progress(3);
 await run(npm,['run','build:app'],source);
 const app=path.join(source,'release',macAppDirectory(arch),'OpenTake Standard.app');
 if(!fs.existsSync(app))throw Error('构建未生成匹配本机芯片的 Standard App（'+arch+'）');
 return app;
}
module.exports={buildUpdateSource};
