import { afterEach, describe, expect, it } from "vitest";
import { mainT, setMainLocale } from "../../../electron/i18n";
import { translate } from "../loader";
import { recordingErrorMessage } from "../recordingError";
import { recordingSourceName } from "../recordingSourceName";

const zh = (key: string, vars?: Record<string, string | number>) => translate("zh-CN", "common", key, vars);
const en = (key: string, vars?: Record<string, string | number>) => translate("en", "common", key, vars);
afterEach(() => setMainLocale("en"));

describe("recording Chinese text", () => {
	it("translates native menus and permission dialogs using setLocale", () => {
		setMainLocale("zh-CN");
		for (const key of ["actions.stopRecording", "actions.cancel", "actions.saveDiagnostics", "recordingPermissions.accessibilityTitle", "recordingPermissions.accessibilityDetail", "recordingPermissions.systemSettings", "recordingPermissions.screenTitle", "recordingPermissions.screenDetail", "recordingErrors.windowsHelperMissing", "recordingErrors.windowsChannelClosed"]) {
			expect(mainT("common", key)).toMatch(/[\u3400-\u9fff]/u);
		}
		setMainLocale("en");
		expect(mainT("common", "actions.stopRecording")).toBe("Stop Recording");
	});

	it("uses actionable Chinese for native failures while keeping English preferences", () => {
		expect(recordingErrorMessage("zh-CN", zh, "Native Windows capture helper is not available.", "startFailed")).toBe("Windows 录屏组件不可用，请检查安装。");
		expect(recordingErrorMessage("zh-CN", zh, new Error("HRESULT 0x80004005"), "saveFailed")).toBe("保存录制失败，请保存诊断信息以便排查。");
		expect(recordingErrorMessage("zh-CN", zh, "Cannot open /录屏工程/output.mp4", "saveFailed")).toBe("保存录制失败，请保存诊断信息以便排查。");
		expect(recordingErrorMessage("en", en, new Error("HRESULT 0x80004005"), "saveFailed")).toBe("HRESULT 0x80004005");
		expect(recordingErrorMessage("zh-CN", zh, "录屏文件不存在", "saveFailed")).toBe("录屏文件不存在");
	});

	it("translates generated screen labels without altering window identities", () => {
		expect(recordingSourceName("Entire Screen", "screen:1:0", zh)).toBe("整个屏幕");
		expect(recordingSourceName("Screen 2", "screen:2:0", zh)).toBe("屏幕 2");
		expect(recordingSourceName("Screen 2", "window:2:0", zh)).toBe("Screen 2");
		expect(recordingSourceName("DELL U2720Q", "screen:2:0", zh)).toBe("DELL U2720Q");
	});

	it("has Chinese for the embedded recording guide without machine-specific port or OS", () => {
		for (const key of ["eyebrow", "title", "description", "step1Title", "step1Body", "step2Title", "step2Body", "step3Title", "step3Body", "notice", "launch", "launchHint", "readOnlyHint"]) {
			const value = translate("zh-CN", "editor", `rec.host.${key}`);
			expect(value).toMatch(/[\u3400-\u9fff]/u);
			expect(value).not.toMatch(/3010|Mac/);
		}
	});
});
