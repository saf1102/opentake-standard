import path from "node:path";
import { defineConfig } from "vitest/config";

// Public Standard ships these focused regressions alongside the implementation.
// Keep this separate from upstream's complete development test configuration.
export default defineConfig({
	test: {
		environment: "node",
		include: [
			"src/lib/zoomMath/standard-parity.test.ts",
			"src/components/ai-edition/BrowserCursorPreview.test.ts",
		],
	},
	resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
