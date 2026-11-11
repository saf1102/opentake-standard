type Translator = (key: string, vars?: Record<string, string | number>) => string;
const errorKeys: Record<string, string> = {
	"Failed to stop recording": "stopFailed",
	"Failed to save recording": "saveFailed",
	"Failed to start recording": "startFailed",
	"Failed to toggle pause state": "pauseFailed",
	"Webcam not saved. The screen recording was kept.": "webcamNotSaved",
	"Video track is not available.": "videoTrackUnavailable",
	"Windows Graphics Capture requires Windows 10 build 19041 or newer.": "windowsUnsupported",
	"Native Linux capture requires Linux.": "linuxRequired",
	"Native macOS capture requires macOS.": "macRequired",
	"Native Linux capture is already running.": "linuxRunning",
	"Native Windows capture is already running.": "windowsRunning",
	"Native macOS capture is already running.": "macRunning",
	"Native Linux capture helper is not available.": "linuxHelperMissing",
	"Native Windows capture helper is not available.": "windowsHelperMissing",
	"Native macOS capture helper is not available.": "macHelperMissing",
	"Native Windows capture request is missing a source.": "windowsSourceMissing",
	"Native macOS capture request is missing a source.": "macSourceMissing",
	"Native Linux capture is not running.": "linuxNotRunning",
	"Native Windows capture is not running.": "windowsNotRunning",
	"Native macOS capture is not running.": "macNotRunning",
	"Native Windows capture command channel is closed.": "windowsChannelClosed",
	"Native macOS capture command channel is closed.": "macChannelClosed",
	"Screen recording file is missing on disk.": "fileMissing",
	"No recorded video found": "noRecordedVideo",
	"Failed to store recording session": "storeFailed",
	"Failed to store recorded video": "storeVideoFailed",
	"Failed to get video path": "videoPathFailed",
	"Native macOS webcam attachment requires macOS.": "macWebcamRequired",
	"Native Linux webcam attachment requires Linux.": "linuxWebcamRequired"
};

/** Native libraries return diagnostic English, not UI text. Keep the full detail
 * in the caller's error log; show an actionable Chinese message in Chinese UI.
 * Other locales retain the upstream diagnostic until they have this translation. */
export function recordingErrorMessage(
	locale: string,
	t: Translator,
	detail: unknown,
	fallback: "startFailed" | "stopFailed" | "saveFailed" | "pauseFailed" | "webcamNotSaved",
): string {
	const message = detail instanceof Error ? detail.message : typeof detail === "string" ? detail : "";
	if (locale !== "zh-CN") return message || t(`recordingErrors.${fallback}`);
	if (/^(?:录制|录屏|无法|保存|读取|本次|原生|磁盘|屏幕|摄像头|麦克风|请|已有|当前|未|缺少|没有|Windows 录屏|macOS 录屏|Linux 录屏)/.test(message)) return message;
	const key = errorKeys[message];
	if (key) return t(`recordingErrors.${key}`);
	return t(`recordingErrors.${fallback}`);
}
