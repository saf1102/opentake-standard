# OpenTake Standard

免费的本地视频工具：通用剪辑与录屏运镜。编辑不需要 OpenTake 账号；生成视频使用你自己的 Codex CLI。Pro 功能不包含在本仓库。

## 安装（macOS / Apple 芯片）

对你的智能体说：**按这个仓库的 AGENTS.md 帮我装好 OpenTake Standard。**

先安装 Node.js 24.15.0 或更新的 24.x（含 npm）、Python 3 和 numpy、FFmpeg 与 ffprobe；生成视频还需要已安装并登录的 Codex CLI。录屏运镜的录制和导出需要另外安装官方 OpenScreen 2.1.2 或兼容版本，见下节。不要用 sudo，也不要关闭系统安全保护。

```sh
git clone https://github.com/saf1102/opentake-standard.git
cd opentake-standard
npm ci
npm --prefix vendor/openscreen ci --ignore-scripts
npx --no-install playwright-core install chromium
npm run typecheck
npm test
npm run build
npm start
```

两个 `npm ci` 都是必要步骤。第二个只安装内嵌编辑器的前端构建依赖，不编译 OpenScreen 原生合成器。`npm run build` 生成录屏编辑器资源；不能只装根目录依赖就直接启动。浏览器由锁定版本的 Playwright 从官方源安装。

日后在此目录运行 `npm start` 打开桌面窗口；`npm run dev` 仅启动网页开发服务。

### 生成本机 App

完成上面的安装后运行 `npm run build:app`，在 `release/` 下得到未签名的 `OpenTake Standard.app`。先在该位置双击验收，再自行拖到「应用程序」；已有同名 App 时先确认，不覆盖已有工程。此命令不生成安装包、不发布，也不包含媒体工具；FFmpeg、Python、Codex、OpenScreen 仍需在本机可用。

### 缺少工具时

- Node.js：从 [Node.js 官方站点](https://nodejs.org/) 安装 24.15.0 或更新的 24.x，重新开终端确认 `node --version`。
- FFmpeg：确认 `ffmpeg -version` 和 `ffprobe -version` 都成功。Standard 不分发 FFmpeg 二进制；请使用合适许可的构建。需要手动指定时，把含这两个程序的目录设为 `LINKREADER_BIN_DIR`。
- Python：确认 `python3 -c "import numpy"` 成功。缺 numpy 时可建立项目自己的虚拟环境：`python3 -m venv .venv`，再运行 `.venv/bin/python -m pip install numpy`；启动前将 `LINKREADER_PYTHON` 设为该解释器的绝对路径，不改系统 Python。
- Chromium：再次运行上面的 Playwright 安装命令；不要使用另一版本的缓存替代。
- OpenScreen：按下一节从官方发布页安装。没有它仍可使用通用剪辑。
- 网络失败：保留目录，网络恢复后重试失败的安装步骤。不要跳过失败步骤后声称安装完成。

测试或并行安装可显式设置 `OPENTAKE_STANDARD_USER_DATA`（配置目录）及 `LINK_READER_PROJECTS_DIR`（工程目录），都使用独立绝对路径。默认工程目录是 `~/Movies/LinkReader Projects`，卸载程序时不要删除工程目录。

## Recording and OpenScreen export

Install OpenScreen separately. Standard discovers `openscreen` on PATH, the macOS Applications folders, or an explicit `OPENSCREEN_BIN` executable. The tested official release is 2.1.2 (macOS arm64). Official 1.10.0 rejects schema v7 exports. MP4 export uses H.264 and explicitly passes the selected 24/30/60 fps. The embedded editor saves projects locally; recording and export invoke the installed OpenScreen process and its own renderer. Standard does not bundle or borrow its native compositor. Missing or incompatible installations report an error and preserve the project; no alternative renderer is used. An installation being detected is not proof of export compatibility.

Grant screen/audio recording permission to OpenScreen when macOS requests it. You can still import and edit recordings in Standard without the external App, but native export requires it. No automatic OpenScreen or native SDK downloads are performed.

## Upgrade privacy

Standard editing requires no account. Upgrade checks fetch public configuration when opening the upgrade dialog and once daily by default; disable daily checks in Settings. The public configuration request carries no account information. Upgrade sign-in stores a session only in the user data directory, never in projects or logs; passwords are not stored. The fallback is `https://raw.githubusercontent.com/saf1102/opentake-standard/main/upgrade.json`; if both sources are unavailable, the app falls back to built-in beta mode.

本机隔离验收可设置绝对路径 `OPENSCREEN_USER_DATA_DIR`。Standard 会用这个目录启动 OpenScreen，并且只扫描该目录内的 projects 和 recordings，避免导入日常录屏档案。未设置时保持 OpenScreen 的默认目录。
