# OpenTake Standard

安装与使用正文由任务 11 补充。当前开发启动命令：`npm ci && npm start`。需要 Node.js 24、LGPL FFmpeg、Playwright Chromium、Python 3 + numpy，以及用户自己的 Codex CLI。

## Desktop development

`npm ci && npm start` opens the OpenTake Standard desktop window. `npm run dev` runs the web development server. `npm run build:app` builds an unsigned local macOS App under `release/`; drag OpenTake Standard.app into Applications to use it. It does not create an installer or publish anything. Media runtimes must already be installed; full setup instructions follow in task 11.

Electron downloads from its official source by default. If needed, opt into a mirror for installation:

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci
```

## Recording and OpenScreen export

Install OpenScreen separately. Standard discovers `openscreen` on PATH, the macOS Applications folders, or an explicit `OPENSCREEN_BIN` executable. The tested official release is 2.1.2 (macOS arm64). Official 1.10.0 rejects schema v7 exports. MP4 export uses H.264 and explicitly passes the selected 24/30/60 fps. The embedded editor saves projects locally; recording and export invoke the installed OpenScreen process and its own renderer. Standard does not bundle or borrow its native compositor. Missing or incompatible installations report an error and preserve the project; no alternative renderer is used. An installation being detected is not proof of export compatibility.

Grant screen/audio recording permission to OpenScreen when macOS requests it. You can still import and edit recordings in Standard without the external App, but native export requires it. No automatic OpenScreen or native SDK downloads are performed.

## Upgrade privacy

Standard editing requires no account. Upgrade checks fetch public configuration when opening the upgrade dialog and once daily by default; disable daily checks in Settings. The public configuration request carries no account information. Upgrade sign-in stores a session only in the user data directory, never in projects or logs; passwords are not stored. The fallback is `https://raw.githubusercontent.com/saf1102/opentake-standard/main/upgrade.json`; until this public file exists, both unavailable sources fall back to built-in beta mode.
