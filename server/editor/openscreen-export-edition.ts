import type {ChildProcess} from 'node:child_process';
import platform from '../platform.ts';
export const screenPublishingEnabled = false;
export const screenSpawnOptions = {detached: process.platform === 'win32', windowsHide: true};
export function stopScreenExport(worker?:ChildProcess) {if(process.platform==='win32'&&worker?.pid)platform.killTree(worker.pid);else worker?.kill('SIGTERM');}
export const revealScreenCommand = platform.revealCommand;
export function registerPublishedAsset(_input:unknown):never {throw Error('标准版不提供发送到口播剪辑');}
