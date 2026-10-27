import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
/** Source checkout uses public; packaged runtime ships these assets once in dist. */
export function staticAssetRoot(root = runtimeRoot): string {
  const source = path.join(root, 'public');
  return fs.existsSync(source) ? source : path.join(root, 'dist');
}
export function staticAssetPath(relative: string, root = runtimeRoot): string {
  const base = staticAssetRoot(root);
  const result = path.resolve(base, relative.replace(/^\/+/, ''));
  if (result !== base && !result.startsWith(base + path.sep)) throw new Error('Invalid static asset path');
  return result;
}
