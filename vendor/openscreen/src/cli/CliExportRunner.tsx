// Hidden-window runner for `openscreen export`. Loads an .openscreen project,
// migrates it to the AxcutDocument the native Rust compositor consumes, and
// drives exportMultiNative/exportGifNative — mirroring the v4 ExportDialog so
// CLI exports and GUI exports stay pixel-identical. The hidden window does no
// compositing itself: the render runs in the main process; this runner only
// builds the clip list + scene JSON and relays progress.

import { useEffect, useRef, useState } from "react";
import {
	normalizeProjectEditor,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "@/components/video-editor/projectPersistence";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import {
	migrateAxcutDocumentToProjectData,
	migrateProjectDataToAxcutDocument,
} from "@/lib/ai-edition/document/migrate";
import {
	collectEffectiveClipDims,
	type Dims,
	pickExtremeDims,
	resolveAspectRatioValue,
} from "@/lib/ai-edition/document/outputFormat";
import { applyProbedDuration } from "@/lib/ai-edition/document/timeline";
import {
	documentSchema,
	migrateRawDocumentToCurrent,
	type AxcutDocument,
} from "@/lib/ai-edition/schema";
import { getEditorSettings } from "@/lib/ai-edition/store/editorSettings";
import { assetCameraSource } from "@/lib/ai-edition/timeline/camera";
import { resolveClipSourceEndSec } from "@/lib/ai-edition/timeline/clipDuration";
import { DEFAULT_ZOOM_DEPTH, ZOOM_DEPTH_SCALES } from "@/lib/ai-edition/timeline/zoom-scale";
import { buildAutoZoomSuggestions } from "@/lib/ai-edition/timeline/zoom-suggestions";
import type { CliDoneResult, CliExportRequest } from "@/lib/cliContracts";
import { GIF_SIZE_PRESETS, type GifSizePreset } from "@/lib/exporter";
import { calculateMp4ExportSettings } from "@/lib/exporter/mp4ExportSettings";
import { mixVoiceoverIntoVideo } from "@/lib/exporter/voiceoverMix";
import { exportGifNative, exportMultiNative, nativeBridgeClient } from "@/native";
import type { CompositorClipInput } from "@/native/contracts";
import { buildSceneDescription, resolveVisibleClips } from "@/native/sceneDescription";
import { clampZoomFocus } from "./vendor/zoomHelpers";

const MP4_EXPORT_FPS = 60;

function probeVideoDimensions(
	url: string,
): Promise<{ width: number; height: number; durationMs: number }> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.preload = "metadata";
		video.muted = true;
		const cleanup = () => {
			clearTimeout(timer);
			video.removeAttribute("src");
			video.load();
		};
		// A stalled load fires neither event; without a deadline the CLI hangs.
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out reading video metadata: ${url}`));
		}, 30_000);
		video.onloadedmetadata = () => {
			const width = video.videoWidth;
			const height = video.videoHeight;
			const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
			cleanup();
			resolve({ width, height, durationMs });
		};
		video.onerror = () => {
			cleanup();
			reject(new Error(`Failed to load video metadata: ${url}`));
		};
		video.src = url;
	});
}

function replaceExtension(filePath: string, newExtension: string): string {
	return filePath.replace(/\.(openscreen|json)$/i, "") + newExtension;
}

/** Mirrors ExportDialog.buildNativeClipList: trim-narrowed visible clips mapped
 * onto the native multiclip contract. Kept in lock-step with
 * buildSceneDescription so export and scene agree on the clip stream. */
function buildNativeClipList(axcutDocument: AxcutDocument): CompositorClipInput[] {
	const assetById = new Map(axcutDocument.assets.map((asset) => [asset.id, asset]));
	return resolveVisibleClips(axcutDocument).flatMap((clip) => {
		const asset = assetById.get(clip.assetId);
		if (!asset?.originalPath) {
			return [];
		}
		const camera = assetCameraSource(asset);
		const sourceEndSec = resolveClipSourceEndSec(clip, asset);
		return [
			{
				screenPath: asset.originalPath,
				webcamPath: camera.path,
				sourceStartSec: clip.sourceStartSec,
				sourceEndSec,
				webcamOffsetSec: camera.offsetSec,
				hasAudio: true,
			},
		];
	});
}

/** Mirrors ExportDialog.gifOutputDims: cap height at the preset, keep even. */
function gifOutputDims(
	preset: GifSizePreset,
	tierDims: { width: number; height: number } | null,
): { width?: number; height?: number } {
	if (!tierDims) return {};
	const maxHeight = GIF_SIZE_PRESETS[preset].maxHeight;
	if (!Number.isFinite(maxHeight) || tierDims.height <= maxHeight) {
		return { width: tierDims.width, height: tierDims.height };
	}
	const scale = maxHeight / tierDims.height;
	const even = (n: number) => Math.max(2, Math.round(n * scale) & ~1);
	return { width: even(tierDims.width), height: even(tierDims.height) };
}

function appendAutoZoomRanges(
	axcutDocument: AxcutDocument,
	cursorTelemetry: CursorTelemetryPoint[],
	totalMs: number,
): number {
	const suggestions = buildAutoZoomSuggestions({
		cursorTelemetry,
		totalMs,
		existingRegions: axcutDocument.zoomRanges,
		defaultDurationMs: Math.max(1000, Math.round(totalMs * 0.05)),
	});
	let nextId = 1;
	for (const suggestion of suggestions) {
		axcutDocument.zoomRanges.push({
			id: `cli-auto-zoom-${nextId++}`,
			startMs: Math.round(suggestion.span.start),
			endMs: Math.round(suggestion.span.end),
			depth: DEFAULT_ZOOM_DEPTH,
			customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
			focus: clampZoomFocus(suggestion.focus),
			focusMode: "auto",
			source: "auto",
		});
	}
	return suggestions.length;
}

async function runExport(request: CliExportRequest): Promise<CliDoneResult> {
	const loaded = await nativeBridgeClient.project.loadProjectFileFromPath(request.projectPath);
	if (!loaded.success || loaded.project === undefined) {
		throw new Error(loaded.error ?? loaded.message ?? "Failed to load project file");
	}

	// OpenScreen 1.10 writes the current v7 Axcut document, while its original
	// CLI exporter only accepted the pre-Axcut `{ version, media, editor }`
	// envelope. Accept both formats here. Current documents stay current —
	// converting them back to the legacy envelope would collapse a multi-asset
	// timeline and lose clip-local state such as crops, captions and modifiers.
	const currentResult = documentSchema.safeParse(migrateRawDocumentToCurrent(loaded.project));
	let axcutDocument: AxcutDocument;
	let editor: ReturnType<typeof normalizeProjectEditor>;
	if (currentResult.success) {
		axcutDocument = currentResult.data;
		editor = normalizeProjectEditor(
			migrateAxcutDocumentToProjectData(axcutDocument).editor,
		);
		window.electronAPI.cliLog(
			"info",
			`Loaded current OpenScreen schema v${axcutDocument.schemaVersion}`,
		);
	} else {
		if (!validateProjectData(loaded.project)) {
			throw new Error(
				`Project file is not a valid .openscreen project: ${currentResult.error.issues[0]?.message ?? "unsupported schema"}`,
			);
		}
		const project = loaded.project;
		const media = resolveProjectMedia(project);
		if (!media) {
			throw new Error("Project file does not reference any recorded media");
		}
		// Prefer the main process's approved session paths for legacy projects:
		// they carry the packed-project sibling fallback when stored absolute
		// paths are stale. Current documents already carry per-asset paths.
		try {
			const sessionResult = await window.electronAPI.getCurrentRecordingSession();
			const session = sessionResult?.session;
			if (session?.screenVideoPath) {
				media.screenVideoPath = session.screenVideoPath;
				if (media.webcamVideoPath && session.webcamVideoPath) {
					media.webcamVideoPath = session.webcamVideoPath;
				}
			}
		} catch {
			// Fall back to the paths stored in the project file.
		}
		editor = normalizeProjectEditor(project.editor ?? {});
		axcutDocument = migrateProjectDataToAxcutDocument({
			...project,
			media,
			editor,
		});
	}

	const format = request.format ?? editor.exportFormat;
	if (request.audioPath && format === "gif") {
		throw new Error(
			"--audio is only supported for MP4 exports (this project's stored format is gif; pass --format mp4)",
		);
	}
	const quality = request.quality ?? editor.exportQuality;
	const gifFrameRate = request.gifFrameRate ?? editor.gifFrameRate;
	const gifSizePreset = request.gifSizePreset ?? editor.gifSizePreset;
	const outPath =
		request.outPath ?? replaceExtension(request.projectPath, format === "gif" ? ".gif" : ".mp4");
	const primaryAssetId = axcutDocument.project.primaryAssetId ?? axcutDocument.assets[0]?.id;
	const primaryAsset = axcutDocument.assets.find((asset) => asset.id === primaryAssetId);
	if (!primaryAssetId || !primaryAsset?.originalPath) {
		throw new Error("Project does not contain a primary media asset");
	}

	// Cursor telemetry is only needed to compute --auto-zoom suggestions. The
	// native compositor discovers the `<video>.cursor.json` sidecar itself.
	let cursorTelemetry: CursorTelemetryPoint[] = [];
	if (request.autoZoom) {
		try {
			cursorTelemetry = await nativeBridgeClient.cursor.getTelemetry(primaryAsset.originalPath);
		} catch {
			cursorTelemetry = [];
		}
	}

	// Probe every asset that is actually referenced by a visible timeline clip.
	// Current OpenScreen documents are multi-asset; probing only the primary
	// recording produces wrong output sizing and can leave later clips at a
	// zero-frame placeholder duration.
	const usedAssetIds = new Set(axcutDocument.timeline.clips.map((clip) => clip.assetId));
	const probedAssetDims: Record<string, Dims> = {};
	const probedDurationMs: Record<string, number> = {};
	for (const asset of axcutDocument.assets) {
		if (!usedAssetIds.has(asset.id)) continue;
		const probed = await probeVideoDimensions(toFileUrl(asset.originalPath));
		probedAssetDims[asset.id] = { width: probed.width, height: probed.height };
		probedDurationMs[asset.id] = probed.durationMs;
		if (probed.durationMs > 0) {
			axcutDocument = applyProbedDuration(
				axcutDocument,
				asset.id,
				probed.durationMs / 1000,
			);
		}
		axcutDocument = {
			...axcutDocument,
			assets: axcutDocument.assets.map((candidate) =>
				candidate.id === asset.id
					? {
							...candidate,
							durationSec: probed.durationMs > 0
								? probed.durationMs / 1000
								: candidate.durationSec,
							video: {
								codec: candidate.video?.codec ?? "unknown",
								fps: candidate.video?.fps ?? 0,
								width: probed.width,
								height: probed.height,
							},
						}
					: candidate,
			),
		};
	}

	// Camera dimensions decide the PiP layout box. A missing optional camera is
	// tolerated, but a healthy one is probed so preview and export use the same
	// aspect ratio rather than the compositor's 4:3 fallback.
	for (const asset of axcutDocument.assets) {
		if (!usedAssetIds.has(asset.id) || !asset.cameraTrack?.sourcePath) continue;
		const camera = await probeVideoDimensions(toFileUrl(asset.cameraTrack.sourcePath)).catch(
			() => null,
		);
		if (!camera) continue;
		axcutDocument = {
			...axcutDocument,
			assets: axcutDocument.assets.map((candidate) =>
				candidate.id === asset.id && candidate.cameraTrack
					? {
							...candidate,
							cameraTrack: {
								...candidate.cameraTrack,
								width: camera.width,
								height: camera.height,
							},
						}
					: candidate,
			),
		};
	}

	if (request.autoZoom) {
		const added = appendAutoZoomRanges(
			axcutDocument,
			cursorTelemetry,
			probedDurationMs[primaryAssetId] ?? 0,
		);
		window.electronAPI.cliLog("info", `Auto-zoom: added ${added} region(s) from cursor telemetry`);
	}

	// Output sizing mirrors the ExportDialog: crop-aware smallest clip on the
	// timeline, normalized to the document's aspect ratio.
	const primaryDims = probedAssetDims[primaryAssetId];
	if (!primaryDims) {
		throw new Error("Primary media asset is not used by any timeline clip");
	}
	const smallestSource =
		pickExtremeDims(collectEffectiveClipDims(axcutDocument, probedAssetDims), "smallest") ??
		primaryDims;
	const aspectRatioValue = resolveAspectRatioValue(
		axcutDocument,
		getEditorSettings(axcutDocument).aspectRatio,
	);
	const outDims = calculateMp4ExportSettings({
		quality,
		sourceWidth: smallestSource.width,
		sourceHeight: smallestSource.height,
		aspectRatioValue,
	});

	const clips = buildNativeClipList(axcutDocument);
	if (clips.length === 0) {
		throw new Error("The project's timeline has no visible clips to export");
	}
	const sceneJson = JSON.stringify(buildSceneDescription(axcutDocument));

	// Progress: native pushes raw encoded-frame counts; totals and pacing are
	// computed here, mirroring the ExportDialog.
	const outFps = format === "gif" ? gifFrameRate : MP4_EXPORT_FPS;
	const totalFrames = Math.max(
		1,
		Math.round(
			clips.reduce((sum, clip) => sum + Math.max(0, clip.sourceEndSec - clip.sourceStartSec), 0) *
				outFps,
		),
	);
	const exportStartedAt = Date.now();
	const unsubscribeProgress = window.electronAPI.onNativeExportProgress?.((frames: number) => {
		const elapsedSec = (Date.now() - exportStartedAt) / 1000;
		const rate = frames > 0 ? frames / Math.max(elapsedSec, 0.001) : 0;
		window.electronAPI.cliProgress({
			percentage: Math.min(100, (frames / totalFrames) * 100),
			currentFrame: frames,
			totalFrames,
			estimatedTimeRemaining: rate > 0 ? Math.max(0, (totalFrames - frames) / rate) : 0,
		});
	});

	try {
		if (format === "gif") {
			const dims = gifOutputDims(gifSizePreset, outDims);
			await exportGifNative(clips, outPath, sceneJson, {
				...dims,
				fps: gifFrameRate,
				loopCount: editor.gifLoop ? 0 : 1,
			});
			return {
				success: true,
				outputPath: outPath,
				format,
				width: dims.width,
				height: dims.height,
			};
		}

		// MP4: native writes outPath directly. When a voiceover is requested, mix
		// it afterwards (the native pipeline has no extra-audio-track concept) and
		// overwrite the same file.
		await exportMultiNative(clips, outPath, sceneJson, {
			width: outDims.width,
			height: outDims.height,
			fps: MP4_EXPORT_FPS,
			codec: "h264",
		});

		if (request.audioPath) {
			window.electronAPI.cliProgress({ percentage: 100, phase: "mixing-voiceover" });
			const [videoResponse, audioResponse] = await Promise.all([
				fetch(toFileUrl(outPath)),
				fetch(toFileUrl(request.audioPath)),
			]);
			if (!videoResponse.ok) {
				throw new Error(`Failed to read the exported video back for mixing: ${outPath}`);
			}
			if (!audioResponse.ok) {
				throw new Error(`Failed to read voiceover file: ${request.audioPath}`);
			}
			const mixed = await mixVoiceoverIntoVideo(await videoResponse.blob(), {
				voiceoverData: await audioResponse.arrayBuffer(),
				mode: request.audioMode,
				offsetSec: request.audioOffsetSec,
			});
			const saveResult = await window.electronAPI.writeExportToPath(
				await mixed.arrayBuffer(),
				outPath,
			);
			if (!saveResult.success) {
				throw new Error(saveResult.message ?? `Failed to write mixed output to ${outPath}`);
			}
		}

		return {
			success: true,
			outputPath: outPath,
			format,
			width: outDims.width,
			height: outDims.height,
		};
	} finally {
		unsubscribeProgress?.();
	}
}

export function CliExportRunner() {
	const startedRef = useRef(false);
	const [status, setStatus] = useState("Starting export…");

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;

		void (async () => {
			try {
				const request = (await window.electronAPI.cliGetRequest()) as CliExportRequest;
				if (request.kind !== "export") {
					throw new Error(`cli-export window received a ${request.kind} request`);
				}
				setStatus(`Exporting ${request.projectPath}…`);
				const result = await runExport(request);
				await window.electronAPI.cliDone(result);
			} catch (error) {
				const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
				await window.electronAPI.cliDone({ success: false, error: message });
			}
		})();
	}, []);

	return (
		<div className="flex h-screen items-center justify-center bg-[#09090b] text-white/60 text-sm">
			{status}
		</div>
	);
}

export default CliExportRunner;
