import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "../contexts/I18nContext";
import { installBrowserShims } from "../native/browserShim";
import { installLinkReaderBridge } from "./bridge";
import "../index.css";

function installUuidCompatibility() {
	if (typeof crypto.randomUUID === "function") return;
	const randomUUID = () => {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	};
	Object.defineProperty(crypto, "randomUUID", { configurable: true, value: randomUUID });
}

async function boot() {
	// LAN installations are normally served over plain HTTP. Chromium exposes
	// getRandomValues there but withholds randomUUID because the origin is not a
	// secure context. OpenScreen uses UUIDs throughout its document model.
	installUuidCompatibility();
	installBrowserShims();
	await installLinkReaderBridge();
	// App itself calls installBrowserShims at module scope. Import it only after
	// the LinkReader overrides are installed; the second shim call is then a no-op.
	const { default: App } = await import("../App.tsx");
	ReactDOM.createRoot(document.getElementById("root")!).render(
		<React.StrictMode>
			<I18nProvider>
				<App />
			</I18nProvider>
		</React.StrictMode>,
	);
}

void boot().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	document.getElementById("root")!.innerHTML = `<div style="padding:32px;color:#fecaca;font:14px system-ui">OpenScreen 启动失败：${message}</div>`;
	window.parent.postMessage({
		type: "error",
		projectId: new URLSearchParams(location.search).get("linkreaderProjectId") || "",
		payload: { message },
	}, location.origin);
});
