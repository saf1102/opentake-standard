// Live-preview zoom transform for the new editor's CSS-based preview stack.
//
// Reuses the legacy editor's region math (`findDominantRegion`,
// `computeZoomTransform`) so zoom-in/out easing, region priority, and focus
// resolution stay identical between the two editors — only the output
// differs: a CSS translate/scale pair instead of a Pixi container transform.
//
// `computeZoomTransform` is called with a unit stage ({width:1, height:1}),
// which makes its pixel-space output already a fraction of the preview
// box — exactly what CSS `translate(x%, y%)` expects (percentages resolve
// against the transformed element's own layout box).

import type {
	CursorTelemetryPoint,
	CropRegion,
	ZoomFocus,
	ZoomRegion as LegacyZoomRegion,
} from "@/components/video-editor/types";
import { getZoomScale } from "@/components/video-editor/types";
import type { AxcutZoomRegion } from "@/lib/ai-edition/schema";
import { findDominantRegion } from "@/lib/zoomMath/zoomRegionUtils";
import { computeZoomTransform } from "@/lib/zoomMath/zoomTransform";
import { clampFocusToScale } from "@/lib/zoomMath/focusUtils";
import { locateVirtualPosition } from "./virtual-preview";
import type { AxcutClip } from "@/lib/ai-edition/schema";
import type { BrowserCameraTrack } from "@/lib/cursor/browserCameraFollow";

export interface ZoomPreviewTransform {
	scale: number;
	translateXPercent: number;
	translateYPercent: number;
}

export const IDENTITY_ZOOM_TRANSFORM: ZoomPreviewTransform = {
	scale: 1,
	translateXPercent: 0,
	translateYPercent: 0,
};

const UNIT_STAGE = { width: 1, height: 1 };
const UNIT_MASK = { x: 0, y: 0, width: 1, height: 1 };

function toLegacyZoomRegion(region: AxcutZoomRegion): LegacyZoomRegion {
	return {
		id: region.id,
		startMs: region.startMs,
		endMs: region.endMs,
		depth: region.depth,
		focus: region.focus,
		focusMode: region.focusMode,
		rotationPreset: region.rotationPreset,
		customScale: region.customScale,
		source: region.source,
	};
}

/**
 * Resolves the zoom transform to apply to the preview at a given point on
 * the virtual (edited) timeline. `virtualTimeMs` must be in the same
 * coordinate space as `zoomRegion.startMs`/`endMs` (the timeline shown in
 * the ruler, not raw source-media time).
 *
 * `playbackRate` scales the zoom-in/out transition windows in source-time
 * so the transition keeps its authored wall-clock duration inside speed
 * regions. Defaults to 1 (no scaling).
 */
export function computeZoomPreviewTransform(
	zoomRegions: AxcutZoomRegion[],
	virtualTimeMs: number,
	cursorTelemetry?: CursorTelemetryPoint[],
	playbackRate = 1,
): ZoomPreviewTransform {
	if (zoomRegions.length === 0) return IDENTITY_ZOOM_TRANSFORM;

	const legacyRegions = zoomRegions.map(toLegacyZoomRegion);
	const dominant = findDominantRegion(legacyRegions, virtualTimeMs, {
		cursorTelemetry,
		playbackRate,
	});
	if (!dominant.region || dominant.strength <= 0) return IDENTITY_ZOOM_TRANSFORM;

	const zoomScale = dominant.blendedScale ?? getZoomScale(dominant.region);
	const transform = computeZoomTransform({
		stageSize: UNIT_STAGE,
		baseMask: UNIT_MASK,
		zoomScale,
		zoomProgress: dominant.strength,
		focusX: dominant.region.focus.cx,
		focusY: dominant.region.focus.cy,
	});

	return {
		scale: transform.scale,
		translateXPercent: transform.x * 100,
		translateYPercent: transform.y * 100,
	};
}

/** The recording clock belongs to the active asset, including after trims or reordering. */
export function browserCursorFocusAt(
	clips: AxcutClip[], assetId: string | undefined, timeMs: number,
	path: { sampleAt(timeMs: number): ZoomFocus | null } | null,
): ZoomFocus | null {
	const position = locateVirtualPosition(clips, timeMs / 1000);
	if (!position || position.clip.assetId !== assetId || !path) return null;
	return path.sampleAt(position.sourceTimeSec * 1000);
}

/** Native Auto-Focus follows the pointer in the cropped screen, then maps that focus
 * into the padded canvas. Manual focus is already authored in canvas coordinates. */
export function computeBrowserZoomPreviewTransform(
	regions: AxcutZoomRegion[], timeMs: number,
	options: {
		autoFocusAll: boolean;
		cursorFocus: ZoomFocus | null;
		cameraTrack?: BrowserCameraTrack | null;
		sourceOffsetMs?: number;
		crop: CropRegion;
		screen: { x: number; y: number; width: number; height: number };
		canvas: { width: number; height: number };
		sourceSize: { width: number; height: number };
		reference?: { screen: { width: number; height: number }; canvas: { width: number; height: number } };
	},
	playbackRate = 1,
): ZoomPreviewTransform {
	const { cursorFocus, crop, screen, canvas, sourceSize } = options;
	// OpenScreen 2.1.2 caps total source magnification at 2x, measured at a
	// 1080-pixel short side. Preview size and export quality must not change this cap.
	const sourceWidth = Math.max(1, Math.round(sourceSize.width * crop.width));
	const sourceHeight = Math.max(1, Math.round(sourceSize.height * crop.height));
	const reference = options.reference ?? { screen, canvas };
	const baseMagnification = 1080 / Math.max(1, Math.min(reference.canvas.width, reference.canvas.height)) *
		Math.max(reference.screen.width / sourceWidth, reference.screen.height / sourceHeight);
	const maxScale = baseMagnification > 0 ? Math.max(1, Math.min(5,
		Math.floor(2 / baseMagnification * 100) / 100)) : 5;
	const resolved = regions.map(region => {
		const bounded = { ...region, customScale: Math.min(getZoomScale(region), maxScale) };
		if (!(options.autoFocusAll || region.focusMode === "auto")) return bounded;
		const window = (600 + 550 * Math.log(getZoomScale(bounded))) * Math.max(0.001, playbackRate);
		const offset = options.sourceOffsetMs ?? 0;
		const followed = options.cameraTrack?.focusAt(region.startMs - window + offset,
			timeMs + offset, region.endMs + window + offset, getZoomScale(bounded)) ?? cursorFocus;
		if (!followed) return bounded;
		const focus = clampFocusToScale({
			cx: (followed.cx - crop.x) / Math.max(0.0001, crop.width),
			cy: (followed.cy - crop.y) / Math.max(0.0001, crop.height),
		}, getZoomScale(bounded));
		return { ...bounded, focusMode: "manual" as const, focus: {
			cx: (screen.x + focus.cx * screen.width) / Math.max(1, canvas.width),
			cy: (screen.y + focus.cy * screen.height) / Math.max(1, canvas.height),
		} };
	});
	return computeZoomPreviewTransform(resolved, timeMs, undefined, playbackRate);
}
