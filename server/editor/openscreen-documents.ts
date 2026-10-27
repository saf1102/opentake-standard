import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OpenScreenDocumentRef } from "../../src/types/editor.ts";
import {
  OpenScreenCompoundParamsSchema,
  OpenScreenDocumentRefSchema,
} from "../../src/types/editor.ts";
import { atomicJson, findProject, save } from "./store.ts";
type JsonObject = Record<string, unknown>;

function safeId(value: unknown): string {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id)) throw new Error("OpenScreen 文档 ID 无效");
  return id;
}

function asObject(value: unknown, message: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as JsonObject;
}

function validateDocument(value: unknown): JsonObject {
  const document = asObject(value, "OpenScreen 文档必须是对象");
  const schemaVersion = Number(document.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1)
    throw new Error("OpenScreen 文档缺少有效 schemaVersion");
  const project = asObject(document.project, "OpenScreen 文档缺少 project");
  if (!String(project.id || "").trim() || !String(project.title || "").trim())
    throw new Error("OpenScreen 文档缺少工程标识或标题");
  const timeline = asObject(document.timeline, "OpenScreen 文档缺少 timeline");
  if (!Array.isArray(timeline.clips)) throw new Error("OpenScreen 时间线 clips 无效");
  if (!Array.isArray(document.assets)) throw new Error("OpenScreen 素材列表无效");
  return document;
}

function documentDuration(document: JsonObject): number {
  const timeline = asObject(document.timeline, "OpenScreen 文档缺少 timeline");
  const clips = Array.isArray(timeline.clips) ? timeline.clips : [];
  return clips.reduce((maximum, value) => {
    if (!value || typeof value !== "object") return maximum;
    const clip = value as JsonObject;
    const end = Number(clip.timelineEndSec);
    return Number.isFinite(end) ? Math.max(maximum, end) : maximum;
  }, 0);
}

function sourceAssetIds(document: JsonObject): string[] {
  const assets = Array.isArray(document.assets) ? document.assets : [];
  const ids = assets
    .map((value) => value && typeof value === "object" ? String((value as JsonObject).id || "") : "")
    .filter(Boolean);
  return [...new Set(ids)];
}

function compoundDocumentId(params: Record<string, unknown>): string | undefined {
  const parsed = OpenScreenCompoundParamsSchema.safeParse(params);
  return parsed.success ? parsed.data.documentId : undefined;
}

function titleOf(document: JsonObject): string {
  return String(asObject(document.project, "OpenScreen 文档缺少 project").title || "OpenScreen 录屏");
}

function documentRoot(projectDir: string, documentId: string) {
  return path.join(projectDir, "analysis", "openscreen", safeId(documentId));
}

function projectPath(projectDir: string, documentId: string) {
  return path.join(documentRoot(projectDir, documentId), "project.openscreen");
}

function metadataPath(projectDir: string, documentId: string) {
  return path.join(documentRoot(projectDir, documentId), "document.json");
}

function writeDocumentFile(file: string, document: JsonObject) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(document, null, 2));
  fs.renameSync(temp, file);
}

function updateRef(
  projectId: string,
  documentId: string,
  document: JsonObject,
  revision: number,
  createdAt = Date.now(),
): OpenScreenDocumentRef {
  const { dir, project } = findProject(projectId, true);
  const current = project.openScreenDocuments.find((item) => item.id === documentId);
  const now = Date.now();
  const documentAssetIds = sourceAssetIds(document);
  const previewAssetId = current?.previewAssetId
    || documentAssetIds.find((assetId) => project.media.some((asset) => asset.id === assetId));
  const ref = OpenScreenDocumentRefSchema.parse({
    id: documentId,
    schemaVersion: Number(document.schemaVersion),
    relativePath: `analysis/openscreen/${documentId}/project.openscreen`,
    title: titleOf(document),
    duration: documentDuration(document),
    sourceAssetIds: documentAssetIds,
    previewAssetId,
    publishedAssetIds: current?.publishedAssetIds || [],
    latestPublishedAssetId: current?.latestPublishedAssetId,
    lastPublishedAt: current?.lastPublishedAt,
    revision,
    createdAt: current?.createdAt || createdAt,
    updatedAt: now,
  });
  project.openScreenDocuments = [
    ...project.openScreenDocuments.filter((item) => item.id !== documentId),
    ref,
  ];

  // OpenScreen documents are recording subprojects, not live clips in the
  // main edit. Only an explicit publish produces a main-editor media asset.
  for (const track of project.timeline.tracks.filter((item) => item.kind === "openscreen")) {
    track.clips = track.clips.filter((clip) => compoundDocumentId(clip.params) !== ref.id);
  }
  // The OpenScreen document carries its own revision. Do not invalidate a
  // simultaneous main-editor timeline save for an unrelated subproject edit.
  save(dir, project);
  atomicJson(metadataPath(dir, documentId), ref);
  return ref;
}

export function listOpenScreenDocuments(projectId: string): OpenScreenDocumentRef[] {
  const { project } = findProject(projectId, true);
  return project.openScreenDocuments
    .filter((item) => !item.archivedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readOpenScreenDocument(projectId: string, documentId: string) {
  const { dir, project } = findProject(projectId, true);
  const ref = project.openScreenDocuments.find((item) => item.id === safeId(documentId));
  if (!ref || ref.archivedAt) throw new Error("OpenScreen 文档不存在");
  const stored = validateDocument(JSON.parse(fs.readFileSync(projectPath(dir, ref.id), "utf8")));
  const document = structuredClone(stored);
  // Browser embedding must serve project-owned sources through the media API.
  for(const value of document.assets as JsonObject[]){const asset=project.media.find(a=>a.id===value.id);if(asset)value.originalPath=`/api/editor/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(asset.id)}/file?kind=original`;}

  return { ref, document, revision: ref.revision };
}

export function createOpenScreenDocument(projectId: string, input: {
  document: unknown;
  documentId?: unknown;
}) {
  const { dir } = findProject(projectId, true);
  const document = validateDocument(input.document);
  const upstreamId = String(asObject(document.project, "OpenScreen 文档缺少 project").id || "");
  const documentId = safeId(input.documentId || upstreamId || crypto.randomUUID());
  if (fs.existsSync(projectPath(dir, documentId))) throw new Error("OpenScreen 文档已存在");
  for (const rel of ["backups", "cursor", "transcript"])
    fs.mkdirSync(path.join(documentRoot(dir, documentId), rel), { recursive: true });
  writeDocumentFile(projectPath(dir, documentId), document);
  const ref = updateRef(projectId, documentId, document, 0);
  return { ref, document, revision: 0 };
}

export function saveOpenScreenDocument(projectId: string, documentId: string, input: {
  document: unknown;
  revision: unknown;
}) {
  const { dir } = findProject(projectId, true);
  const current = readOpenScreenDocument(projectId, documentId);
  const expected = Number(input.revision);
  if (!Number.isInteger(expected) || expected !== current.revision) {
    const error = new Error("OpenScreen 文档已在其他位置更新");
    Object.assign(error, { code: "REVISION_CONFLICT", current });
    throw error;
  }
  const document = validateDocument(input.document);
  const backups = path.join(documentRoot(dir, documentId), "backups");
  fs.mkdirSync(backups, { recursive: true });
  fs.copyFileSync(projectPath(dir, documentId), path.join(backups, `revision-${current.revision}.openscreen`));
  writeDocumentFile(projectPath(dir, documentId), document);
  const revision = current.revision + 1;
  const ref = updateRef(projectId, documentId, document, revision, current.ref.createdAt);
  return { ref, document, revision };
}

export function duplicateOpenScreenDocument(projectId: string, documentId: string) {
  const current = readOpenScreenDocument(projectId, documentId);
  const document = structuredClone(current.document);
  const id = crypto.randomUUID();
  const project = asObject(document.project, "OpenScreen 文档缺少 project");
  project.id = id;
  project.title = `${String(project.title)} 副本`;
  project.createdAt = new Date().toISOString();
  project.updatedAt = project.createdAt;
  return createOpenScreenDocument(projectId, { document, documentId: id });
}

export function archiveOpenScreenDocument(projectId: string, documentId: string) {
  const { dir, project } = findProject(projectId, true);
  const current = project.openScreenDocuments.find((item) => item.id === safeId(documentId));
  if (!current) throw new Error("OpenScreen 文档不存在");
  current.archivedAt = Date.now();
  current.updatedAt = Date.now();
  for (const track of project.timeline.tracks.filter((item) => item.kind === "openscreen")) {
    track.clips = track.clips.filter((clip) => compoundDocumentId(clip.params) !== current.id);
  }
  project.revision++;
  save(dir, project);
  atomicJson(metadataPath(dir, documentId), current);
  return current;
}

