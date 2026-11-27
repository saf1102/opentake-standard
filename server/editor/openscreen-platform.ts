import platform from '../platform.ts';
import path from 'node:path';
import fs from 'node:fs';
// Preserve the existing Standard Windows lookup and launch behavior.
export function windowsExecutableCandidates(env: NodeJS.ProcessEnv): string[] | undefined {
  if(process.platform==='win32'){
    const dirs=String(env.PATH||env.Path||'').split(path.delimiter).filter(dir=>path.isAbsolute(dir));
    return [...new Set([env.OPENSCREEN_BIN,...dirs.map(dir=>path.join(dir,'Openscreen.exe')),...[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs'),env.ProgramFiles].filter((v):v is string=>Boolean(v)).flatMap(dir=>['Openscreen','OpenScreen','openscreen'].map(name=>path.join(dir,name,'Openscreen.exe')))].filter((v):v is string=>Boolean(v)))];
  }
  return undefined;
}
export const skipExecutableVersionProbe = () => process.platform === 'win32';
/** Windows 不运行 Openscreen.exe 查版本（会弹出窗口）。安装包自带的录屏组件在 runtimes/openscreen/ 下，
 * 版本写在同一安装包的 runtimes/manifest.json 里；只认这个位置，用户自己装的 OpenScreen 仍按「没查到版本」处理。 */
export function bundledWindowsVersion(executable: string, read: (file: string) => string = file => fs.readFileSync(file, 'utf8')): string | undefined {
  const dir = path.win32.dirname(executable);
  const runtimes = path.win32.dirname(dir);
  if (path.win32.basename(runtimes).toLowerCase() !== 'runtimes' || path.win32.basename(dir).toLowerCase() !== 'openscreen' || path.win32.basename(executable).toLowerCase() !== 'openscreen.exe') return undefined;
  try {
    const manifest = JSON.parse(read(path.win32.join(runtimes, 'manifest.json')));
    if (manifest?.schema !== 1 || manifest?.platform !== 'win32-x64' || !Array.isArray(manifest.components)) return undefined;
    const version = manifest.components.find((row: { name?: unknown }) => row?.name === 'OpenScreen')?.version;
    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
  } catch { return undefined; }
}
export const windowsVersionSupported = (version: string | undefined) => Boolean(version && /^2\.1\.2$/.test(version));
export const openScreenAppDataRoot = () => platform.appDataRoot();
export const legacyWindowsHud = false;

export const windowsRecordingSupported = true;
