import path from "node:path";
import { defineConfig } from "vitest/config";

// Public Standard ships these focused regressions alongside the implementation.
// Keep this separate from upstream's complete development test configuration.
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: [
			"src/lib/zoomMath/standard-parity.test.ts",
			"src/components/ai-edition/BrowserCursorPreview.test.ts",
			"src/linkreader/I18nProvider.test.tsx",
			"src/i18n/__tests__/recordingChinese.test.ts",
			"src/i18n/__tests__/localeParity.test.ts",
			"src/hooks/useScreenRecorder.nativeStopFailure.test.tsx",
		],
	},
	resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
