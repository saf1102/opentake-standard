import { useMemo, useState } from "react";
import { getAssetPath } from "@/lib/assetPath";
import { getSmoothedCursorPath } from "@/lib/cursor/cursorPathSmoothing";
import { resolveCursorSprites } from "@/lib/cursor/cursorThemes";
import type {
	CursorRecordingData,
	CursorRecordingSample,
	NativeCursorType,
} from "@/native/contracts";
import { useCursorRecordingData } from "@/native/hooks/useCursorRecordingData";
import styles from "./VirtualPreview.module.css";

const CLICK_BOUNCE_MS = 260;

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

/** Native press (-0.24) then rebound (+0.16) envelope for the most recent click. Exported so the browser
 * fallback's timing stays deterministic under test. */
export function cursorClickBounceAt(samples: CursorRecordingSample[], timeMs: number): number {
	let index = samples.length - 1;
	while (index >= 0 && samples[index].timeMs > timeMs) index--;
	for (; index >= 0; index--) {
		const age = timeMs - samples[index].timeMs;
		if (age > CLICK_BOUNCE_MS) break;
		if (samples[index].interactionType === "click") {
			const t = age / CLICK_BOUNCE_MS;
			return t < 0.38
				? -0.24 * Math.sin((t / 0.38) * Math.PI)
				: 0.16 * Math.sin(((t - 0.38) / 0.62) * Math.PI);
		}
	}
	return 0;
}

// Match the installed compositor's theme sprites, including Default. Captured
// OS bitmaps have different outlines and hotspots and are not its export art.
function spriteSource(
	_data: CursorRecordingData,
	sample: CursorRecordingSample | null,
	themeId: string,
) {
	const sprites = resolveCursorSprites(themeId);
	const sprite = sprites[(sample?.cursorType ?? "arrow") as NativeCursorType] ?? sprites.arrow;
	return {
		src: getAssetPath(sprite.assetPath),
		hotspotX: sprite.hotspotX,
		hotspotY: sprite.hotspotY,
	};
}

interface BrowserCursorPreviewProps {
	videoPath: string | null;
	frameShortSide: number;
	previousFrame?: { x: number; y: number; width: number; height: number };
	padding: number;
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
	frameShortSide,
	previousFrame,
	padding,
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
	const [imageSize, setImageSize] = useState({ src: "", aspect: 1 });
	const { data } = useCursorRecordingData(show ? videoPath : null);
	const path = useMemo(() => getSmoothedCursorPath(data, smoothing), [data, smoothing]);
	const timeMs = sourceTimeSec * 1000;
	const state = data ? cursorStateAt(data.samples, timeMs) : null;
	const position = path?.sampleAt(timeMs) ?? null;
	const sprite = data && position ? spriteSource(data, state, themeId) : null;

	if (!show || !data || !path || !position || !sprite || state?.visible === false) return null;

	const cropX = (position.cx - cropRegion.x) / Math.max(0.0001, cropRegion.width);
	const cropY = (position.cy - cropRegion.y) / Math.max(0.0001, cropRegion.height);
	if (cropX < 0 || cropX > 1 || cropY < 0 || cropY > 1) return null;

	const aspect = imageSize.src === sprite.src ? imageSize.aspect : 1;
	const bounce = cursorClickBounceAt(data.samples, timeMs);
	const bounceScale = 1 + bounce * Math.max(0, clickBounce);
	const cursorSize =
		(34 / 1080) * frameShortSide * Math.max(0.1, size) * bounceScale * (1 - (padding / 100) * 0.4);
	const trailStrength = Math.min(1, Math.max(0, motionBlur));
	const taps = Math.round(1 + trailStrength * 10);
	const trailTimes = Array.from({ length: taps }, (_, i) => i);
	// Official 2.1.2 uses a shutter fraction of its 60 Hz compositor step.
	// The old multi-frame lookback produced ghost arrows absent from the MP4.
	const previous = path.sampleAt(timeMs - (trailStrength / 60) * 1000) ?? position;

	return (
		<div
			className={styles.cursorPreviewLayer}
			data-testid="browser-cursor-preview"
			aria-hidden="true"
			style={{ overflow: clipToBounds ? "hidden" : "visible", isolation: "isolate" }}
		>
			{trailTimes.map((step) => {
				const f = taps === 1 ? 1 : step / (taps - 1);
				const prior = previousFrame ?? { x: 0, y: 0, width: 1, height: 1 };
				const px =
					prior.x +
					((previous.cx - cropRegion.x) / Math.max(0.0001, cropRegion.width)) * prior.width;
				const py =
					prior.y +
					((previous.cy - cropRegion.y) / Math.max(0.0001, cropRegion.height)) * prior.height;
				const x = (px + (cropX - px) * f) * 100;
				const y = (py + (cropY - py) * f) * 100;
				return (
					<img
						key={step}
						className={styles.cursorPreviewSprite}
						src={sprite.src}
						onLoad={(event) => {
							const img = event.currentTarget;
							const aspect = img.naturalWidth / img.naturalHeight;
							setImageSize((old) =>
								old.src === sprite.src && old.aspect === aspect ? old : { src: sprite.src, aspect },
							);
						}}
						alt=""
						draggable={false}
						style={{
							left: `${x}%`,
							top: `${y}%`,
							width: `calc(${cursorSize * Math.min(1, aspect)}px / var(--cursor-camera-scale, 1))`,
							maxWidth: `calc(${cursorSize}px / var(--cursor-camera-scale, 1))`,
							height: `calc(${cursorSize / Math.max(1, aspect)}px / var(--cursor-camera-scale, 1))`,
							maxHeight: `calc(${cursorSize}px / var(--cursor-camera-scale, 1))`,
							objectFit: "contain",
							opacity: 1 / taps,
							mixBlendMode: "plus-lighter",
							transform: `translate(${-sprite.hotspotX * 100}%, ${-sprite.hotspotY * 100}%)`,
						}}
					/>
				);
			})}
		</div>
	);
}
