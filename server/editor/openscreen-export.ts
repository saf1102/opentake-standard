import {cleanupPathSync,renameWithRetrySync} from '../file-ops.ts';
import {StringDecoder} from 'node:string_decoder';
import {fileURLToPath} from 'node:url';
import {staticAssetPath} from '../static-assets.ts';
import platform from '../platform.ts';
import {openScreenProjectProfile} from './openscreen-profile.ts';
import {ExportSettingsSchema,type ExportSettings} from '../../src/types/editor.ts';
import {probeExportMedia} from '../general/export-media.ts';
import {encodeScreenExportMedia} from './openscreen-encode.ts';
export {encodeScreenExportMedia} from './openscreen-encode.ts';
import {flatGeneralDraft} from '../general/export-draft.ts';
import {requireJianyingRuntimeSync} from './jianying/runtime.ts';
import {writeExportPreferences} from '../export-preferences.ts';
import {validateDirectory} from '../system-settings.ts';
import {assertVideoExportSupported} from '../../shared/export-video.ts';
import {screenPublishingEnabled, screenSpawnOptions, stopScreenExport, revealScreenCommand, registerPublishedAsset} from './openscreen-export-edition.ts';
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EditProject, OpenScreenExportJob } from "../../src/types/editor.ts";
import { OpenScreenExportJobSchema } from "../../src/types/editor.ts";
import { findOpenScreenExecutable, openScreenProfileArgs } from "./openscreen.ts";
import { readOpenScreenDocument } from "./openscreen-documents.ts";
import { atomicJson, findProject } from "./store.ts";

type JsonObject = Record<string, unknown>;
type LiveExport = { controller?:AbortController; finished:Promise<void>; cancelling?:boolean; child: ChildProcess; startedAt: number; job: OpenScreenExportJob };

const live = new Map<string, LiveExport>();
const unsaved = new Map<string, OpenScreenExportJob>();
export const activeOpenScreenExports = () => live.size;

/** Run the user's installed OpenScreen as a separate process. Its own Electron,
 * native compositor and FFmpeg stay together; never load its .node addon into
 * OpenTake's Electron or silently substitute OpenTake's renderer. */
export function resolveOpenScreenExportRunner(_document: unknown, lookup?: import("./openscreen.ts").OpenScreenLookup) {
  const executable = findOpenScreenExecutable(lookup);
  if (!executable) throw new Error("未检测到用户安装的 OpenScreen，暂不能录制或导出。请先安装支持当前 v7 工程及 export 命令的 OpenScreen，再重试；现有工程已保留。");
  const env = {...process.env, ...lookup?.env};
  // The embedded OpenTake service can run in Electron's Node mode. Do not
  // propagate that mode to the independently installed GUI/export application.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.OPENSCREEN_COMPOSITOR_VIEW_NODE;
  return {executable, argsPrefix: [...openScreenProfileArgs(lookup?.env), "export"], env, cwd: path.dirname(executable), kind: "installed-native" as const};
}

function safeId(value: unknown, label: string) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id)) throw new Error(`${label}无效`);
  return id;
}

function exportJobsDir(projectDir: string, documentId: string) {
  const target = path.join(
    projectDir,
    "analysis",
    "openscreen",
    safeId(documentId, "OpenScreen 文档 ID"),
    "export-jobs",
  );
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function jobFile(projectDir: string, documentId: string, jobId: string) {
  return path.join(exportJobsDir(projectDir, documentId), `${safeId(jobId, "导出任务 ID")}.json`);
}

function persist(job: OpenScreenExportJob) {
  const { dir } = findProject(job.projectId, true);
  job.updatedAt = Date.now();
  atomicJson(jobFile(dir, job.documentId, job.id), job);
  unsaved.delete(job.id);
  return job;
}
function persistFromProcess(job:OpenScreenExportJob) {
  try{persist(job);return true}catch(error){
    job.status='failed';job.error=`保存导出状态失败：${error instanceof Error?error.message:String(error)}；工程与已有文件保留。`;
    unsaved.set(job.id,job);
    if(unsaved.size>200)unsaved.delete(unsaved.keys().next().value!);
    const worker=live.get(job.id)?.child;
    try{if(worker?.pid&&worker.exitCode===null&&worker.signalCode===null)platform.killTree(worker.pid)}catch{}
    return false;
  }
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function timestamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sanitizeExportName(value: unknown, format: "mp4" | "gif") {
  const raw = String(value || "OpenScreen")
    .replace(/[\\/:*?"<>|\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "OpenScreen";
  const withoutExtension = raw.replace(/\.(?:mp4|gif)$/i, "");
  return `${withoutExtension}.${format}`;
}

function assertWithinExports(projectDir: string, value: unknown) {
  const root = path.resolve(projectDir, "exports");
  const target = path.resolve(String(value || ""));
  if (target !== root && !target.startsWith(`${root}${path.sep}`))
    throw new Error("导出路径必须位于当前工程 exports 目录");
  return target;
}

function uniqueOutput(target: string) {
  if (!fs.existsSync(target)) return target;
  const parsed = path.parse(target);
  for (let index = 2; index < 10_000; index++) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("无法分配导出文件名");
}

export function createOpenScreenExportTarget(
  projectId: string,
  documentId: string,
  input: { suggested?: unknown; format?: unknown },
) {
  const { dir } = findProject(projectId, true);
  readOpenScreenDocument(projectId, documentId);
  const format = input.format === "gif" || /\.gif$/i.test(String(input.suggested || ""))
    ? "gif"
    : "mp4";
  const folder = path.join(dir, "exports", timestamp(), "openscreen");
  fs.mkdirSync(folder, { recursive: true });
  return {
    path: uniqueOutput(path.join(folder, sanitizeExportName(input.suggested, format))),
    format,
  };
}

function assetLocalPath(
  projectDir: string,
  project: EditProject,
  assetId: string,
  kind: string,
) {
  const asset = project.media.find((item) => item.id === assetId);
  if (!asset) return undefined;
  const rel = kind === "proxy"
    ? asset.proxyFile || asset.originalFile
    : kind === "waveform"
      ? asset.waveformFile
      : asset.originalFile;
  return rel ? path.join(projectDir, rel) : undefined;
}

function localizeString(
  value: string,
  key: string,
  projectDir: string,
  project: EditProject,
  documentDir: string,
) {
  // Imported native OpenScreen projects are rewritten to same-origin API
  // paths so the browser microfrontend can open them from any LAN hostname.
  // Resolve those root-relative URLs before the generic URL/path branches.
  const relativeApi = value.match(/^\/api\/editor\/projects\/[^/]+\/media\/([^/]+)\/file(?:\?(.*))?$/);
  if (relativeApi) {
    const params = new URLSearchParams(relativeApi[2] || "");
    return assetLocalPath(
      projectDir,
      project,
      decodeURIComponent(relativeApi[1]),
      params.get("kind") || "original",
    ) || value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "file:") return fileURLToPath(parsed);
    const match = parsed.pathname.match(/\/api\/editor\/projects\/[^/]+\/media\/([^/]+)\/file$/);
    if (match) {
      return assetLocalPath(
        projectDir,
        project,
        decodeURIComponent(match[1]),
        parsed.searchParams.get("kind") || "original",
      ) || value;
    }
    return value;
  } catch {
    // Local filesystem path or an ordinary non-URL value.
  }
  if (path.isAbsolute(value)) return value;
  if (!/(?:path|source|original|proxy|waveform|cursor|video|audio)/i.test(key)) return value;
  const candidate = path.resolve(documentDir, value);
  return fs.existsSync(candidate) ? candidate : value;
}

function localizeDocument(
  value: unknown,
  projectDir: string,
  project: EditProject,
  documentDir: string,
  key = "",
): unknown {
  if (typeof value === "string")
    return localizeString(value, key, projectDir, project, documentDir);
  if (Array.isArray(value))
    return value.map((item) => localizeDocument(item, projectDir, project, documentDir, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject).map(([childKey, child]) => [
    childKey,
    localizeDocument(child, projectDir, project, documentDir, childKey),
  ]));
}

function inferProgress(event: JsonObject, job: OpenScreenExportJob) {
  const percentage = Number(event.percentage ?? event.percent ?? event.progress);
  if (Number.isFinite(percentage))
    job.progress = Math.max(job.progress, Math.min(99, percentage <= 1 ? percentage * 100 : percentage));
  const frame = Number(event.frames ?? event.frame ?? event.currentFrame ?? event.current_frame);
  if (Number.isInteger(frame) && frame >= 0) {
    job.currentFrame = frame;
    if (job.totalFrames) job.progress = Math.max(job.progress, Math.min(99, frame / job.totalFrames * 100));
  }
  const total = Number(event.totalFrames ?? event.total_frames);
  if (Number.isInteger(total) && total > 0) job.totalFrames = total;
  const duration = Number(event.videoDurationS ?? event.video_duration_s ?? event.durationSec ?? event.duration_sec);
  if (Number.isFinite(duration) && duration >= 0) job.videoDurationS = duration;
  const wall = Number(event.wallS ?? event.wall_s ?? event.elapsedSec ?? event.elapsed_sec);
  if (Number.isFinite(wall) && wall >= 0) job.wallS = wall;
}

function readJsonLines(chunk: string, state: { pending: string }, onEvent: (event: JsonObject) => void) {
  state.pending += chunk;
  const lines = state.pending.split(/\r?\n/);
  state.pending = lines.pop() || "";
  for (const line of lines) {
    try {
      const event = JSON.parse(line.trim()) as unknown;
      if (event && typeof event === "object" && !Array.isArray(event)) onEvent(event as JsonObject);
    } catch {
      // OpenScreen also writes human-readable diagnostics. Only NDJSON progress is consumed.
    }
  }
}

/** Keep explicit UI options across the external CLI boundary. */
export function mp4ExportArguments(fps: unknown, codec: unknown) {
  const rate = fps === undefined ? 30 : Number(fps);
  if (![24, 30, 60].includes(rate)) throw new Error("MP4 帧率必须为 24、30 或 60");
  if (codec !== undefined && !["h264", "h265", "hevc", "prores422"].includes(String(codec))) throw new Error("录屏编码无效");
  return ["--fps", String(rate)];
}

export function stageEditorSettings(document: unknown, snapshot: unknown, root = process.cwd()) {
  const staged = structuredClone(document) as JsonObject;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    staged.legacyEditor = {...(staged.legacyEditor as JsonObject || {}), ...(snapshot as JsonObject)};
  }
  const editor = staged.legacyEditor as JsonObject | null;
  if (editor && typeof editor.wallpaper === "string" && /^\/wallpapers\/wallpaper\d+\.jpg$/.test(editor.wallpaper)) {
    const relativeWallpaper = editor.wallpaper.slice(1);
    const file = ["dist/openscreen", "public/openscreen"].map(folder => path.join(root, folder, relativeWallpaper)).find(candidate => fs.existsSync(candidate));
    if (!file) throw new Error("录屏背景资源缺失，不能导出不同的背景");
    editor.wallpaper = file;
  }
  return staged;
}

/** 已保存版本导出不接受窗口内的 editor 覆盖；版本变化时请重新打开弹窗。 */
export function savedExportDocument(current:{document:unknown;revision:number},input:{useSavedDocument?:unknown;documentRevision?:unknown;exportEditor?:unknown;savedEditor?:unknown}) {
  if(input.useSavedDocument===true && (!Number.isInteger(input.documentRevision)||input.documentRevision!==current.revision))
    throw Error('已保存版本已变化，请关闭并重新打开导出窗口');
  // savedEditor 只补齐从已保存文档计算的预览默认值；已保存的显式字段始终优先。
  const defaults=input.savedEditor&&typeof input.savedEditor==='object'&&!Array.isArray(input.savedEditor)?input.savedEditor:{};
  const stored=(current.document as JsonObject).legacyEditor as JsonObject|null;
  return stageEditorSettings(current.document,input.useSavedDocument===true?{...defaults,...stored}:input.exportEditor);
}

/** 渲染和最终编码共用工程时钟，不能把原生中间文件的平均帧率当成工程帧率。 */
export function screenExportFrameRate(settings: ExportSettings | undefined, projectFps: unknown, document: unknown) {
  const doc = document as {project?:{primaryAssetId?:string};assets?:Array<{id:string;video?:{fps?:number}}>};
  const asset = doc.assets?.find(a=>a.id===doc.project?.primaryAssetId) || doc.assets?.find(a=>a.video);
  const fps = settings && settings.preset !== 'jianying' && typeof settings.fps === 'number'
    ? settings.fps : Number(projectFps) || Number(asset?.video?.fps) || 30;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw Error('工程帧率无效');
  return fps;
}

/** The installed renderer discovers telemetry beside the video, not in OpenTake's media database. */
export function stageCursorSidecars(document: unknown, project: EditProject, projectDir: string, stagingDir: string) {
  const staged = structuredClone(document) as JsonObject;
  for (const asset of (Array.isArray(staged.assets) ? staged.assets : []) as JsonObject[]) {
    const media = project.media.find(m => m.id === asset.id);
    const relative = media?.capture?.cursorDataFile;
    if (!relative) continue;
    const cursor = path.resolve(projectDir, relative);
    if (!cursor.startsWith(path.resolve(projectDir) + path.sep) || !fs.existsSync(cursor))
      throw new Error('录屏鼠标数据缺失，不能导出不一致的成片');
    const source = String(asset.originalPath || '');
    if (!path.isAbsolute(source) || !fs.existsSync(source)) throw new Error('录屏源视频缺失');
    const video = path.join(stagingDir, `${safeId(asset.id, '素材 ID')}${path.extname(source) || '.mp4'}`);
    fs.copyFileSync(source, video, fs.constants.COPYFILE_FICLONE);
    fs.copyFileSync(cursor, `${video}.cursor.json`);
    asset.originalPath = video;
  }
  return staged;
}

function qualityOf(value: unknown): OpenScreenExportJob["quality"] {
  return value === "medium" || value === "source" ? value : "good";
}

export function startOpenScreenExport(projectId: string, documentId: string, input: {
  outPath?: unknown;
  format?: unknown;
  purpose?: unknown;
  quality?: unknown;
  gifFps?: unknown;
  gifSize?: unknown;
  totalFrames?: unknown;
  mp4Fps?: unknown;
  codec?: unknown;
  exportEditor?: unknown;
  settings?: unknown;
  clientId?: unknown;
  useSavedDocument?: unknown;
  documentRevision?: unknown;
  savedEditor?: unknown;
}) {
  const existing=[...live.values()].find(item=>item.job.projectId===projectId&&item.job.documentId===documentId&&['queued','running'].includes(item.job.status));
  if(existing)throw Error('目标文件正在导出，请等待完成或取消后重试');
  const found = findProject(projectId, true);
  const current = readOpenScreenDocument(projectId, documentId);
  // Revision validation is read-only; staging failures below become persisted failed jobs.
  if(input.useSavedDocument===true && input.documentRevision!==current.revision)throw Error('已保存版本已变化，请关闭并重新打开导出窗口');
  const purpose = input.purpose === 'publish' && screenPublishingEnabled ? 'publish' : 'export';
  const settings=purpose==='publish'?undefined:input.settings===undefined
    ? ['hevc','h265','prores422'].includes(String(input.codec)) ? ExportSettingsSchema.parse({fps:input.mp4Fps===24||input.mp4Fps===60?input.mp4Fps:'project',video:{codec:input.codec==='hevc'?'h265':input.codec}}) : undefined
    : ExportSettingsSchema.parse(input.settings);
  if(settings&&settings.preset!=='jianying')assertVideoExportSupported(settings.video,process.platform);
  if(settings?.preset==='jianying')requireJianyingRuntimeSync();
  const runner = resolveOpenScreenExportRunner(current.document, process.platform === 'win32' ? undefined : {env:{...process.env,OPENSCREEN_USER_DATA_DIR:openScreenProjectProfile(projectId)}});
  const requestedFps=screenExportFrameRate(settings,found.project.settings.fps,current.document);
  if(settings)writeExportPreferences(found.dir,settings);
  const publishedAssetId = purpose === 'publish' ? `osout_${crypto.randomUUID()}` : undefined;
  const publicationVersion = purpose === 'publish' ? found.project.media.filter(asset=>asset.origin==='openscreen-published'&&asset.openScreenDocumentId===documentId).length+1 : undefined;
  const format = purpose==='publish' ? 'mp4' : input.format === "gif" ? "gif" : "mp4";
  const mp4Args = format === "mp4" ? settings ? ['--fps',String(requestedFps)] : mp4ExportArguments(input.mp4Fps,input.codec) : [];
  let target = purpose==='publish' ? path.join(found.dir,'media','originals',`${publishedAssetId}.mp4`) : input.outPath
    ? assertWithinExports(found.dir, input.outPath)
    : createOpenScreenExportTarget(projectId, documentId, {
        suggested: `${current.ref.title}.${format}`,
        format,
      }).path;
  if (path.extname(target).toLowerCase() !== `.${format}`)
    throw new Error(`导出文件扩展名必须为 .${format}`);
  if(settings) {
    const destination=settings.destinationDir.trim()?validateDirectory(settings.destinationDir):path.join(found.dir,'exports');
    target=path.join(destination,crypto.randomUUID(),'source.mp4');
  }
  const targetKey=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
  if([...live.values()].some(item=>targetKey(item.job.outputFile)===targetKey(target)))throw Error('该目标正在导出，请等待完成或取消后重试。');
  const createdOutputDirectory=!fs.existsSync(path.dirname(target));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const outputDir=path.dirname(target);
  // Release only this job's empty reservation; preserve existing output files.
  const releaseEmptyOutputDirectory=()=>{if(createdOutputDirectory&&fs.existsSync(outputDir)&&fs.readdirSync(outputDir).length===0){try{fs.rmdirSync(outputDir)}catch(error){if(!['ENOENT','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code||''))console.warn('[OpenScreen] empty output directory retained',error)}}};
  const resultFile=settings?path.join(outputDir,settings.preset==='jianying'?'剪映工程':`成片.${settings.video.codec==='prores422'?'mov':settings.video.container}`):target;

  const id = crypto.randomUUID();
  const now = Date.now();
  const job = OpenScreenExportJobSchema.parse({
    id,
    projectId,
    documentId,
    ...(input.useSavedDocument===true?{requestClientId:String(input.clientId||''),savedDocumentRevision:current.revision}:{}),
    status: "queued",
    format,
    purpose,
    publishedAssetId,
    quality: settings?'source':qualityOf(input.quality),
    progress: 0,
    totalFrames: Number.isInteger(Number(input.totalFrames)) && Number(input.totalFrames) > 0
      ? Number(input.totalFrames)
      : undefined,
    outputFile: resultFile,
    ...(settings?{outputDir,exportSettings:settings}:{}),
    createdAt: now,
    updatedAt: now,
  });
  persist(job);

  const stagingDir = path.join(exportJobsDir(found.dir, documentId), `.staging-${id}`);
  const stagedProject = path.join(stagingDir, "project.openscreen");
  try {
  fs.mkdirSync(stagingDir, { recursive: true });
  const exportDocument=savedExportDocument(current,input);
  const localizedDocument = localizeDocument(
    exportDocument,
    found.dir,
    found.project,
    path.dirname(path.join(found.dir, current.ref.relativePath)),
  );
  const stagedDocument = stageCursorSidecars(localizedDocument, found.project, found.dir, stagingDir);
  fs.writeFileSync(stagedProject, JSON.stringify(stagedDocument, null, 2));
  } catch(error) {
    job.status='failed';job.error=`准备导出失败：${error instanceof Error?error.message:String(error)}`;
    persistFromProcess(job);cleanupPathSync(stagingDir,{recursive:true});releaseEmptyOutputDirectory();throw error;
  }

  const workingOutput=path.join(stagingDir,`output.${format}`);
  let preserveStaging=false;
  job.status='running';job.startedAt=Date.now();job.progress=1;persist(job);
  const args = [
    ...runner.argsPrefix,
    stagedProject,
    "-o",
    workingOutput,
    "--format",
    format,
    "--quality",
    job.quality,
    "--json",
    ...mp4Args,
  ];
  if (format === "gif") {
    const fps = [15, 20, 25, 30].includes(Number(input.gifFps)) ? Number(input.gifFps) : 20;
    const size = ["medium", "large", "original"].includes(String(input.gifSize))
      ? String(input.gifSize)
      : "large";
    args.push("--gif-fps", String(fps), "--gif-size", size);
  }

  let child: ChildProcess;
  try { child = spawn(runner.executable, args, {
    ...screenSpawnOptions,
    cwd: runner.cwd,
    env: runner.env,
    stdio: ["ignore", "pipe", "pipe"],
  }); } catch (error) {
    job.status='failed';job.error=error instanceof Error?error.message:String(error);
    persistFromProcess(job);cleanupPathSync(stagingDir,{recursive:true});releaseEmptyOutputDirectory();throw error;
  }
  const controller=new AbortController();
  let finish!:()=>void;
  const finished=new Promise<void>(resolve=>{finish=resolve});
  live.set(id, { child, startedAt: Date.now(), job, finished, controller });

  const stdout = { pending: "" };
  const decoder=new StringDecoder('utf8');
  const diagnostics: string[] = [];
  const stderr: string[] = [];
  const onExportEvent=(event:JsonObject)=>{
    if (job.status !== "running"||live.get(id)?.cancelling) return;
    inferProgress(event, job);
    if(event.type==='error'||event.event==='error'||event.event==='done'&&event.success===false){job.status='failed';job.error=String(event.error||event.message||'OpenScreen 报告导出失败');}
    if (event.error || event.message || event.type === "error") {
      diagnostics.push(JSON.stringify(event));
      if (diagnostics.length > 40) diagnostics.shift();
    }
    persistFromProcess(job);
  };
  child.stdout!.on('data',chunk=>readJsonLines(decoder.write(chunk),stdout,onExportEvent));
  child.stdout!.once('end',()=>{const tail=decoder.end();if(stdout.pending||tail)readJsonLines(tail+'\n',stdout,onExportEvent)});
  child.stderr!.on("data", (chunk) => {
    stderr.push(String(chunk));
    if (stderr.length > 80) stderr.shift();
  });
  child.once("error", (error) => {
    live.delete(id);
    if (job.status === "cancelled") return;
    job.status = "failed";
    job.error = error.message;
    persistFromProcess(job);
  });
  child.once("close", async (code, signal) => {
    const cancelled=live.get(id)?.cancelling;
    try {
    if (cancelled) {
      job.status='cancelled';job.completedAt=Date.now();
      persistFromProcess(job);
      return;
    }
    if(job.status==='failed'){persistFromProcess(job);return;}
    if (code === 0 && fs.existsSync(workingOutput) && fs.statSync(workingOutput).size > 0) {
      try {
        preserveStaging=true;
        let generated=workingOutput;
        let encoding:Awaited<ReturnType<typeof encodeScreenExportMedia>>['encoding']|undefined;
        if(settings){
          generated=path.join(stagingDir,settings.preset==='jianying'?'剪映工程':path.basename(resultFile));
          if(settings.preset==='jianying')await flatGeneralDraft(workingOutput,generated,current.ref.title,await probeExportMedia(workingOutput),controller.signal);
          else encoding=(await encodeScreenExportMedia(workingOutput,generated,settings,requestedFps,current.ref.duration,controller.signal))?.encoding;
        }
        if(controller.signal.aborted||live.get(id)?.cancelling){job.status='cancelled';job.completedAt=Date.now();persistFromProcess(job);preserveStaging=false;return;}
        renameWithRetrySync(generated,resultFile);
        if(encoding)fs.writeFileSync(path.join(outputDir,'编码信息.json'),JSON.stringify(encoding,null,2));
        preserveStaging=false;
        job.status = "completed";
        job.progress = 100;
        job.completedAt = Date.now();
        job.wallS = job.wallS ?? Math.max(0, (job.completedAt - (job.startedAt || job.createdAt)) / 1000);
      } catch (error) {
        if(controller.signal.aborted||live.get(id)?.cancelling){
          job.status='cancelled';job.completedAt=Date.now();preserveStaging=false;
        }else{
          job.status = "failed";
          job.error = `成片已生成，但写入目标失败：${error instanceof Error ? error.message : String(error)}；临时成片保留：${workingOutput}`;
        }
      }
    } else {
      job.status = "failed";
      job.error = stderr.join("").trim().slice(-4_000)
        || diagnostics.join("\n").trim().slice(-4_000)
        || `OpenScreen 导出退出（${code ?? "未知"}${signal ? `，${signal}` : ""}）`;
    }
    persistFromProcess(job);
    }catch(error){job.status='failed';job.error=`导出收尾失败：${error instanceof Error?error.message:String(error)}`;persistFromProcess(job);}
    finally{live.delete(id);if(!preserveStaging)cleanupPathSync(stagingDir,{recursive:true});if(job.status==='failed'||job.status==='cancelled')releaseEmptyOutputDirectory();finish();}
  });

  return job;
}

export function readOpenScreenExport(projectId: string, documentId: string, jobId: string) {
  const { dir } = findProject(projectId, true);
  const file = jobFile(dir, documentId, jobId);
  const current=unsaved.get(jobId)??live.get(jobId)?.job;
  if(current&&current.projectId===projectId&&current.documentId===documentId)return {...current};
  if (!fs.existsSync(file)) throw new Error("OpenScreen 导出任务不存在");
  const job = OpenScreenExportJobSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  if(job.projectId!==projectId||job.documentId!==documentId||job.id!==jobId)throw Error('导出任务不属于当前工程或文档，未操作其他任务。');
  if ((job.status === "queued" || job.status === "running") && !live.has(job.id)) {
    job.status = "interrupted";
    job.error = "LinkReader 服务重启导致导出中断，可以重新发起导出。";
    persist(job);
  }
  return job;
}

export async function cancelOpenScreenExport(projectId: string, documentId: string, jobId: string) {
  const persisted = readOpenScreenExport(projectId, documentId, jobId);
  const job = live.get(jobId)?.job ?? persisted;
  if (job.status !== "running" && job.status !== "queued") return job;
  const active=live.get(job.id),worker=active?.child;
  if(active){active.cancelling=true;active.controller?.abort();}
  if(worker?.exitCode===null&&worker.signalCode===null){if(process.platform==="win32"&&worker.pid)platform.killTree(worker.pid);else worker.kill("SIGTERM");}
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{if(active)await Promise.race([active.finished,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('正在等待 OpenScreen 导出进程退出，请稍后重试取消')),10_000)})]);}
  finally{clearTimeout(timer);}
  if(!active){job.status='cancelled';job.completedAt=Date.now();persistFromProcess(job);}
  return job;
}

export async function revealOpenScreenExport(projectId: string, value: unknown) {
  const { dir } = findProject(projectId, true);
  const saved=listScreenExports(projectId).find(j=>j.status==='completed'&&(j.outputFile===value||j.outputDir===value));
  const target = saved ? String(value) : assertWithinExports(dir, value);
  if (!fs.existsSync(target)) throw new Error("导出文件不存在");
  const reveal=revealScreenCommand(target);
  const child = spawn(reveal.command, reveal.args, { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve)});
  child.unref();
  return { path: target };
}

/** Read only this project's persisted jobs, including jobs from prior app sessions. */
export function listScreenExports(projectId:string):OpenScreenExportJob[] {
 const {dir}=findProject(projectId,true),root=path.join(dir,'analysis','openscreen');
 if(!fs.existsSync(root))return [];
 const jobs:OpenScreenExportJob[]=[];
 for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
  if(!entry.isDirectory()||!/^[a-zA-Z0-9_-]{1,96}$/.test(entry.name))continue;
  const folder=path.join(root,entry.name,'export-jobs');if(!fs.existsSync(folder))continue;
  for(const file of fs.readdirSync(folder).filter(f=>/^[a-zA-Z0-9_-]+\.json$/.test(f))) {
   const job=readOpenScreenExport(projectId,entry.name,file.slice(0,-5));jobs.push(job);
  }
 }
 return jobs.sort((a,b)=>b.createdAt-a.createdAt);
}
