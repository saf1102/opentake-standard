import fs from 'node:fs';
import path from 'node:path';
import {staticAssetRoot} from '../static-assets.ts';
export async function readFrameAsset(bundle:string,pathname:string,publicRoot=staticAssetRoot()) {
  const relative=decodeURIComponent(pathname).replace(/^\//,'')||'index.html';
  const base=relative.startsWith('public/')||relative.startsWith('semantic-icons/')?publicRoot:bundle;
  const file=path.resolve(base,relative.replace(/^public\//,''));
  if(!file.startsWith(path.resolve(base)+path.sep))throw Error('Invalid asset path');
  const contentType=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2'} as Record<string,string>)[path.extname(file)]||'application/octet-stream';
  return {body:await fs.promises.readFile(file),contentType};
}
