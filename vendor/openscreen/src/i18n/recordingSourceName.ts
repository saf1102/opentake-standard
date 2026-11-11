type Translator = (key: string, vars?: Record<string, string | number>) => string;

/** Translate Chromium's generated display labels, never an application's window
 * title or a device manufacturer's name (those identify the capture target). */
export function recordingSourceName(name: string, id: string, t: Translator): string {
	if (!id.startsWith("screen:")) return name;
	// English mode keeps Chromium's own wording (including "Display N").
	const entireScreen = t("recordingSource.entireScreen");
	if (entireScreen === "Entire Screen" || entireScreen === "recordingSource.entireScreen") return name;
	if (/^Entire Screen$/i.test(name)) return t("recordingSource.entireScreen");
	const numbered = /^(?:Screen|Display) (\d+)$/i.exec(name);
	if (numbered) return t("recordingSource.numberedScreen", { number: numbered[1] });
	return name;
}
