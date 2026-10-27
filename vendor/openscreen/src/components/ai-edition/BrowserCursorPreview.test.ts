import { describe, expect, it } from "vitest";
import type { CursorRecordingSample } from "@/native/contracts";
import { cursorClickBounceAt, cursorStateAt } from "./BrowserCursorPreview";

const samples: CursorRecordingSample[] = [
	{ timeMs: 0, cx: 0.1, cy: 0.2, cursorType: "arrow" },
	{ timeMs: 100, cx: 0.2, cy: 0.3, cursorType: "pointer", interactionType: "click" },
	{ timeMs: 260, cx: 0.3, cy: 0.4, cursorType: "text" },
];

describe("browser cursor preview timing", () => {
	it("uses the latest recorded cursor state at the playhead", () => {
		expect(cursorStateAt(samples, -1)).toBeNull();
		expect(cursorStateAt(samples, 99)?.cursorType).toBe("arrow");
		expect(cursorStateAt(samples, 100)?.cursorType).toBe("pointer");
		expect(cursorStateAt(samples, 999)?.cursorType).toBe("text");
	});

	it("produces a bounded click bounce and expires it", () => {
		expect(cursorClickBounceAt(samples, 100)).toBeCloseTo(0);
		expect(cursorClickBounceAt(samples, 149.4)).toBeCloseTo(-0.24);
		expect(cursorClickBounceAt(samples, 279.4)).toBeCloseTo(0.16);
		expect(cursorClickBounceAt(samples, 361)).toBe(0);
	});
});
