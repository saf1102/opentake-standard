import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "/openscreen/",
	cacheDir: path.resolve(__dirname, ".vite-cache-linkreader"),
	plugins: [{
		name: 'linkreader-installed-fonts',
		enforce: 'pre',
		transform(code, id) {
			if (path.resolve(id.split('?')[0]) !== path.resolve(__dirname, 'src/index.css')) return null;
			return code.split('\n').filter(line => !line.startsWith('@import url("https://fonts.googleapis.com/')).join('\n');
		},
	}, react()],
	resolve: {
		alias: { "@": path.resolve(__dirname, "src") },
		dedupe: ["react", "react-dom", "react/jsx-runtime"],
	},
	build: {
		target: "esnext",
		outDir: path.resolve(__dirname, "../../public/openscreen"),
		emptyOutDir: true,
		rollupOptions: { input: path.resolve(__dirname, "linkreader.html") },
		chunkSizeWarningLimit: 1800,
	},
});
