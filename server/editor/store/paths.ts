import {defaultProjectRoot} from '../../system-settings.ts';
import {processOwner,isProcessOwnerCancelled} from '../../proc.ts';
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * 存储边界·路径与原子写入层。
 * 只回答「文件在哪里、如何原子写入」，不读工程内容、不做迁移。
 */

export function rootDir(): string { return defaultProjectRoot(); }
export function trashDir(root = rootDir()): string { return path.join(root, ".Trash"); }
export function projectLibrary(dir:string):string { const parent=path.dirname(dir); return path.basename(parent)==='.Trash'?path.dirname(parent):parent; }
export { projectRoots } from '../../system-settings.ts';
export function safeName(value: unknown): string {
  const name = String(value || "")
    .trim()
    .replace(/[/:\0]/g, " ")
    .replace(/\s+/g, " ");
  if (!name || name.length > 80)
    throw new Error("工程名称需为 1–80 个字符，且不能包含斜杠");
  return name;
}
export function projectFile(dir: string): string {
  return path.join(dir, "project.json");
}
/** 原子写入：先写临时文件再 rename，任何中途失败都不留下半个 JSON。 */
export function atomicJson(file: string, value: unknown) {
  if(processOwner.getStore()?.startsWith('quick-edit:')&&isProcessOwnerCancelled())return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function dirs(dir: string) {
  for (const rel of [
    "media/originals",
    "media/proxies",
    "analysis",
    "analysis/cursor",
    "analysis/openscreen",
    "analysis/openscreen/host-sessions",
    "analysis/screen-motion-legacy",
    "analysis/capture-jobs",
    "cache/thumbnails",
    "cache/filmstrips",
    "cache/waveforms",
    "exports",
  ])
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
}
