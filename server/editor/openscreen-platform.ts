import platform from '../platform.ts';
import path from 'node:path';
// Preserve the existing Standard Windows lookup and launch behavior.
export function windowsExecutableCandidates(env: NodeJS.ProcessEnv): string[] | undefined {
  if(process.platform==='win32'){
    const dirs=String(env.PATH||env.Path||'').split(path.delimiter).filter(dir=>path.isAbsolute(dir));
    return [...new Set([env.OPENSCREEN_BIN,...dirs.map(dir=>path.join(dir,'Openscreen.exe')),...[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs'),env.ProgramFiles].filter((v):v is string=>Boolean(v)).flatMap(dir=>['Openscreen','OpenScreen','openscreen'].map(name=>path.join(dir,name,'Openscreen.exe')))].filter((v):v is string=>Boolean(v)))];
  }
  return undefined;
}
export const skipExecutableVersionProbe = () => process.platform === 'win32';
export const windowsVersionSupported = (version: string | undefined) => Boolean(version && /^2\.1\.2$/.test(version));
export const openScreenAppDataRoot = () => platform.appDataRoot();
export const legacyWindowsHud = false;
