const fs=require('node:fs');
const path=require('node:path');
// Vite's dist contains the single production copy of public assets.
function assetRoot(root){const source=path.join(root,'public');return fs.existsSync(source)?source:path.join(root,'dist')}
module.exports={assetRoot};
