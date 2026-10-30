import { installBridgeEdition } from "./bridge-edition";
import { compatibleOpenScreenDocument } from "../../../../shared/openscreen-compat";
import { prepareSavedScreenExport } from "../../../../shared/openscreen-export-request";
import { collectEffectiveClipDims, pickExtremeDims, resolveAspectRatioValue } from "../lib/ai-edition/document/outputFormat";
import { calculateMp4ExportSettings } from "../lib/exporter/mp4ExportSettings";
import {
	type AxcutTimelineOperation,
	applyTimelineOperation,
} from "../lib/ai-edition/document/operations";
import { type AxcutDocument, createEmptyDocument, documentSchema } from "../lib/ai-edition/schema";
import { getEditorSettings, patchEditorSettings } from "../lib/ai-edition/store/editorSettings";
import { nativeBridgeClient } from "../native/client";

type JsonObject = Record<string, unknown>;
type LinkReaderClip = {
	id: string;
	assetId?: string;
	name: string;
	start: number;
	duration: number;
	sourceStart?: number;
	sourceDuration?: number;
};
type LinkReaderAsset = {
	id: string;
	name: string;
	type: "video" | "audio" | "image";
	duration: number;
	width?: number;
	height?: number;
	fps?: number;
	size?: number;
	origin?: "imported" | "screen-recording" | "openscreen-published";
	openScreenDocumentId?: string;
	publicationVersion?: number;
	capture?: Record<string, unknown>;
};
type LinkReaderProject = {
	id: string;
	name: string;
	media: LinkReaderAsset[];
	timeline: { tracks: Array<{ kind: string; clips: LinkReaderClip[] }> };
	openScreenDocuments?: DocumentRef[];
};
type DocumentRef = {
	id: string;
	title: string;
	updatedAt: number;
	sourceAssetIds: string[];
	duration: number;
	revision: number;
	publishedAssetIds: string[];
	latestPublishedAssetId?: string;
	lastPublishedAt?: number;
	archivedAt?: number;
};
export type DocumentEnvelope = { ref: DocumentRef; document: AxcutDocument; revision: number };
type CodexOperation =
	| { kind: "timeline"; operation: AxcutTimelineOperation; summary: string }
	| {
			kind: "zoom.add";
			summary: string;
			range: {
				id: string;
				startMs: number;
				endMs: number;
				clipId?: string;
				sourceStartSec?: number;
				sourceEndSec?: number;
				depth: 1 | 2 | 3 | 4 | 5 | 6;
				focus: { cx: number; cy: number };
				focusMode?: "manual" | "auto";
				rotationPreset?: "iso" | "left" | "right";
				customScale?: number;
				source?: "manual" | "auto";
			};
	  }
	| { kind: "zoom.remove"; id: string; summary: string }
	| {
			kind: "annotation.text.add";
			summary: string;
			annotation: {
				id: string;
				startMs: number;
				endMs: number;
				clipId?: string;
				sourceStartSec?: number;
				sourceEndSec?: number;
				text: string;
				position: { x: number; y: number };
				size: { width: number; height: number };
				zIndex?: number;
			};
	  }
	| { kind: "annotation.remove"; id: string; summary: string }
	| {
			kind: "speed.add";
			summary: string;
			range: {
				id: string;
				startMs: number;
				endMs: number;
				speed: number;
				clipId?: string;
				sourceStartSec?: number;
				sourceEndSec?: number;
			};
	  }
	| { kind: "speed.remove"; id: string; summary: string }
	| {
			kind: "composition.set";
			summary: string;
			values: {
				aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
				padding?: number;
				borderRadius?: number;
				shadow?: number;
				backgroundColor?: string;
			};
	  };

type CodexRunResult = {
	success: boolean;
	assistantMessage?: {
		id: string;
		role: "assistant";
		content: string;
		createdAt: string;
		toolCalls?: Array<{ name: string; summary: string }>;
	};
	operations: CodexOperation[];
	toolCalls?: Array<{ name: string; summary: string }>;
	userMessageCheckpointId?: string;
};

export type OpenScreenExportJob = {
	id: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
	format: "mp4" | "gif";
	progress: number;
	currentFrame?: number;
	totalFrames?: number;
	outputFile: string;
	purpose?: "export" | "publish";
	publishedAssetId?: string;
	videoDurationS?: number;
	wallS?: number;
	error?: string;
};

export type BridgeEditionContext = {
  electron: Record<string, any>;
  projectId: string;
  clientId: string;
  writable: boolean;
  getActiveDocumentId: () => string;
  api: <T>(url: string, init?: RequestInit) => Promise<T>;
  bridgeMessage: (type: string, payload?: Record<string, unknown>) => void;
  readDocument: (id: string) => Promise<DocumentEnvelope>;
  exportBase: (id: string) => string;
  sleep: (ms: number) => Promise<unknown>;
};

const query = new URLSearchParams(location.search);
const projectId = query.get("linkreaderProjectId") || "";
const clientId = query.get("linkreaderClientId") || "";
const writable = query.get("linkreaderWritable") === "1";
const revisions = new Map<string, number>();
const savedDocuments = new Map<string, string>();
let activeDocumentId = "";
const nativeExportProgressListeners = new Set<(frames: number) => void>();

function bridgeMessage(type: string, payload: JsonObject = {}) {
	window.parent.postMessage(
		{
			version: 1,
			id: crypto.randomUUID(),
			type,
			projectId,
			documentId: typeof payload.documentId === "string" ? payload.documentId : undefined,
			payload,
			timestamp: Date.now(),
		},
		location.origin,
	);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { cache: "no-store", ...init });
	const data = (await response.json()) as { ok: boolean; result?: T; error?: string };
	if (!response.ok || !data.ok || data.result === undefined) {
		throw Object.assign(new Error(data.error || `LinkReader 请求失败（${response.status}）`), { status: response.status });
	}
	return data.result;
}

function mediaUrl(assetId: string, kind: "proxy" | "original" | "waveform" | "cursor" = "proxy") {
	return `${location.origin}/api/editor/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/file?kind=${kind}`;
}

const LINKREADER_MEDIA_PATH_KEYS = new Set([
	"originalPath",
	"proxyPath",
	"waveformPath",
	"sourcePath",
]);

/**
 * Projects may be opened through localhost, a new DHCP address, or another LAN
 * hostname. OpenScreen documents therefore cannot trust the origin that was
 * persisted by the previous browser. Rebase only LinkReader-owned media URLs;
 * native file paths, blob URLs and user URLs remain untouched.
 */
function rebaseLinkReaderMediaUrls(value: unknown, key = ""): unknown {
	if (typeof value === "string" && LINKREADER_MEDIA_PATH_KEYS.has(key)) {
		try {
			const parsed = new URL(value, location.origin);
			if (/^\/api\/editor\/projects\/[^/]+\/media\/[^/]+\/file$/.test(parsed.pathname)) {
				return `${location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
			}
		} catch {
			return value;
		}
		return value;
	}
	if (Array.isArray(value)) return value.map((entry) => rebaseLinkReaderMediaUrls(entry, key));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([childKey, child]) => [
				childKey,
				rebaseLinkReaderMediaUrls(child, childKey),
			]),
		);
	}
	return value;
}

function normalizeDocument(value: unknown): AxcutDocument {
	return documentSchema.parse(compatibleOpenScreenDocument(rebaseLinkReaderMediaUrls(value)));
}

function documentFingerprint(document: AxcutDocument) {
  const value=normalizeDocument(document);
  // 更新时间不是编辑内容；撤销回原样、导出保存后再开也不应重复写入。
  return JSON.stringify({...value,project:{...value.project,updatedAt:undefined}});
}

function assetIdFromMediaPath(value?: string) {
	if (!value) return "";
	try {
		const parsed = new URL(value, location.origin);
		const match = parsed.pathname.match(/\/api\/editor\/projects\/[^/]+\/media\/([^/]+)\/file$/);
		return match ? decodeURIComponent(match[1]) : "";
	} catch {
		return "";
	}
}

async function cursorRecordingData(videoPath?: string) {
	const assetId = assetIdFromMediaPath(videoPath);
	if (!assetId) return { version: 2, provider: "none", samples: [], assets: [] };
	const response = await fetch(mediaUrl(assetId, "cursor"), { cache: "no-store" });
	if (response.status === 404) return { version: 2, provider: "none", samples: [], assets: [] };
	if (!response.ok) throw new Error(`鼠标轨迹读取失败（${response.status}）`);
	const value = (await response.json()) as Record<string, unknown> | unknown[];
	if (Array.isArray(value)) return { version: 2, provider: "none", samples: value, assets: [] };
	return {
		version: Number(value.version) || 2,
		provider: value.provider === "native" ? "native" : "none",
		samples: Array.isArray(value.samples) ? value.samples : [],
		assets: Array.isArray(value.assets) ? value.assets : [],
	};
}

function safeDuration(value: number | undefined, fallback = 0.04) {
	return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function codexChatBase(documentId: string) {
	return `/api/editor/projects/${encodeURIComponent(projectId)}/openscreen/documents/${encodeURIComponent(documentId)}/chat`;
}

function exportBase(documentId: string) {
	return `/api/editor/projects/${encodeURIComponent(projectId)}/openscreen/documents/${encodeURIComponent(documentId)}`;
}

function sleep(ms: number) {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nativeMeta(requestId?: unknown) {
	return {
		version: 1,
		requestId: typeof requestId === "string" && requestId ? requestId : crypto.randomUUID(),
		timestampMs: Date.now(),
	};
}

function exportQualityFromParams(params: Record<string, unknown> | undefined) {
	const width = Number(params?.width);
	const height = Number(params?.height);
	// OpenScreen leaves both dimensions unset for the "source" tier. Keep that
	// intent instead of silently downgrading a 4K/source export to "good".
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
		return "source" as const;
	if (Number.isFinite(width) && Number.isFinite(height) && Math.max(width, height) <= 1280)
		return "medium" as const;
	return "good" as const;
}

function gifSizeFromParams(params: Record<string, unknown> | undefined) {
	const width = Number(params?.width);
	const height = Number(params?.height);
	const edge = Math.max(Number.isFinite(width) ? width : 0, Number.isFinite(height) ? height : 0);
	if (edge && edge <= 640) return "medium" as const;
	if (edge && edge <= 1_000) return "large" as const;
	return "original" as const;
}

let browserExportCancelRequested = false;
let activeBrowserExport: { documentId: string; started: Promise<OpenScreenExportJob> } | null =
	null;
export async function cancelBrowserExport() {
	browserExportCancelRequested = true;
	const active = activeBrowserExport;
	if (!active) return;
	const job = await active.started;
	return api<OpenScreenExportJob>(
		`${exportBase(active.documentId)}/exports/${encodeURIComponent(job.id)}/cancel`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ clientId }),
		},
	);
}

async function runNativeExport(request: {
	action: "exportMulti" | "exportGif";
	payload?: Record<string, unknown>;
	requestId?: string;
}) {
	browserExportCancelRequested = false;
	if (!activeDocumentId) throw new Error("请先打开一个 OpenScreen 工程");
	if (!writable) throw new Error("当前工程为只读，不能导出");
	const payload = request.payload || {};
	const params =
		payload.params && typeof payload.params === "object"
			? (payload.params as Record<string, unknown>)
			: undefined;
	const clips = Array.isArray(payload.clips)
		? (payload.clips as Array<Record<string, unknown>>)
		: [];
	const fps = Number(params?.fps) || (request.action === "exportGif" ? 20 : 30);
	const totalDuration = clips.reduce((sum, clip) => {
		return sum + Math.max(0, Number(clip.sourceEndSec || 0) - Number(clip.sourceStartSec || 0));
	}, 0);
	const totalFrames = Math.max(1, Math.round(totalDuration * fps));
	const format = request.action === "exportGif" ? "gif" : "mp4";
	// Freeze the embedded editor's defaults: the separately installed renderer
	// may have different defaults and bundled wallpaper bytes.
	const exportDocument = (await readDocument(activeDocumentId)).document;
	const exportEditor = patchEditorSettings(
		exportDocument,
		getEditorSettings(exportDocument),
	).legacyEditor;
	bridgeMessage("export-state", {
		status: "running",
		label: `OpenScreen 正在导出 ${format.toUpperCase()}…`,
		documentId: activeDocumentId,
	});
	const startedPromise = api<OpenScreenExportJob>(`${exportBase(activeDocumentId)}/exports`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			clientId,
			outPath: payload.outPath,
			format,
			quality: exportQualityFromParams(params),
			mp4Fps: format === "mp4" ? fps : undefined,
			codec: params?.codec,
			exportEditor,
			gifFps: request.action === "exportGif" ? fps : undefined,
			gifSize: request.action === "exportGif" ? gifSizeFromParams(params) : undefined,
			totalFrames,
		}),
	});
	const active = { documentId: activeDocumentId, started: startedPromise };
	activeBrowserExport = active;
	try {
		let job = await startedPromise;
		if (browserExportCancelRequested) job = (await cancelBrowserExport()) ?? job;
		let lastFrame = -1;
		while (job.status === "queued" || job.status === "running") {
			const frame = Math.min(
				totalFrames,
				job.currentFrame ?? Math.round((job.progress / 100) * totalFrames),
			);
			if (frame !== lastFrame) {
				lastFrame = frame;
				for (const listener of nativeExportProgressListeners) listener(frame);
			}
			await sleep(450);
			job = await api<OpenScreenExportJob>(
				`${exportBase(active.documentId)}/exports/${encodeURIComponent(job.id)}`,
			);
		}
		if (job.status === "cancelled") throw new Error("OPENSCREEN_EXPORT_CANCELLED");
		if (job.status !== "completed") throw new Error(job.error || `OpenScreen 导出${job.status}`);
		for (const listener of nativeExportProgressListeners) listener(totalFrames);
		bridgeMessage("export-state", {
			status: "completed",
			label: `已导出到 ${job.outputFile}`,
			path: job.outputFile,
			documentId: activeDocumentId,
		});
		return {
			frames: totalFrames,
			fps,
			videoDurationS: job.videoDurationS ?? totalDuration,
			wallS: job.wallS ?? 0,
			...(format === "gif" ? { fileBytes: 0 } : {}),
		};
	} finally {
		if (activeBrowserExport === active) activeBrowserExport = null;
	}
}

function applyCodexOperations(input: AxcutDocument, operations: CodexOperation[]): AxcutDocument {
	let next = documentSchema.parse(input);
	for (const operation of operations) {
		switch (operation.kind) {
			case "timeline":
				next = applyTimelineOperation(next, operation.operation).document;
				break;
			case "zoom.add":
				next = { ...next, zoomRanges: [...next.zoomRanges, operation.range] };
				break;
			case "zoom.remove":
				next = {
					...next,
					zoomRanges: next.zoomRanges.filter((range) => range.id !== operation.id),
				};
				break;
			case "annotation.text.add": {
				const value = operation.annotation;
				next = {
					...next,
					annotations: [
						...next.annotations,
						{
							id: value.id,
							startMs: value.startMs,
							endMs: value.endMs,
							clipId: value.clipId,
							sourceStartSec: value.sourceStartSec,
							sourceEndSec: value.sourceEndSec,
							type: "text",
							content: value.text,
							textContent: value.text,
							position: value.position,
							size: value.size,
							style: {
								color: "#ffffff",
								backgroundColor: "rgba(0,0,0,0.65)",
								fontSize: 32,
								fontFamily: "Inter",
								fontWeight: "bold",
								fontStyle: "normal",
								textDecoration: "none",
								textAlign: "center",
								textAnimation: "fade",
							},
							zIndex: value.zIndex ?? 100,
						},
					],
				};
				break;
			}
			case "annotation.remove":
				next = {
					...next,
					annotations: next.annotations.filter((item) => item.id !== operation.id),
				};
				break;
			case "speed.add": {
				const legacy =
					next.legacyEditor && typeof next.legacyEditor === "object"
						? (next.legacyEditor as Record<string, unknown>)
						: {};
				const previous = Array.isArray(legacy.speedRegions) ? legacy.speedRegions : [];
				next = {
					...next,
					legacyEditor: { ...legacy, speedRegions: [...previous, operation.range] },
				};
				break;
			}
			case "speed.remove": {
				const legacy =
					next.legacyEditor && typeof next.legacyEditor === "object"
						? (next.legacyEditor as Record<string, unknown>)
						: {};
				const previous = Array.isArray(legacy.speedRegions) ? legacy.speedRegions : [];
				next = {
					...next,
					legacyEditor: {
						...legacy,
						speedRegions: previous.filter((item) => {
							return !(
								item &&
								typeof item === "object" &&
								(item as { id?: string }).id === operation.id
							);
						}),
					},
				};
				break;
			}
			case "composition.set": {
				const legacy =
					next.legacyEditor && typeof next.legacyEditor === "object"
						? (next.legacyEditor as Record<string, unknown>)
						: {};
				const values = operation.values;
				next = {
					...next,
					legacyEditor: {
						...legacy,
						...(values.aspectRatio === undefined ? {} : { aspectRatio: values.aspectRatio }),
						...(values.padding === undefined ? {} : { padding: values.padding }),
						...(values.borderRadius === undefined ? {} : { borderRadius: values.borderRadius }),
						...(values.shadow === undefined ? {} : { shadowIntensity: values.shadow / 100 }),
						...(values.backgroundColor === undefined ? {} : { wallpaper: values.backgroundColor }),
					},
				};
				break;
			}
		}
		next = documentSchema.parse(next);
	}
	return documentSchema.parse({
		...next,
		project: { ...next.project, updatedAt: new Date().toISOString() },
	});
}

function seedDocument(project: LinkReaderProject, source?: LinkReaderAsset): AxcutDocument {
	const document = createEmptyDocument({
		projectId: `lr_${crypto.randomUUID()}`,
		title: source?.name || "未命名录屏",
	});
	const videoAssets = source ? [source] : [];
	document.assets = videoAssets.map((asset) => ({
		id: asset.id,
		kind: "video" as const,
		label: asset.name,
		originalPath: mediaUrl(asset.id, "original"),
		proxyPath: mediaUrl(asset.id, "proxy"),
		waveformPath: mediaUrl(asset.id, "waveform"),
		durationSec: safeDuration(asset.duration),
		sizeBytes: asset.size,
		video: {
			codec: "unknown",
			width: asset.width || 0,
			height: asset.height || 0,
			fps: asset.fps || 0,
		},
		cameraTrack: null,
	}));
	const sourceClips = project.timeline.tracks
		.filter((track) => track.kind === "video")
		.flatMap((track) => track.clips)
		.filter((clip) => clip.assetId && videoAssets.some((asset) => asset.id === clip.assetId))
		.sort((a, b) => a.start - b.start);
	document.timeline.clips = sourceClips.map((clip) => {
		const sourceStartSec = Math.max(0, clip.sourceStart || 0);
		const duration = safeDuration(clip.sourceDuration || clip.duration);
		return {
			id: `lrclip_${clip.id}`,
			assetId: clip.assetId!,
			sourceStartSec,
			sourceEndSec: sourceStartSec + duration,
			timelineStartSec: Math.max(0, clip.start),
			timelineEndSec: Math.max(0, clip.start) + safeDuration(clip.duration),
			wordRefs: [],
			origin: "system" as const,
			reason: "从 LinkReader 工程的录屏原片建立",
		};
	});
	if (!document.timeline.clips.length && videoAssets[0]) {
		const asset = videoAssets[0];
		const duration = safeDuration(asset.duration);
		document.timeline.clips.push({
			id: `lrclip_${crypto.randomUUID()}`,
			assetId: asset.id,
			sourceStartSec: 0,
			sourceEndSec: duration,
			timelineStartSec: 0,
			timelineEndSec: duration,
			wordRefs: [],
			origin: "system",
			reason: "从 LinkReader 素材建立",
		});
	}
	if (document.assets[0]) document.project.primaryAssetId = document.assets[0].id;
	return documentSchema.parse(document);
}

async function listDocuments(): Promise<DocumentRef[]> {
	return api(`/api/editor/projects/${projectId}/openscreen/documents`);
}

async function readDocument(id: string): Promise<DocumentEnvelope> {
	const result = await api<DocumentEnvelope>(
		`/api/editor/projects/${projectId}/openscreen/documents/${id}`,
	);
	activeDocumentId = id;
	revisions.set(id, result.revision);
	savedDocuments.set(id, documentFingerprint(result.document));
	return { ...result, document: normalizeDocument(result.document) };
}

async function createDocument(document: AxcutDocument): Promise<DocumentEnvelope> {
	if (!writable) throw new Error("当前工程为只读，不能新建 OpenScreen 文档");
	const normalized = normalizeDocument(document);
	const result = await api<DocumentEnvelope>(
		`/api/editor/projects/${projectId}/openscreen/documents`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ document: normalized, documentId: normalized.project.id, clientId }),
		},
	);
	revisions.set(result.ref.id, result.revision);
	savedDocuments.set(result.ref.id, documentFingerprint(result.document));
	activeDocumentId = result.ref.id;
	return { ...result, document: normalizeDocument(result.document) };
}

async function persistHostDocument(document: AxcutDocument, reportError = true): Promise<DocumentEnvelope> {
	if (!writable) throw new Error("当前工程为只读，修改不会保存");
	const normalized = normalizeDocument(document);
	const id = normalized.project.id;
	activeDocumentId = id;
	bridgeMessage("save-state", { label: "正在保存…", documentId: id });
	try {
		const result = await api<DocumentEnvelope>(
			`/api/editor/projects/${projectId}/openscreen/documents/${id}`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ document: normalized, revision: revisions.get(id) ?? 0, clientId }),
			},
		);
		revisions.set(id, result.revision);
		savedDocuments.set(id, documentFingerprint(result.document));
		bridgeMessage("save-state", { label: "已保存", documentId: id, revision: result.revision });
		return { ...result, document: normalizeDocument(result.document) };
	} catch (error) {
		if (reportError) bridgeMessage("error", { message: error instanceof Error ? error.message : String(error) });
		throw error;
	}
}

async function ensureInitialDocument(): Promise<DocumentRef[]> {
	let refs = await listDocuments();
	if (!writable) return refs;
	const project = await api<LinkReaderProject>(`/api/editor/projects/${projectId}`);
	// Archived subprojects still own their recording sources. Treat them as
	// represented so a refresh never creates a blank replacement that discards
	// the user's earlier OpenScreen edit history.
	const allRefs = project.openScreenDocuments || refs;
	const represented = new Set(allRefs.flatMap((ref) => ref.sourceAssetIds));
	let recordings = project.media.filter(
		(asset) =>
			asset.type === "video" && (asset.origin === "screen-recording" || Boolean(asset.capture)),
	);
	// Legacy projects predate the origin field. When no recording has ever been
	// classified, preserve their first-entry experience without aggregating all
	// project videos into one OpenScreen document.
	if (!recordings.length && !refs.length) {
		recordings = project.media.filter((asset) => asset.type === "video").slice(0, 1);
	}
	for (const asset of recordings) {
		if (
			represented.has(asset.id) ||
			(asset.openScreenDocumentId && allRefs.some((ref) => ref.id === asset.openScreenDocumentId))
		)
			continue;
		const created = await createDocument(seedDocument(project, asset));
		for (const assetId of created.ref.sourceAssetIds) represented.add(assetId);
	}
	refs = await listDocuments();
	if (!refs.length) await createDocument(seedDocument(project));
	refs = await listDocuments();
	return refs;
}

async function pickAndUploadVideo() {
	if (!writable) return { success: false, canceled: true } as const;
	return new Promise<
		| { success: true; canceled: false; path: string; name: string }
		| { success: false; canceled: true }
	>((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "video/*";
		input.style.display = "none";
		input.onchange = async () => {
			const file = input.files?.[0];
			input.remove();
			if (!file) return resolve({ success: false, canceled: true });
			try {
				const uploaded = await api<LinkReaderAsset>(
					`/api/editor/projects/${projectId}/media?filename=${encodeURIComponent(file.name)}&capture=screen`,
					{
						method: "PUT",
						headers: { "Content-Type": file.type || "video/mp4" },
						body: file,
					},
				);
				resolve({
					success: true,
					canceled: false,
					path: mediaUrl(uploaded.id, "original"),
					name: uploaded.name,
				});
			} catch (error) {
				bridgeMessage("error", { message: error instanceof Error ? error.message : String(error) });
				resolve({ success: false, canceled: true });
			}
		};
		input.oncancel = () => {
			input.remove();
			resolve({ success: false, canceled: true });
		};
		document.body.append(input);
		input.click();
	});
}

export async function installLinkReaderBridge() {
	if (!projectId || !clientId) throw new Error("缺少 LinkReader 工程桥接参数");
	const client = nativeBridgeClient as unknown as Record<
		string,
		Record<string, (...args: any[]) => any>
	>;
	const ai = client.aiEdition;
	const electron = window.electronAPI as unknown as Record<string, any>;
	const originalInvokeNativeBridge =
		typeof electron.invokeNativeBridge === "function"
			? electron.invokeNativeBridge.bind(electron)
			: undefined;
	// These synchronous values normally come from Electron's preload.  Expose
	// the real host platform and the versioned static asset root before any
	// upstream inspector or cursor component reads them.
	electron.getPlatform = () => "darwin";
	electron.assetBaseUrl = `${location.origin}/openscreen/`;
	electron.requestCameraAccess = async () => {
		if (!navigator.mediaDevices?.getUserMedia) {
			return { success: false, granted: false, status: "unsupported" };
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			stream.getTracks().forEach((track) => track.stop());
			return { success: true, granted: true, status: "granted" };
		} catch (error) {
			return {
				success: true,
				granted: false,
				status: error instanceof DOMException ? error.name : "denied",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
	client.cursor.getCapabilities = async () => ({
		telemetry: true,
		systemAssets: false,
		provider: "native",
	});
	client.cursor.getRecordingData = cursorRecordingData;
	client.cursor.getTelemetry = async (videoPath?: string) =>
		(await cursorRecordingData(videoPath)).samples;

	ai.listProjects = async () => {
		const [refs, project] = await Promise.all([
			ensureInitialDocument(),
			api<LinkReaderProject>(`/api/editor/projects/${projectId}`),
		]);
		return refs.flatMap((ref) => {
			const sourceAssets = ref.sourceAssetIds
				.map((assetId) => project.media.find((asset) => asset.id === assetId))
				.filter((asset): asset is LinkReaderAsset => Boolean(asset));
			const recordingSources = sourceAssets.filter(
				(asset) => asset.origin === "screen-recording" || Boolean(asset.capture),
			);
			// Old export-smoke and aggregate documents are implementation debris,
			// not recording subprojects. Keep the Media page scoped to recordings.
			if (!recordingSources.length) return [];
			const latestPublished = ref.latestPublishedAssetId
				? project.media.find((asset) => asset.id === ref.latestPublishedAssetId)
				: undefined;
			return [
				{
					id: ref.id,
					title: ref.title,
					updatedAt: new Date(ref.updatedAt).toISOString(),
					assetCount: ref.sourceAssetIds.length,
					durationSec: ref.duration,
					revision: ref.revision,
					sourceAssetNames: recordingSources.map((asset) => asset.name),
					latestPublishedAssetId: ref.latestPublishedAssetId,
					latestPublishedAssetName: latestPublished?.name,
					lastPublishedAt: ref.lastPublishedAt
						? new Date(ref.lastPublishedAt).toISOString()
						: undefined,
				},
			];
		});
	};
	ai.get = async (id: string) => {
		try {
			return { success: true, document: (await readDocument(id)).document };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			bridgeMessage("error", { message: `录屏工程无法打开：${message}。原始文件已保留。` });
			return { success: false, error: message };
		}
	};
	ai.create = async (title?: string) => {
		try {
			const document = createEmptyDocument({
				projectId: `lr_${crypto.randomUUID()}`,
				title: title || "未命名录屏",
			});
			return { success: true, document: (await createDocument(document)).document };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	};
	ai.save = async (value: unknown) => {
		try {
			return {
				success: true,
				document: (await persistHostDocument(documentSchema.parse(value))).document,
			};
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	};
	ai.delete = async (id: string) => {
		if (!writable) return { success: false, error: "当前工程为只读" };
		try {
			await api(`/api/editor/projects/${projectId}/openscreen/documents/${id}`, {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ clientId }),
			});
			return { success: true };
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	};
	ai.addAsset = async (id: string, path: string, label?: string) => {
		const current = await readDocument(id);
		const linkReaderAssetId = assetIdFromMediaPath(path);
		const assetId =
			linkReaderAssetId && !current.document.assets.some((asset) => asset.id === linkReaderAssetId)
				? linkReaderAssetId
				: `asset_${crypto.randomUUID()}`;
		const next = documentSchema.parse({
			...current.document,
			project: {
				...current.document.project,
				primaryAssetId: current.document.project.primaryAssetId || assetId,
			},
			assets: [
				...current.document.assets,
				{
					id: assetId,
					kind: "video",
					label: label || "录屏素材",
					originalPath: path,
					cameraTrack: null,
				},
			],
		});
		const saved = await persistHostDocument(next);
		return { assetId, document: saved.document };
	};
	ai.removeAsset = async (id: string, assetId: string) => {
		const current = await readDocument(id);
		const next = documentSchema.parse({
			...current.document,
			assets: current.document.assets.filter((asset) => asset.id !== assetId),
			timeline: {
				...current.document.timeline,
				clips: current.document.timeline.clips.filter((clip) => clip.assetId !== assetId),
			},
		});
		const saved = await persistHostDocument(next);
		return { assetId, document: saved.document };
	};

	// LinkReader deliberately exposes one already-authenticated provider here:
	// the local Codex CLI owned by the 3010 service. The upstream provider
	// settings remain outside this embedded product surface, so OpenScreen never
	// asks users to configure a second set of model credentials.
	const codexSnapshot = {
		config: {
			provider: "codex",
			model: "Codex",
			reasoningEffort: "medium",
			allowAgentEdits: writable,
		},
		connectedProviders: ["codex"],
		availableProviders: [{ id: "codex", label: "本机 Codex", authKind: "codex" }],
		credentialSummary: [
			{
				providerId: "codex",
				connected: true,
				authKind: "codex",
				credentialKind: "codex",
			},
		],
	};
	const hostAgentSnapshot = async () => {
		const { settings } = await api<{
			settings: { modules: { screenEditing: { model: string; effort: string } } };
		}>("/api/editor/agent-settings");
		return {
			...codexSnapshot,
			config: {
				...codexSnapshot.config,
				model: settings.modules.screenEditing.model,
				reasoningEffort: settings.modules.screenEditing.effort,
			},
		};
	};
	ai.llmGetSnapshot = hostAgentSnapshot;
	ai.llmSetConfig = async () => ({
		success: false,
		error: "请在工作台首页的 Agent 设置中修改录屏编辑模型",
	});
	ai.llmSetApiKey = async () => ({
		success: false,
		error: "LinkReader 使用宿主机 Codex，无需设置 API Key",
	});
	ai.llmRemoveApiKey = async () => ({ success: false, error: "LinkReader 使用宿主机 Codex" });
	ai.llmDisconnect = async () => ({ success: false, snapshot: codexSnapshot });
	ai.llmListProviderModels = async () => ({ models: [(await hostAgentSnapshot()).config.model] });
	ai.chatListSessions = async (documentId: string) => api(`${codexChatBase(documentId)}/sessions`);
	ai.chatCreateSession = async (documentId: string, title?: string) =>
		api(`${codexChatBase(documentId)}/sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title }),
		});
	ai.chatSelectSession = async (documentId: string, sessionId: string) =>
		api(`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}`);
	ai.chatRenameSession = async (documentId: string, sessionId: string, title: string) =>
		api(`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title }),
		});
	ai.chatDeleteSession = async (documentId: string, sessionId: string) =>
		api(`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}`, {
			method: "DELETE",
		});
	ai.chatRun = async (documentId: string, sessionId: string, message: string, value?: unknown) => {
		if (!writable) return { success: false, error: "当前工程为只读，Codex 不能应用编辑" };
		const document = documentSchema.parse(value);
		bridgeMessage("task-state", {
			task: "codex",
			label: "Codex 正在理解工程并生成编辑操作…",
			documentId,
		});
		try {
			const result = await api<CodexRunResult>(
				`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}/run`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ message, document, clientId }),
				},
			);
			const next = result.operations.length
				? applyCodexOperations(document, result.operations)
				: undefined;
			bridgeMessage("task-state", {
				task: "codex",
				label: result.operations.length
					? `Codex 已生成 ${result.operations.length} 项可撤销编辑`
					: "Codex 已完成分析",
				documentId,
			});
			return { ...result, document: next };
		} catch (error) {
			bridgeMessage("error", { message: error instanceof Error ? error.message : String(error) });
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	};
	ai.chatRewind = async (documentId: string, sessionId: string, messageId: string) =>
		api(`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}/rewind`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messageId, clientId }),
		});
	ai.chatUndoLastBatch = async (documentId: string, sessionId: string) => {
		const session = await api<{
			messages: Array<{ id: string; role: string; checkpointId?: string | null }>;
		}>(`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}`);
		const target = [...session.messages]
			.reverse()
			.find((message) => message.role === "user" && message.checkpointId);
		if (!target) return { success: false, error: "没有可撤回的 Codex 编辑" };
		return api(`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}/rewind`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messageId: target.id, clientId }),
		});
	};
	ai.chatBudget = async (documentId: string, sessionId: string) =>
		api(`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}/budget`);
	ai.chatContextUsage = ai.chatBudget;
	ai.chatCompact = async (documentId: string, sessionId: string) =>
		api(`${codexChatBase(documentId)}/sessions/${encodeURIComponent(sessionId)}/compact`, {
			method: "POST",
		});
	ai.chatCompactNow = ai.chatCompact;
	ai.translateCaptions = async (input: {
		segments: Array<{ id: string; text: string }>;
		targetLanguage: string;
		sourceLanguage?: string;
	}) => {
		if (!activeDocumentId)
			return { success: false, segments: {}, error: "请先打开一个 OpenScreen 工程" };
		bridgeMessage("task-state", {
			task: "caption-translation",
			label: `Codex 正在翻译 ${input.segments.length} 条字幕…`,
			documentId: activeDocumentId,
		});
		try {
			const result = await api<{
				success: boolean;
				segments: Record<string, string>;
				model?: string;
			}>(
				`/api/editor/projects/${encodeURIComponent(projectId)}/openscreen/documents/${encodeURIComponent(activeDocumentId)}/captions/translate`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(input),
				},
			);
			bridgeMessage("task-state", {
				task: "caption-translation",
				label: `字幕翻译完成，共 ${Object.keys(result.segments).length} 条`,
				documentId: activeDocumentId,
			});
			return result;
		} catch (error) {
			return {
				success: false,
				segments: {},
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
	client.project.getCurrentContext = async () => ({
		currentProjectPath: `linkreader://${projectId}`,
		currentVideoPath: null,
	});

	electron.openVideoFilePicker = pickAndUploadVideo;
	electron.findRecordingCamera = async (videoPath: string) => {
		if (!activeDocumentId) return { success: false };
		try {
			const envelope = await readDocument(activeDocumentId);
			const targetAssetId = assetIdFromMediaPath(videoPath);
			const asset = envelope.document.assets.find(
				(candidate) =>
					candidate.originalPath === videoPath ||
					(targetAssetId && assetIdFromMediaPath(candidate.originalPath) === targetAssetId),
			);
			const camera = asset?.cameraTrack;
			if (!camera?.sourcePath) return { success: false };
			return {
				success: true,
				webcamVideoPath: camera.sourcePath,
				offsetMs: Math.round(camera.offsetMs || 0),
			};
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
	};
	electron.getAudioPeaks = async (videoPath: string, durationSec: number) => {
		const assetId = assetIdFromMediaPath(videoPath);
		if (!assetId) return { success: true, peaks: null };
		try {
			const response = await fetch(
				`/api/editor/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(assetId)}/peaks?duration=${encodeURIComponent(String(durationSec))}`,
				{ cache: "no-store" },
			);
			if (!response.ok) {
				const detail = (await response.json().catch(() => null)) as { error?: string } | null;
				return { success: false, message: detail?.error || `波形生成失败（${response.status}）` };
			}
			return { success: true, peaks: new Float32Array(await response.arrayBuffer()) };
		} catch (error) {
			return { success: false, message: error instanceof Error ? error.message : String(error) };
		}
	};
	// Chromium can play the primary HTTP media stream directly.  Native
	// OpenScreen only needs this helper to expose a second embedded audio track;
	// imported native recordings already persist their microphone/system mix in
	// the document, so report the absence explicitly instead of leaving a fake
	// browser-shim implementation in place.
	electron.preparePreviewAudioTrack = async () => ({ success: false, path: null });
	electron.pickExportSavePath = async (suggested: string) => {
		if (!activeDocumentId) return { success: false, canceled: true };
		try {
			const result = await api<{ path: string; format: "mp4" | "gif" }>(
				`${exportBase(activeDocumentId)}/export-target`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ suggested }),
				},
			);
			return { success: true, canceled: false, path: result.path };
		} catch (error) {
			bridgeMessage("error", { message: error instanceof Error ? error.message : String(error) });
			return { success: false, canceled: true };
		}
	};
	electron.onNativeExportProgress = (callback: (frames: number) => void) => {
		nativeExportProgressListeners.add(callback);
		return () => nativeExportProgressListeners.delete(callback);
	};
	electron.revealInFolder = async (filePath: string) =>
		api(`${exportBase(activeDocumentId)}/reveal`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path: filePath }),
		});
	electron.showItemInFolder = electron.revealInFolder;
	electron.invokeNativeBridge = async (request: {
		domain?: string;
		action?: string;
		payload?: Record<string, unknown>;
		requestId?: string;
	}) => {
		if (
			request.domain === "compositor" &&
			(request.action === "exportMulti" || request.action === "exportGif")
		) {
			try {
				return {
					ok: true,
					data: await runNativeExport({
						action: request.action,
						payload: request.payload,
						requestId: request.requestId,
					}),
					meta: nativeMeta(request.requestId),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				bridgeMessage("export-state", {
					status: message === "OPENSCREEN_EXPORT_CANCELLED" ? "cancelled" : "failed",
					label: message === "OPENSCREEN_EXPORT_CANCELLED" ? "导出已取消" : message,
					documentId: activeDocumentId,
				});
				return {
					ok: false,
					error: { code: "LINKREADER_OPENSCREEN_EXPORT_FAILED", message },
					meta: nativeMeta(request.requestId),
				};
			}
		}
		if (originalInvokeNativeBridge) return originalInvokeNativeBridge(request);
		return {
			ok: false,
			error: {
				code: "LINKREADER_NATIVE_BRIDGE_UNAVAILABLE",
				message: "当前浏览器不支持该原生调用",
			},
			meta: nativeMeta(request.requestId),
		};
	};
	installBridgeEdition({ electron, projectId, clientId, writable, getActiveDocumentId: () => activeDocumentId, api, bridgeMessage, readDocument, exportBase, sleep });
	electron.getAppInfo = async () => ({ version: "1.10.0-linkreader", canCheckForUpdates: false });
	electron.getSources = async () => {
		const sources = await api<
			Array<{ id: string; name: string; type: string; displayId?: string; thumbnail?: string }>
		>("/api/editor/openscreen/sources");
		return sources
			.filter((source) => source.type !== "microphone")
			.map((source) => ({
				id: source.id,
				name: source.name,
				display_id: source.displayId || "",
				thumbnail: source.thumbnail || null,
				appIcon: null,
			}));
	};
	electron.startNewRecording = async () => {
		if (!writable) return { success: false, error: "当前工程为只读" };
		const session = await api(`/api/editor/projects/${projectId}/openscreen/host-sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ clientId }),
		});
		bridgeMessage("recording-state", { session });
		return { success: true };
	};
	electron.openSourceSelector = electron.startNewRecording;
	electron.setHasUnsavedChanges = (dirty: boolean) =>
		bridgeMessage("save-state", { label: dirty ? "未保存" : "已保存" });

	bridgeMessage("ready", { version: "1.10.0", writable });
}

/** 只读/未修改时只读已保存版本；有编辑权的脏文档才先保存。 */
export async function requestSharedExportDialog(document: AxcutDocument, dirty: boolean) {
  try {
    // 导出读取不能推进编辑器的 revision 或基线，否则旧内容可能覆盖其他窗口的新修改。
    const readSaved = async () => {
      const result = await api<DocumentEnvelope>(
        `/api/editor/projects/${encodeURIComponent(projectId)}/openscreen/documents/${encodeURIComponent(document.project.id)}`,
      );
      return { ...result, document: normalizeDocument(result.document) };
    };
    const { saved, readOnly } = await prepareSavedScreenExport({
      writable, dirty,
      unchanged: savedDocuments.get(document.project.id) === documentFingerprint(document),
      persist: () => persistHostDocument(document, false),
      readSaved,
    });
    const source = pickExtremeDims(collectEffectiveClipDims(saved.document), "smallest");
    if (!source) throw Error("上次保存的版本没有录屏素材，无法导出");
    const dims = calculateMp4ExportSettings({
      quality: "source", sourceWidth: source.width, sourceHeight: source.height,
      aspectRatioValue: resolveAspectRatioValue(saved.document, getEditorSettings(saved.document).aspectRatio),
    });
    const asset = saved.document.assets.find(value => value.id === saved.document.project.primaryAssetId) || saved.document.assets[0];
    bridgeMessage("export-dialog", {
      documentId: saved.ref.id, revision: saved.revision, useSavedDocument: true,
      savedEditor: patchEditorSettings(saved.document, getEditorSettings(saved.document)).legacyEditor,
      canvas: { width: dims.width, height: dims.height, fps: asset?.video?.fps || 30 },
      notice: readOnly ? "另一个窗口正在编辑，导出的是上次保存的版本" : undefined,
    });
  } catch (error) {
    bridgeMessage("error", { message: `无法打开导出：${error instanceof Error ? error.message : String(error)}` });
    throw error;
  }
}
