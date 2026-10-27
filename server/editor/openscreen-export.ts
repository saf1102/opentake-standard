import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EditProject, OpenScreenExportJob } from "../../src/types/editor.ts";
import { OpenScreenExportJobSchema } from "../../src/types/editor.ts";
import { findOpenScreenExecutable } from "./openscreen.ts";
import { readOpenScreenDocument } from "./openscreen-documents.ts";
import { atomicJson, findProject } from "./store.ts";

type JsonObject = Record<string, unknown>;
type LiveExport = { child: ChildProcess; startedAt: number };

const live = new Map<string, LiveExport>();
export const activeOpenScreenExports = () => live.size;

/** Run the user's installed OpenScreen as a separate process. Its own Electron,
 * native compositor and FFmpeg stay together; never load its .node addon into
 * Standard's Electron or silently substitute OpenTake's renderer. */
export function resolveOpenScreenExportRunner(_document: unknown, lookup?: import("./openscreen.ts").OpenScreenLookup) {
  const executable = findOpenScreenExecutable(lookup);
  if (!executable) throw new Error("未检测到用户安装的 OpenScreen，暂不能录制或导出。请先安装支持当前 v7 工程及 export 命令的 OpenScreen，再重试；现有工程已保留。");
  const env = {...process.env};
  // The embedded Standard service can run in Electron's Node mode. Do not
  // propagate that mode to the independently installed GUI/export application.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.OPENSCREEN_COMPOSITOR_VIEW_NODE;
  return {executable, argsPrefix: ["export"], env, cwd: path.dirname(executable), kind: "installed-native" as const};
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
  return job;
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
    if (parsed.protocol === "file:") return decodeURIComponent(parsed.pathname);
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
  if (codec !== undefined && codec !== "h264") throw new Error("当前 OpenScreen CLI 仅支持 H.264，请选择 H.264 后导出");
  return ["--fps", String(rate)];
}

export function stageEditorSettings(document: unknown, snapshot: unknown, root = process.cwd()) {
  const staged = structuredClone(document) as JsonObject;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    staged.legacyEditor = {...(staged.legacyEditor as JsonObject || {}), ...(snapshot as JsonObject)};
  }
  const editor = staged.legacyEditor as JsonObject | null;
  if (editor && typeof editor.wallpaper === "string" && /^\/wallpapers\/wallpaper\d+\.jpg$/.test(editor.wallpaper)) {
    const file = path.join(root, "public/openscreen", editor.wallpaper.slice(1));
    if (!fs.existsSync(file)) throw new Error("录屏背景资源缺失，不能导出不同的背景");
    editor.wallpaper = file;
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
}) {
  const found = findProject(projectId, true);
  const current = readOpenScreenDocument(projectId, documentId);
  const runner = resolveOpenScreenExportRunner(current.document);
  const purpose = "export";
  const format = input.format === "gif" ? "gif" : "mp4";
  const mp4Args = format === "mp4" ? mp4ExportArguments(input.mp4Fps, input.codec) : [];
  const target = input.outPath
    ? assertWithinExports(found.dir, input.outPath)
    : createOpenScreenExportTarget(projectId, documentId, {
        suggested: `${current.ref.title}.${format}`,
        format,
      }).path;
  if (path.extname(target).toLowerCase() !== `.${format}`)
    throw new Error(`导出文件扩展名必须为 .${format}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const id = crypto.randomUUID();
  const now = Date.now();
  const job = OpenScreenExportJobSchema.parse({
    id,
    projectId,
    documentId,
    status: "queued",
    format,
    purpose,
    quality: qualityOf(input.quality),
    progress: 0,
    totalFrames: Number.isInteger(Number(input.totalFrames)) && Number(input.totalFrames) > 0
      ? Number(input.totalFrames)
      : undefined,
    outputFile: target,
    createdAt: now,
    updatedAt: now,
  });
  persist(job);

  const stagingDir = path.join(exportJobsDir(found.dir, documentId), `.staging-${id}`);
  fs.mkdirSync(stagingDir, { recursive: true });
  const stagedDocument = localizeDocument(
    stageEditorSettings(current.document, input.exportEditor),
    found.dir,
    found.project,
    path.dirname(path.join(found.dir, current.ref.relativePath)),
  );
  const stagedProject = path.join(stagingDir, "project.openscreen");
  fs.writeFileSync(stagedProject, JSON.stringify(stagedDocument, null, 2));

  const args = [
    ...runner.argsPrefix,
    stagedProject,
    "-o",
    target,
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

  const child = spawn(runner.executable, args, {
    cwd: runner.cwd,
    env: runner.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  live.set(id, { child, startedAt: Date.now() });
  job.status = "running";
  job.startedAt = Date.now();
  job.progress = 1;
  persist(job);

  const stdout = { pending: "" };
  const diagnostics: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => readJsonLines(String(chunk), stdout, (event) => {
    inferProgress(event, job);
    if (event.error || event.message || event.type === "error") {
      diagnostics.push(JSON.stringify(event));
      if (diagnostics.length > 40) diagnostics.shift();
    }
    persist(job);
  }));
  child.stderr.on("data", (chunk) => {
    stderr.push(String(chunk));
    if (stderr.length > 80) stderr.shift();
  });
  child.once("error", (error) => {
    live.delete(id);
    job.status = "failed";
    job.error = error.message;
    persist(job);
  });
  child.once("close", (code, signal) => {
    live.delete(id);
    if (job.status === "cancelled") {
      persist(job);
      return;
    }
    if (code === 0 && fs.existsSync(target) && fs.statSync(target).size > 0) {
      try {
        job.status = "completed";
        job.progress = 100;
        job.completedAt = Date.now();
        job.wallS = job.wallS ?? Math.max(0, (job.completedAt - (job.startedAt || job.createdAt)) / 1000);
      } catch (error) {
        job.status = "failed";
        job.error = `成片已生成，但登记到剪辑台失败：${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      job.status = "failed";
      job.error = stderr.join("").trim().slice(-4_000)
        || diagnostics.join("\n").trim().slice(-4_000)
        || `OpenScreen 导出退出（${code ?? "未知"}${signal ? `，${signal}` : ""}）`;
    }
    persist(job);
    fs.rmSync(stagingDir, { recursive: true, force: true });
  });

  return job;
}

export function readOpenScreenExport(projectId: string, documentId: string, jobId: string) {
  const { dir } = findProject(projectId, true);
  const file = jobFile(dir, documentId, jobId);
  if (!fs.existsSync(file)) throw new Error("OpenScreen 导出任务不存在");
  const job = OpenScreenExportJobSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  if ((job.status === "queued" || job.status === "running") && !live.has(job.id)) {
    job.status = "interrupted";
    job.error = "LinkReader 服务重启导致导出中断，可以重新发起导出。";
    persist(job);
  }
  return job;
}

export function cancelOpenScreenExport(projectId: string, documentId: string, jobId: string) {
  const job = readOpenScreenExport(projectId, documentId, jobId);
  if (job.status !== "running" && job.status !== "queued") return job;
  job.status = "cancelled";
  job.completedAt = Date.now();
  live.get(job.id)?.child.kill("SIGTERM");
  persist(job);
  return job;
}

export function revealOpenScreenExport(projectId: string, value: unknown) {
  const { dir } = findProject(projectId, true);
  const target = assertWithinExports(dir, value);
  if (!fs.existsSync(target)) throw new Error("导出文件不存在");
  const child = spawn("/usr/bin/open", ["-R", target], { detached: true, stdio: "ignore" });
  child.unref();
  return { path: target };
}
