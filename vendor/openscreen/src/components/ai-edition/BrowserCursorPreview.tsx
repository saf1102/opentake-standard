import { useMemo } from "react";
import { getAssetPath } from "@/lib/assetPath";
import { getSmoothedCursorPath } from "@/lib/cursor/cursorPathSmoothing";
import { DEFAULT_CURSOR_THEME_ID, resolveCursorSprites } from "@/lib/cursor/cursorThemes";
import type {
	CursorRecordingData,
	CursorRecordingSample,
	NativeCursorType,
} from "@/native/contracts";
import { useCursorRecordingData } from "@/native/hooks/useCursorRecordingData";
import styles from "./VirtualPreview.module.css";

const CURSOR_BASE_SIZE_PX = 32;
const TRAIL_STEP_MS = 18;
const CLICK_BOUNCE_MS = 180;

/** Latest recorded cursor state at or before `timeMs`. Position smoothing is
 * handled separately; this lookup only supplies the sprite/visibility state. */
export function cursorStateAt(
	samples: CursorRecordingSample[],
	timeMs: number,
): CursorRecordingSample | null {
	let low = 0;
	let high = samples.length - 1;
	let result = -1;
	while (low <= high) {
		const mid = low + ((high - low) >> 1);
		if (samples[mid].timeMs <= timeMs) {
			result = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return result >= 0 ? samples[result] : null;
}

/** 0..1 bounce envelope for the most recent click. Exported so the browser
 * fallback's timing stays deterministic under test. */
export function cursorClickBounceAt(samples: CursorRecordingSample[], timeMs: number): number {
	let index = samples.length - 1;
	while (index >= 0 && samples[index].timeMs > timeMs) index--;
	for (; index >= 0; index--) {
		const age = timeMs - samples[index].timeMs;
		if (age > CLICK_BOUNCE_MS) break;
		if (samples[index].interactionType === "click") {
			return Math.sin((age / CLICK_BOUNCE_MS) * Math.PI);
		}
	}
	return 0;
}

function recordedCursorAsset(data: CursorRecordingData, sample: CursorRecordingSample | null) {
	if (!sample?.assetId) return null;
	return data.assets.find((asset) => asset.id === sample.assetId) ?? null;
}

function spriteSource(
	data: CursorRecordingData,
	sample: CursorRecordingSample | null,
	themeId: string,
) {
	// "Default" means the cursor that was actually recorded whenever its bitmap
	// travelled with the sidecar. A selected theme deliberately overrides it.
	const captured = themeId === DEFAULT_CURSOR_THEME_ID ? recordedCursorAsset(data, sample) : null;
	if (captured?.imageDataUrl) {
		return {
			src: captured.imageDataUrl,
			hotspotX: captured.width > 0 ? captured.hotspotX / captured.width : 0,
			hotspotY: captured.height > 0 ? captured.hotspotY / captured.height : 0,
		};
	}
	const cursorType = (sample?.cursorType ?? "arrow") as NativeCursorType;
	const sprites = resolveCursorSprites(themeId);
	const sprite = sprites[cursorType] ?? sprites.arrow;
	return {
		src: getAssetPath(sprite.assetPath),
		hotspotX: sprite.hotspotX,
		hotspotY: sprite.hotspotY,
	};
}

interface BrowserCursorPreviewProps {
	videoPath: string | null;
	sourceTimeSec: number;
	show: boolean;
	themeId: string;
	size: number;
	smoothing: number;
	motionBlur: number;
	clickBounce: number;
	clipToBounds: boolean;
	cropRegion: { x: number; y: number; width: number; height: number };
}

/** DOM cursor compositor used only by LinkReader's browser-hosted editor.
 * Electron renders the same sidecar in the native compositor; the browser has
 * no native view, so omitting this layer made every cursor control a saved but
 * visually inert setting. */
export function BrowserCursorPreview({
	videoPath,
	sourceTimeSec,
	show,
	themeId,
	size,
	smoothing,
	motionBlur,
	clickBounce,
	clipToBounds,
	cropRegion,
}: BrowserCursorPreviewProps) {
	const { data } = useCursorRecordingData(show ? videoPath : null);
	const path = useMemo(() => getSmoothedCursorPath(data, smoothing), [data, smoothing]);
	const timeMs = sourceTimeSec * 1000;
	const state = data ? cursorStateAt(data.samples, timeMs) : null;
	const position = path?.sampleAt(timeMs) ?? null;
	const sprite = data && position ? spriteSource(data, state, themeId) : null;

	if (!show || !data || !path || !position || !sprite || state?.visible === false) return null;

	const cropX = (position.cx - cropRegion.x) / Math.max(0.0001, cropRegion.width);
	const cropY = (position.cy - cropRegion.y) / Math.max(0.0001, cropRegion.height);
	if (clipToBounds && (cropX < 0 || cropX > 1 || cropY < 0 || cropY > 1)) return null;

	const bounce = cursorClickBounceAt(data.samples, timeMs);
	const bounceScale = 1 + bounce * Math.max(0, clickBounce) * 0.08;
	const cursorSize = CURSOR_BASE_SIZE_PX * Math.max(0.1, size) * bounceScale;
	const trailStrength = Math.min(1, Math.max(0, motionBlur));
	const trailTimes = trailStrength > 0 ? [2, 1] : [];

	return (
		<div
			className={styles.cursorPreviewLayer}
			data-testid="browser-cursor-preview"
			aria-hidden="true"
			style={{ overflow: clipToBounds ? "hidden" : "visible" }}
		>
			{trailTimes.map((step) => {
				const trailPosition = path.sampleAt(timeMs - TRAIL_STEP_MS * step);
				if (!trailPosition) return null;
				const x = ((trailPosition.cx - cropRegion.x) / Math.max(0.0001, cropRegion.width)) * 100;
				const y = ((trailPosition.cy - cropRegion.y) / Math.max(0.0001, cropRegion.height)) * 100;
				return (
					<img
						key={step}
						className={styles.cursorPreviewSprite}
						src={sprite.src}
						alt=""
						draggable={false}
						style={{
							left: `${x}%`,
							top: `${y}%`,
							width: cursorSize,
							opacity: trailStrength * (step === 1 ? 0.22 : 0.1),
							transform: `translate(${-sprite.hotspotX * 100}%, ${-sprite.hotspotY * 100}%)`,
						}}
					/>
				);
			})}
			<img
				className={styles.cursorPreviewSprite}
				src={sprite.src}
				alt=""
				draggable={false}
				style={{
					left: `${cropX * 100}%`,
					top: `${cropY * 100}%`,
					width: cursorSize,
					transform: `translate(${-sprite.hotspotX * 100}%, ${-sprite.hotspotY * 100}%)`,
				}}
			/>
		</div>
	);
}
