import os from 'node:os';
import path from 'node:path';
import ids from '../../src/standard/styles.json' with {type:'json'};
import {FREE_STYLE, type StyleInfo} from './brief.ts';
import platform from '../platform.ts';
export const standardEdition: boolean = true;
export const extraStyle: StyleInfo | undefined = FREE_STYLE;
export const includeStyle = (id: string) => ids.includes(id);
export const recordCodexUsage = () => {};
export const styleError = '请选择 Standard 的 10 种风格之一，或选「不用风格」';
export const revealCommand = platform.revealCommand;
export const revealPath = platform.revealPath;

/** 保留 Standard 既有默认目录规则；只自动创建 home 内的旧默认目录。 */
export const canCreateLegacyProjectRoot = (root: string) => root.startsWith(os.homedir() + path.sep);
export const killProcessGroup = (pid: number, signal: NodeJS.Signals) => platform.killTree(pid, signal);
