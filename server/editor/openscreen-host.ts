import platform from '../platform.ts';
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import {promisify} from 'node:util';
import {ffprobePath} from '../general/kit-env.ts';
import {recordingDocument} from '../../shared/openscreen-recording.ts';
import type {
  EditProject,
  MediaAsset,
  OpenScreenHostCandidate,
  OpenScreenHostSession,
} from "../../src/types/editor.ts";
import {
  OpenScreenHostCandidateSchema,
  OpenScreenHostSessionSchema,
} from "../../src/types/editor.ts";
import { findOpenScreenExecutable, appBundleForExecutable, openScreenProfile, openScreenProfileArgs, listOpenScreenSources } from "./openscreen.ts";
import { NativeRecordingController, type NativeRecordingState } from './native-recording.ts';
import { correctNativeRecordingTime } from './native-recording-clock.ts';
import { windowsRecordingHelper } from './native-recording-helper.ts';
import { z } from 'zod';
import { processMedia } from "./media.ts";
import { createOpenScreenDocument } from "./openscreen-documents.ts";
import { atomicJson, findProject, save } from "./store.ts";

type JsonObject = Record<string, unknown>;

const profile = openScreenProfile();
const OPENSCREEN_SUPPORT_ROOTS = profile ? [profile] : [
  path.join(platform.appDataRoot(), "openscreen"),
  path.join(platform.appDataRoot(), "OpenScreen"),
  path.join(platform.appDataRoot(), "Openscreen"),
];
const PROJECT_ROOTS = OPENSCREEN_SUPPORT_ROOTS.map((root) => path.join(root, "projects"));
const RECORDING_ROOTS = [
  ...OPENSCREEN_SUPPORT_ROOTS.map((root) => path.join(root, "recordings")),
];

function sessionDir(projectId: string) {
  const { dir } = findProject(projectId, true);
  const target = path.join(dir, "analysis", "openscreen", "host-sessions");
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function sessionFile(projectId: string, sessionId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("原生录制会话 ID 无效");
  return path.join(sessionDir(projectId), `${sessionId}.json`);
}

function persist(session: OpenScreenHostSession) {
  session.updatedAt = Date.now();
  atomicJson(sessionFile(session.projectId, session.id), session);
  return session;
}
const unsavedHostSessions=new Map<string,OpenScreenHostSession>();
function persistFromCallback(session:OpenScreenHostSession){
  try{persist(session);unsavedHostSessions.delete(session.id)}catch(error){
    session.status='failed';session.error=`保存录制会话失败：${error instanceof Error?error.message:String(error)}`;
    unsavedHostSessions.set(session.id,session);
    if(unsavedHostSessions.size>200)unsavedHostSessions.delete(unsavedHostSessions.keys().next().value!);
  }
}

function sendRecordingState(state:NativeRecordingState) {
  try{if(process.connected)process.send?.({recordingControl:state},undefined,undefined,()=>{})}catch{/* disconnected desktop */}
}
const nativeRecorder = new NativeRecordingController({onStateError:sendRecordingState,async finalize(input){
  const raw=JSON.parse(fs.readFileSync(input.projectFile,'utf8'));
  const video=raw.media?.screenVideoPath??raw.assets?.[0]?.originalPath;
  if(typeof video!=='string'||!path.isAbsolute(video))throw Error('录制工程缺少本机视频路径；原始文件已保留。');
  const timed=correctNativeRecordingTime(video);
  const candidateRaw=structuredClone(raw);
  if(candidateRaw.media)candidateRaw.media.screenVideoPath=timed.video;
  else if(candidateRaw.assets?.[0])candidateRaw.assets[0].originalPath=timed.video;
  const probe=JSON.parse((await promisify(execFile)(ffprobePath(),['-v','error','-show_format','-show_streams','-of','json',timed.video],{windowsHide:true,timeout:30_000})).stdout);
  const stream=probe.streams?.find((s:any)=>s.codec_type==='video');
  const [numerator,denominator]=String(stream?.r_frame_rate||'0/1').split('/').map(Number);
  const document=recordingDocument(candidateRaw,{duration:Number(probe.format?.duration||stream?.duration),width:Number(stream?.width),height:Number(stream?.height),fps:numerator/denominator},
    {id:`proj_${input.id}`,title:`录制 ${input.sourceName}`,createdAt:new Date().toISOString()});
  atomicJson(managedCandidateFile({projectId:input.projectId,id:input.id}),document);
},onState(state) {
  const file = sessionFile(state.projectId, state.id);
  if (!fs.existsSync(file)) throw Error('录制会话文件不存在；原始录制文件保留。');
  const session = OpenScreenHostSessionSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if(session.projectId!==state.projectId||session.id!==state.id)throw Error('录制会话与当前工程不匹配，未改写其他工程。');
  session.recordingStartedAt = state.startedAt;
  session.status = ({starting:'launching', recording:'recording', stopping:'stopping', saved:'selecting', failed:'failed'} as const)[state.phase];
  session.error = state.error;
  if (state.phase === 'saved') {
    const candidate = candidateDocument(managedCandidateFile(session));
    if (candidate) {session.candidates=[candidateMetadata(managedCandidateFile(session), candidate)];session.candidateFiles=session.candidates.map(c=>c.file);}
    else {session.status='failed';session.error='录制已结束，但 OpenScreen 未生成可读取的工程；原始文件已保留。';}
  }
  persist(session);
  sendRecordingState({...state,phase:session.status === 'failed' ? 'failed' : state.phase,error:session.error});
}});

function managedProjectFile(session: Pick<OpenScreenHostSession,'projectId'|'id'>) {
  return path.join(sessionDir(session.projectId), `${session.id}.openscreen`);
}
function managedCandidateFile(session: Pick<OpenScreenHostSession,'projectId'|'id'>) {
  return path.join(sessionDir(session.projectId), `${session.id}.import.openscreen`);
}
export const nativeRecordingStatus = () => ({supported:process.platform === 'win32', active:nativeRecorder.state});
export const stopNativeRecording = (projectId:string, id:string) => nativeRecorder.stop(projectId,id);
if (typeof process.send === 'function') process.on('message', message => {
  const request = (message as {recordingStop?:{projectId?:string;id?:string}})?.recordingStop;
  if (!request || typeof request.projectId !== 'string' || typeof request.id !== 'string') return;
  try {nativeRecorder.stop(request.projectId,request.id)} catch { /* stale tray command must never stop another take */ }
});

const NativeRecordingRequest = z.object({
  sourceId:z.string().min(1), sourceType:z.enum(['window','display']),
  systemAudio:z.boolean().default(false), microphone:z.boolean().default(false),
  durationSeconds:z.number().int().min(0).max(3600).default(0),
});
export async function startNativeRecording(projectId:string, input:unknown) {
  if(process.platform !== 'win32') throw Error('此录制控制入口仅用于 Windows；请使用本机 OpenScreen 录制入口。');
  if(nativeRecorder.busy) throw Error('已有录制正在启动、录制或保存，请先停止并保存。');
  findProject(projectId,true);
  const executable=findOpenScreenExecutable();
  if(!executable) throw Error('未检测到用户安装的 OpenScreen，请安装后重试；现有工程已保留。');
  const captureHelper=windowsRecordingHelper();
  const request=NativeRecordingRequest.parse(input);
  const sources=await listOpenScreenSources();
  const source=sources.find(source=>source.id===request.sourceId && source.type===request.sourceType);
  if(!source) throw Error('选择的窗口或屏幕已不可用，请刷新来源后重新选择。');
  if(source.type==='window' && sources.filter(s=>s.type==='window' && s.name.toLowerCase().includes(source.name.toLowerCase())).length!==1)
    throw Error('存在同名或标题包含关系的窗口，无法唯一确定录制对象；请先区分窗口标题。');
  if(nativeRecorder.busy) throw Error('已有录制正在启动、录制或保存，请先停止并保存。');
  const now=Date.now();
  const session=OpenScreenHostSessionSchema.parse({id:crypto.randomUUID(),projectId,status:'launching',mode:'cli',
    createdAt:now,updatedAt:now,sourceName:source.name,durationSeconds:request.durationSeconds||undefined});
  persist(session);
  const args=[...openScreenProfileArgs(), 'record', '--json', '--cursor','editable-overlay', '--project', managedProjectFile(session),
    source.type==='window'?'--window':'--display',source.captureValue];
  if(request.durationSeconds) args.push('--duration',String(request.durationSeconds));
  if(request.systemAudio) args.push('--system-audio');
  if(request.microphone) args.push('--mic');
  nativeRecorder.start({projectId,id:session.id,sourceName:source.name,executable,args,env:{...process.env,OPENSCREEN_WGC_CAPTURE_EXE:captureHelper},
    projectFile:managedProjectFile(session),durationSeconds:session.durationSeconds,
    diagnosticFile:path.join(sessionDir(projectId),`${session.id}.diagnostic.json`)});
  return session;
}

function collectFiles(
  root: string,
  accept: (file: string, entry: fs.Dirent) => boolean,
  depth = 0,
): string[] {
  if (depth > 5 || !fs.existsSync(root)) return [];
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  const output: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isFile() && accept(full, entry)) output.push(full);
    if (entry.isDirectory() && !["node_modules", "Library", "Applications"].includes(entry.name))
      output.push(...collectFiles(full, accept, depth + 1));
  }
  return output;
}

/** Case aliases, symlinks and hard links can name one recording on macOS.
 * Keep the original path for display, but deduplicate by filesystem identity. */
export function uniqueRecordingFiles(files: string[]) {
  const seen = new Set<string>();
  return files.filter(file => {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return false;
      const key = stat.ino ? `${stat.dev}:${stat.ino}` : fs.realpathSync(file);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    } catch { return false; }
  });
}
function projectFiles() {
  return uniqueRecordingFiles(PROJECT_ROOTS.flatMap(root => collectFiles(
    root, (_file, entry) => entry.name.toLowerCase().endsWith(".openscreen"),
  )));
}
function recordingFiles() {
  return uniqueRecordingFiles(RECORDING_ROOTS.flatMap(root => collectFiles(
    root, (_file, entry) => /\.(?:mp4|mov|m4v|webm|mkv|json)$/i.test(entry.name),
  )));
}

function fingerprint(file: string) {
  try {
    const stat = fs.statSync(file);
    return `${Math.round(stat.mtimeMs)}:${stat.size}`;
  } catch { return ""; }
}

function snapshot(files: string[]) {
  return Object.fromEntries(files.map((file) => [path.resolve(file), fingerprint(file)]));
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function documentDuration(document: JsonObject) {
  const timeline = asObject(document.timeline);
  const clips = Array.isArray(timeline?.clips) ? timeline.clips : [];
  return clips.reduce((maximum, value) => {
    const end = Number(asObject(value)?.timelineEndSec);
    return Number.isFinite(end) ? Math.max(maximum, end) : maximum;
  }, 0);
}

function candidateDocument(file: string): JsonObject | undefined {
  try {
    const document = asObject(JSON.parse(fs.readFileSync(file, "utf8")));
    const timeline = asObject(document?.timeline);
    if (!document || !asObject(document.project) || !timeline
      || !Array.isArray(document.assets) || !Array.isArray(timeline.clips)) return undefined;
    return document;
  } catch { return undefined; }
}

function documentSourcePaths(document: JsonObject) {
  const output: string[] = [];
  for (const value of Array.isArray(document.assets) ? document.assets : []) {
    const asset = asObject(value);
    if (!asset) continue;
    if (typeof asset.originalPath === "string" && path.isAbsolute(asset.originalPath))
      output.push(path.resolve(asset.originalPath));
    const camera = asObject(asset.cameraTrack);
    if (typeof camera?.sourcePath === "string" && path.isAbsolute(camera.sourcePath))
      output.push(path.resolve(camera.sourcePath));
  }
  return output;
}

function projectCreatedAt(document: JsonObject) {
  const value = asObject(document.project)?.createdAt;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function candidateMetadata(file: string, document: JsonObject): OpenScreenHostCandidate {
  const project = asObject(document.project) || {};
  const stat = fs.statSync(file);
  return OpenScreenHostCandidateSchema.parse({
    file,
    title: String(project.title || path.basename(file, ".openscreen")),
    upstreamProjectId: String(project.id || "") || undefined,
    schemaVersion: Number.isInteger(Number(document.schemaVersion)) ? Number(document.schemaVersion) : undefined,
    duration: documentDuration(document),
    sourceCount: Array.isArray(document.assets) ? document.assets.length : 0,
    sizeBytes: stat.size,
    updatedAt: stat.mtimeMs,
  });
}

function sessionCandidates(session: OpenScreenHostSession) {
  return projectFiles().flatMap((file) => {
    const resolved = path.resolve(file);
    if (session.baselineFingerprints[resolved] === fingerprint(resolved)) return [];
    const document = candidateDocument(resolved);
    if (!document) return [];
    const hasNewSource = documentSourcePaths(document).some((source) =>
      session.baselineFingerprints[source] !== fingerprint(source));
    const isNewProject = projectCreatedAt(document) >= session.createdAt - 5_000;
    return hasNewSource || isNewProject ? [candidateMetadata(resolved, document)] : [];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

function updateActivityStatus(session: OpenScreenHostSession) {
  const now = Date.now();
  const artifacts = recordingFiles().filter((file) => {
    const resolved = path.resolve(file);
    return session.baselineFingerprints[resolved] !== fingerprint(resolved);
  });
  const current = snapshot(artifacts);
  const changed = Object.entries(current).some(([file, value]) => session.observedArtifacts[file] !== value);
  if (artifacts.length && changed) {
    session.status = "recording";
    session.lastActivityAt = now;
  } else if (artifacts.length && (session.lastActivityAt || 0) < now - 2_500) {
    session.status = "processing";
  } else if (!artifacts.length && session.status !== "launching") {
    session.status = "waiting";
  }
  session.observedArtifacts = current;
}

export function launchOpenScreenHud(projectId: string): OpenScreenHostSession {
  findProject(projectId, true);
  const executable = findOpenScreenExecutable();
  if (!executable) throw new Error("未检测到用户安装的 OpenScreen，请安装后重试录制；现有工程已保留。");
  const now = Date.now();
  const session = OpenScreenHostSessionSchema.parse({
    id: crypto.randomUUID(), projectId, status: "launching", mode: "native-hud",
    createdAt: now, updatedAt: now, candidateFiles: [], candidates: [],
    baselineFingerprints: snapshot([...projectFiles(), ...recordingFiles()]),
    observedArtifacts: {},
  });
  persist(session);
  const app = process.platform === "darwin" ? appBundleForExecutable(executable) : undefined;
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(app ? "/usr/bin/open" : executable, app ? [...(profile ? ["-n"] : []), "-a", app, ... (profile ? ["--args", ...openScreenProfileArgs()] : [])] : openScreenProfileArgs(), { env, detached: true, stdio: "ignore" });
  child.once("close", (code) => {if(code && !["completed","cancelled"].includes(session.status)){session.status="failed";session.error=`OpenScreen 启动失败（${code}），请检查本机安装。`;persistFromCallback(session)}});
  child.once("error", (error) => {
    session.status = "failed";
    session.error = error.message;
    persistFromCallback(session);
  });
  child.once("spawn", () => {
    session.status = "waiting";
    persistFromCallback(session);
    child.unref();
  });
  return session;
}

export function readOpenScreenHostSession(projectId: string, sessionId: string) {
  const file = sessionFile(projectId, sessionId);
  const failed=unsavedHostSessions.get(sessionId);if(failed?.projectId===projectId)return {...failed};
  if (!fs.existsSync(file)) throw new Error("原生录制会话不存在");
  const session = OpenScreenHostSessionSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  if(session.projectId!==projectId||session.id!==sessionId)throw Error('录制会话不属于当前工程，未操作其他工程。');
  if(session.mode==='cli') {
    if(['launching','recording','stopping','processing'].includes(session.status)
      && (!nativeRecorder.busy || nativeRecorder.state?.id!==session.id)) {
      const document=candidateDocument(managedCandidateFile(session));
      if(document){session.candidates=[candidateMetadata(managedCandidateFile(session),document)];session.candidateFiles=session.candidates.map(c=>c.file);session.status='selecting';}
      else{session.status='failed';session.error='录制控制服务已重启；原始录制文件保留，请检查后重新录制。';}
      persist(session);
    }
    return session;
  }
  if (["waiting", "recording", "processing", "selecting"].includes(session.status)) {
    session.candidates = sessionCandidates(session);
    session.candidateFiles = session.candidates.map((candidate) => candidate.file);
    if (session.candidates.length) session.status = "selecting";
    else updateActivityStatus(session);
    persist(session);
  }
  return session;
}

export function listOpenScreenHostSessions(projectId: string) {
  const dir = sessionDir(projectId);
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try {
        return [OpenScreenHostSessionSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))];
      } catch { return []; }
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function cancelOpenScreenHostSession(projectId: string, sessionId: string) {
  const session = readOpenScreenHostSession(projectId, sessionId);
  if(session.mode==='cli' && ['launching','recording','stopping'].includes(session.status))
    throw Error('录制仍在进行，请先停止并保存，不能只停止接收。');
  if (!["completed", "failed"].includes(session.status)) session.status = "cancelled";
  return persist(session);
}

function extensionFor(file: string, fallback = ".mp4") {
  const extension = path.extname(file).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : fallback;
}

function mimeType(file: string) {
  const extension = extensionFor(file);
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mkv") return "video/x-matroska";
  return "video/mp4";
}

function uniqueAssetId(project: Pick<EditProject, "media">, preferred: string) {
  if (preferred && !project.media.some((asset) => asset.id === preferred)) return preferred;
  return `os_${crypto.randomUUID()}`;
}

function replaceExactStrings(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === "string") return replacements.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => replaceExactStrings(item, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject).map(([key, child]) => [
    key,
    replaceExactStrings(child, replacements),
  ]));
}

function rootMediaUrl(projectId: string, assetId: string, kind = "original") {
  return `/api/editor/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/file?kind=${kind}`;
}

async function materializeCandidate(projectId: string, selected: string, raw: JsonObject) {
  const found = findProject(projectId, true);
  const document = structuredClone(raw) as JsonObject;
  const documentProject = asObject(document.project);
  if (!documentProject) throw new Error("OpenScreen 录制工程缺少 project");
  let documentId = String(documentProject.id || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(documentId)
    || found.project.openScreenDocuments.some((item) => item.id === documentId)) {
    documentId = `lr_${crypto.randomUUID()}`;
    documentProject.id = documentId;
  }

  const originals = path.join(found.dir, "media", "originals");
  const documentDir = path.join(found.dir, "analysis", "openscreen", documentId);
  const cursorDir = path.join(documentDir, "cursor");
  fs.mkdirSync(originals, { recursive: true });
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.copyFileSync(selected, path.join(documentDir, "native-source.openscreen"));

  const replacements = new Map<string, string>();
  const newMedia: MediaAsset[] = [];
  for (const value of Array.isArray(document.assets) ? document.assets : []) {
    const asset = asObject(value);
    const source = typeof asset?.originalPath === "string" ? asset.originalPath : "";
    if (!asset || !source || !path.isAbsolute(source) || !fs.existsSync(source)) continue;
    const oldId = String(asset.id || "");
    const assetId = uniqueAssetId({ media: [...found.project.media, ...newMedia] }, oldId);
    if (assetId !== oldId) replacements.set(oldId, assetId);
    asset.id = assetId;
    const targetRel = `media/originals/${assetId}${extensionFor(source)}`;
    fs.copyFileSync(source, path.join(found.dir, targetRel));
    const cursorSource = `${source}.cursor.json`;
    let cursorDataFile: string | undefined;
    if (fs.existsSync(cursorSource)) {
      cursorDataFile = `analysis/openscreen/${documentId}/cursor/${assetId}.cursor.json`;
      fs.copyFileSync(cursorSource, path.join(found.dir, cursorDataFile));
    }
    asset.originalPath = rootMediaUrl(projectId, assetId);
    const video = asObject(asset.video);
    const media: MediaAsset = {
      id: assetId,
      name: String(asset.label || path.basename(source)),
      type: "video",
      mimeType: mimeType(source),
      originalFile: targetRel,
      duration: Math.max(0, Number(asset.durationSec) || 0),
      width: Math.max(0, Number(video?.width) || 0) || undefined,
      height: Math.max(0, Number(video?.height) || 0) || undefined,
      fps: Math.max(0, Number(video?.fps) || 0) || undefined,
      size: fs.statSync(path.join(found.dir, targetRel)).size,
      createdAt: Date.now(),
      status: "processing",
      origin: "screen-recording",
      parentAssetIds: [],
      openScreenDocumentId: documentId,
      capture: {
        engine: "openscreen",
        sourceType: "display",
        sourceName: String(asset.label || "OpenScreen 屏幕录制"),
        cursorDataFile,
        openscreenProjectFile: `analysis/openscreen/${documentId}/project.openscreen`,
        recordedAt: Date.now(),
      },
    };
    newMedia.push(media);

    const camera = asObject(asset.cameraTrack);
    const cameraSource = typeof camera?.sourcePath === "string" ? camera.sourcePath : "";
    if (camera && cameraSource && path.isAbsolute(cameraSource) && fs.existsSync(cameraSource)) {
      const cameraId = uniqueAssetId({ media: [...found.project.media, ...newMedia] }, "");
      const cameraRel = `media/originals/${cameraId}${extensionFor(cameraSource)}`;
      fs.copyFileSync(cameraSource, path.join(found.dir, cameraRel));
      camera.sourcePath = rootMediaUrl(projectId, cameraId);
      newMedia.push({
        id: cameraId,
        name: `${media.name} · 摄像头`,
        type: "video",
        mimeType: mimeType(cameraSource),
        originalFile: cameraRel,
        duration: media.duration,
        size: fs.statSync(path.join(found.dir, cameraRel)).size,
        createdAt: Date.now(),
        status: "processing",
        origin: "screen-recording",
        parentAssetIds: [],
        openScreenDocumentId: documentId,
        capture: {
          engine: "openscreen",
          sourceType: "window",
          sourceName: "OpenScreen 摄像头",
          openscreenProjectFile: `analysis/openscreen/${documentId}/project.openscreen`,
          recordedAt: Date.now(),
        },
      });
    }
  }

  const rewritten = replaceExactStrings(document, replacements) as JsonObject;
  found.project.media.push(...newMedia);
  found.project.revision++;
  save(found.dir, found.project);
  for (const media of newMedia) await processMedia(projectId, media.id, { addToTimeline: false });
  return { document: rewritten, documentId };
}

export async function importOpenScreenHostCandidate(
  projectId: string,
  sessionId: string,
  selectedFile: unknown,
) {
  const session = readOpenScreenHostSession(projectId, sessionId);
  const selected = path.resolve(String(selectedFile || ""));
  if (!session.candidates.some((item) => path.resolve(item.file) === selected))
    throw new Error("录制结果不属于当前接收会话");
  const raw = candidateDocument(selected);
  if (!raw) throw new Error("OpenScreen 录制工程无法读取");
  session.status = "processing";
  persist(session);
  try {
    const materialized = await materializeCandidate(projectId, selected, raw);
    const imported = createOpenScreenDocument(projectId, {
      document: materialized.document,
      documentId: materialized.documentId,
    });
    session.status = "completed";
    session.selectedFile = selected;
    session.documentId = imported.ref.id;
    persist(session);
    return { session, document: imported };
  } catch (error) {
    session.status = "failed";
    session.error = error instanceof Error ? error.message : String(error);
    persistFromCallback(session);
    throw error;
  }
}
