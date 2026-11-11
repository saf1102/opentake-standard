// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../contexts/I18nContext";
import { LOCALE_STORAGE_KEY } from "../i18n/config";
import { LinkReaderI18nProvider } from "./I18nProvider";

function State() {
	const { locale, setLocale, systemLocaleSuggestion, t } = useI18n();
	return <><output data-testid="locale">{locale}</output><output data-testid="suggestion">{systemLocaleSuggestion ?? "none"}</output><span>{t("launch.recording.saving")}</span><button onClick={() => setLocale("en")}>English</button></>;
}

describe("OpenTake embedded recording language", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
		window.electronAPI = { setLocale: vi.fn().mockResolvedValue(undefined) } as unknown as typeof window.electronAPI;
	});
	afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

	it("uses Chinese on a clean English system and sends it to the native menus", async () => {
		render(<LinkReaderI18nProvider><State /></LinkReaderI18nProvider>);
		expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
		expect(screen.getByTestId("suggestion").textContent).toBe("none");
		expect(screen.getByText("正在保存...")).toBeTruthy();
		await waitFor(() => expect(window.electronAPI.setLocale).toHaveBeenCalledWith("zh-CN"));
		expect(document.documentElement.lang).toBe("zh-CN");
	});

	it("respects stored English without suggesting the system language", () => {
		localStorage.setItem(LOCALE_STORAGE_KEY, "en");
		vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
		render(<LinkReaderI18nProvider><State /></LinkReaderI18nProvider>);
		expect(screen.getByTestId("locale").textContent).toBe("en");
		expect(screen.getByTestId("suggestion").textContent).toBe("none");
	});

	it("keeps a manual choice after remount", () => {
		const view = render(<LinkReaderI18nProvider><State /></LinkReaderI18nProvider>);
		fireEvent.click(screen.getByText("English"));
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
		view.unmount();
		render(<LinkReaderI18nProvider><State /></LinkReaderI18nProvider>);
		expect(screen.getByTestId("locale").textContent).toBe("en");
	});

	it("leaves the standalone English default and system-language suggestion intact", async () => {
		vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
		render(<I18nProvider><State /></I18nProvider>);
		expect(screen.getByTestId("locale").textContent).toBe("en");
		await waitFor(() => expect(screen.getByTestId("suggestion").textContent).toBe("zh-CN"));
	});

	it("falls back to Chinese for an invalid stored locale", () => {
		localStorage.setItem(LOCALE_STORAGE_KEY, "not-a-locale");
		render(<LinkReaderI18nProvider><State /></LinkReaderI18nProvider>);
		expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
	});
});
