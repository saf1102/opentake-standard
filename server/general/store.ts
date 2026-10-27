import os from 'node:os';
/**
 * 通用剪辑工程的存储。每个工程是共享工程根目录下的一个文件夹，里面放 general-project.json：
 *   general-project.json  工程（src/general/general-contract.ts 的 GeneralProject）
 *   media/                用户放进来的素材和它们的封面
 *   versions/             第 N 版：vN.mp4、vN.jpg
 *   review/               OpenTake 审片抽的帧和结论
 *   work/                 Agent 的工作目录（Codex 只能写这里）
 *   agent/                OpenTake 自己的运行记录（会话号、事件日志、排队的消息）
 * 口播工程只认 project.json，所以既看不到也不会改写这些文件夹；这里也从不读写 project.json。
 * 删除和口播工程一样：移进同一工程库的 .Trash，记下删除时间。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { defaultProjectRoot, legacyProjectsRoot, projectRoots, validateDirectory } from '../system-settings.ts';
import { GENERAL_API } from '../../src/general/general-contract.ts';
import type { GeneralAgentChoice, GeneralInputs, GeneralLength, GeneralProject, GeneralProjectSummary, GeneralSettings } from '../../src/general/general-contract.ts';

export const GENERAL_FILE = 'general-project.json';
const TRASH = '.Trash';
type Stored = GeneralProject & { deletedAt?: string };
export type GeneralLocation = { dir: string; project: GeneralProject };

/** Every change to a saved project is announced here (the events stream listens). */
export const generalChanges = new EventEmitter();
generalChanges.setMaxListeners(200);

const locations = new Map<string, string>();
const now = () => new Date().toISOString();

function readStored(dir: string): Stored | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, GENERAL_FILE), 'utf8'));
    return raw && raw.kind === 'general' && typeof raw.id === 'string' ? raw as Stored : undefined;
  } catch { return undefined; }
}
function writeAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); }
}
const publicProject = (stored: Stored): GeneralProject => { const { deletedAt: _deleted, ...project } = stored; void _deleted; return project; };

function bases(includeDeleted: boolean) {
  return [...new Set(projectRoots())].flatMap(root => includeDeleted ? [root, path.join(root, TRASH)] : [root]).filter(base => fs.existsSync(base));
}
function generalDirs(includeDeleted: boolean) {
  const dirs: string[] = [];
  for (const base of bases(includeDeleted)) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(base, entry.name, GENERAL_FILE))) dirs.push(path.join(base, entry.name));
  }
  return dirs;
}

export function scanGeneral(includeDeleted = false): GeneralLocation[] {
  const out: GeneralLocation[] = [];
  for (const dir of generalDirs(includeDeleted)) {
    const stored = readStored(dir);
    if (!stored || (!includeDeleted && stored.deletedAt)) continue;
    locations.set(stored.id, dir);
    out.push({ dir, project: publicProject(stored) });
  }
  return out.sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
}

function locate(id: string, includeDeleted = false): { dir: string; stored: Stored } {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const cached = locations.get(id);
  const fromCache = cached ? readStored(cached) : undefined;
  if (cached && fromCache?.id === id && (includeDeleted || !fromCache.deletedAt)) return { dir: cached, stored: fromCache };
  for (const dir of generalDirs(includeDeleted)) {
    const stored = readStored(dir);
    if (stored?.id === id && (includeDeleted || !stored.deletedAt)) { locations.set(id, dir); return { dir, stored }; }
  }
  locations.delete(id);
  throw notFound();
}
const notFound = () => Object.assign(new Error('通用剪辑工程不存在'), { status: 404 });

export function findGeneral(id: string): GeneralLocation {
  const { dir, stored } = locate(id);
  return { dir, project: publicProject(stored) };
}

/** Write the project as it is now; updatedAt moves forward and listeners get the full project. */
export function saveGeneral(dir: string, project: GeneralProject, { touch = true, restoring = false } = {}): GeneralProject {
  const stored = restoring ? undefined : readStored(dir);
  const next: Stored = { ...project, ...(touch ? { updatedAt: now() } : {}), ...(stored?.deletedAt ? { deletedAt: stored.deletedAt } : {}) };
  writeAtomic(path.join(dir, GENERAL_FILE), next);
  locations.set(project.id, dir);
  const out = publicProject(next);
  generalChanges.emit('change', out);
  return out;
}

/** Read-modify-write without awaiting in between, so two writers in this process cannot interleave. */
export function updateGeneral(id: string, change: (project: GeneralProject, dir: string) => void, options?: { touch?: boolean }): GeneralProject {
  const { dir, project } = findGeneral(id);
  change(project, dir);
  return saveGeneral(dir, project, options);
}

const LENGTHS: GeneralLength[] = [15, 30, 60, 'auto'];
export function parseSettings(value: unknown, fallback?: GeneralSettings): GeneralSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const aspect = raw.aspect ?? fallback?.aspect ?? '16:9';
  const length = raw.length ?? fallback?.length ?? 'auto';
  if (aspect !== '16:9' && aspect !== '9:16') throw Object.assign(new Error('画幅只能是 16:9 或 9:16'), { status: 400 });
  if (!LENGTHS.includes(length as GeneralLength)) throw Object.assign(new Error('片长只能是 15、30、60 秒或自动'), { status: 400 });
  return { aspect, length: length as GeneralLength };
}
const text = (value: unknown, max: number, label: string) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw Object.assign(new Error(`${label}必须是文字`), { status: 400 });
  if (value.length > max) throw Object.assign(new Error(`${label}不能超过 ${max} 个字`), { status: 400 });
  return value;
};

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
/** null or absent: 系统默认; else a model id and one of the efforts (the catalog check is the runner's, at each turn) */
function parseAgent(value: unknown): GeneralAgentChoice | undefined {
  if (value === null || value === undefined) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v !== 'object' || typeof v.model !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(v.model) || typeof v.effort !== 'string' || !EFFORTS.includes(v.effort)) throw Object.assign(new Error('模型或推理强度不对'), { status: 400 });
  return { model: v.model, effort: v.effort };
}

export function createGeneral(body: { styleId: string; settings?: unknown; inputs?: { kind?: unknown; text?: unknown; note?: unknown }; agent?: unknown; network?: unknown }, styleName: string): { dir: string; project: GeneralProject } {
  const kind = body.inputs?.kind ?? 'topic';
  if (kind !== 'footage' && kind !== 'topic') throw Object.assign(new Error('输入类型只能是 footage（放视频）或 topic（给文案）'), { status: 400 });
  const inputs: GeneralInputs = { kind, media: [], text: text(body.inputs?.text, 20_000, '文案') ?? '', note: text(body.inputs?.note, 4_000, '补充说明') ?? '' };
  const root = defaultProjectRoot();
  if (root === legacyProjectsRoot() && root.startsWith(os.homedir() + path.sep)) fs.mkdirSync(root, { recursive: true });
  validateDirectory(root);
  const created = new Date();
  const stamp = `${created.getFullYear()}${String(created.getMonth() + 1).padStart(2, '0')}${String(created.getDate()).padStart(2, '0')}-${String(created.getHours()).padStart(2, '0')}${String(created.getMinutes()).padStart(2, '0')}${String(created.getSeconds()).padStart(2, '0')}`;
  let folder = `通用剪辑 ${stamp}`;
  for (let i = 2; fs.existsSync(path.join(root, folder)); i++) folder = `通用剪辑 ${stamp} ${i}`;
  const dir = path.join(root, folder);
  fs.mkdirSync(dir);
  for (const sub of ['media', 'versions', 'review', 'work', 'agent']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const at = created.toISOString();
  const name = `${styleName} ${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')} ${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;
  const project: GeneralProject = { id: crypto.randomUUID(), kind: 'general', name, styleId: body.styleId, createdAt: at, updatedAt: at, settings: parseSettings(body.settings), inputs, versions: [], messages: [] };
  const agent = parseAgent(body.agent);
  if (agent) project.agent = agent;
  if (body.network === true) project.network = true;
  writeAtomic(path.join(dir, GENERAL_FILE), project);
  locations.set(project.id, dir);
  return { dir, project };
}

export function patchGeneral(id: string, body: Record<string, unknown>, onRename?: () => void): GeneralProject {
  return updateGeneral(id, project => {
    if (body.name !== undefined) {
      const name = text(body.name, 80, '工程名称')?.trim().replace(/\s+/g, ' ');
      if (!name) throw Object.assign(new Error('工程名称需为 1–80 个字符'), { status: 400 });
      project.name = name;
      onRename?.();
    }
    if (body.settings !== undefined) project.settings = parseSettings(body.settings, project.settings);
    if (body.agent !== undefined) { const agent = parseAgent(body.agent); if (agent) project.agent = agent; else delete project.agent; }
    if (body.network !== undefined) { if (typeof body.network !== 'boolean') throw Object.assign(new Error('联网只能是开或关'), { status: 400 }); project.network = body.network; }
    const inputs = body.inputs as Record<string, unknown> | undefined;
    if (inputs && typeof inputs === 'object') {
      const t = text(inputs.text, 20_000, '文案'), n = text(inputs.note, 4_000, '补充说明');
      if (t !== undefined) project.inputs.text = t;
      if (n !== undefined) project.inputs.note = n;
    }
  });
}

/** Move to this library's trash, the same rule as spoken projects (folder moved, deletion time recorded). */
export function trashGeneral(id: string) {
  const { dir, stored } = locate(id);
  const library = path.dirname(dir);
  const trash = path.join(library, TRASH);
  fs.mkdirSync(trash, { recursive: true });
  let target = path.join(trash, path.basename(dir));
  for (let i = 2; fs.existsSync(target); i++) target = path.join(trash, `${path.basename(dir)} ${i}`);
  writeAtomic(path.join(dir, GENERAL_FILE), { ...stored, deletedAt: now() });
  fs.renameSync(dir, target);
  locations.set(id, target);
  return target;
}
export function restoreGeneral(id: string): GeneralProject {
  const { dir, stored } = locate(id, true);
  if (!stored.deletedAt) return publicProject(stored);
  const library = path.dirname(path.dirname(dir));
  let target = path.join(library, path.basename(dir));
  for (let i = 2; fs.existsSync(target); i++) target = path.join(library, `${path.basename(dir)} ${i}`);
  fs.renameSync(dir, target);
  return saveGeneral(target, publicProject(stored), { restoring: true });
}
/** Permanently delete, only from inside the trash (like purgeProjectDirectory for spoken projects). */
export async function purgeGeneral(id: string) {
  const { dir, stored } = locate(id, true);
  if (!stored.deletedAt) throw Object.assign(new Error('只能彻底删除回收站中的工程'), { status: 409 });
  const trash = fs.realpathSync(path.dirname(dir));
  if (path.basename(trash) !== TRASH || fs.lstatSync(dir).isSymbolicLink()) throw new Error('工程不在回收站目录内');
  await fs.promises.rm(dir, { recursive: true, force: false });
  locations.delete(id);
}

export const fileUrl = (id: string, rel: string, version?: number | string) =>
  `${GENERAL_API}/projects/${id}/files/${rel.split(path.sep).join('/').split('/').map(encodeURIComponent).join('/')}${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ''}`;

export function summarize(project: GeneralProject): GeneralProjectSummary {
  const version = project.versions.find(v => v.n === project.current) || project.versions.at(-1);
  const poster = version?.posterUrl || project.inputs.media.find(m => m.poster)?.poster;
  return {
    id: project.id, kind: 'general', name: project.name, styleId: project.styleId, updatedAt: project.updatedAt, createdAt: project.createdAt,
    ...(version ? { duration: version.duration } : project.plan ? { duration: project.plan.duration } : {}),
    ...(poster ? { posterUrl: poster } : {}), ...(project.run ? { runState: project.run.state } : {}), versions: project.versions.length,
  };
}
