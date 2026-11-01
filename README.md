# OpenTake Standard

本地 Windows 1.0.2 完整离线安装器的构建、安装和随包运行库见 [WINDOWS-INSTALLER.md](WINDOWS-INSTALLER.md)。此安装器包含 FFmpeg、Python 科学计算库、OpenScreen、Chromium Headless Shell 与 Codex CLI，自动从安装目录定位；下文要求单独准备依赖的步骤适用于源码运行和原有 build:app。本地 Windows 适配保留已验收的故障修复，版本展示与官方 v1.0.2 标签对齐；未从 GitHub main 覆盖或宣称已合入该标签所有功能。安装器未签名、未发布。

当前完整安装器的重建步骤和最终输出位置见 [BUILD-WINDOWS.md](BUILD-WINDOWS.md)。

免费的本地视频工具：通用剪辑与录屏运镜。编辑不需要 OpenTake 账号；生成视频使用你自己的 Codex CLI。Pro 功能不包含在本仓库。

**[下载最新官方源码 ZIP](https://github.com/saf1102/opentake-standard/releases/latest/download/OpenTake-Standard-source.zip)** · [核对 SHA-256](https://github.com/saf1102/opentake-standard/releases/latest/download/OpenTake-Standard-source.zip.sha256) · [查看每日下载统计](https://github.com/saf1102/opentake-standard/tree/repository-stats)

这是源码，需要在自己的电脑安装依赖并构建，不是预编译安装包。推荐使用上面的官方 Release 附件；GitHub 的绿色 Code → Download ZIP 也能取源码，但那个入口没有可用下载计数。统计显示请求次数，不是用户人数或安装成功数，App 不上报使用遥测。[统计口径](DOWNLOAD-STATS.md)

## 安装（macOS / Apple 芯片）

对你的智能体说：**按这个仓库的 AGENTS.md 帮我装好 OpenTake Standard。**

先安装 Node.js 24.15.0 或更新的 24.x（含 npm）、Python 3 和 numpy、FFmpeg 与 ffprobe；生成视频还需要已安装并登录的 Codex CLI。录屏运镜的录制和导出需要另外安装官方 OpenScreen 2.1.2 或兼容版本，见下节。不要用 sudo，也不要关闭系统安全保护。

```sh
# 将官方源码 ZIP 解压后，进入源码目录
cd opentake-standard
npm ci
npm --prefix vendor/openscreen ci --ignore-scripts
npx --no-install playwright-core install chromium
npm run typecheck
npm test
npm run build
npm start
```

也可以用 Git 获取源码：`git clone https://github.com/saf1102/opentake-standard.git`，然后进入目录执行上面的安装步骤。已有 Git 工作目录可继续按 Git 更新；ZIP 快照不会包含 Git 历史。

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

## Windows 本地适配预览（尚未发布、尚未实机验收）

Windows 10 22H2 x64 和 Windows 11 x64 共用这份源码；暂不支持 Windows ARM64 或 32 位。Mac 安装步骤保持不变。本节不是已通过 Windows 兼容性验收的声明。

在 PowerShell 中按前面的两份 `npm ci`、Playwright Chromium、typecheck、test、build 顺序安装，然后 `npm start`。先设置隔离目录，勿使用真实工程：

```powershell
$env:OPENTAKE_STANDARD_USER_DATA = Join-Path $env:LOCALAPPDATA 'OpenTake-Windows-QA'
$env:LINK_READER_PROJECTS_DIR = Join-Path $env:USERPROFILE 'Videos\OpenTake-Windows-QA'
npm start
```

- 准备 Node 24.x、Python 3 与 numpy、FFmpeg/ffprobe 的 Windows 可执行文件和官方 OpenScreen。FFmpeg 必须包含 `h264_mf`；运行 `ffmpeg -h encoder=h264_mf` 检查，实际短片导出仍须验证。不要用 GPL 编码器替代缺失依赖。
- 从源码构建 Windows 录制组件还需要 Visual Studio 2022/2026 的 C++ x64 工具、C++ CMake 工具和 Windows SDK。已有工具优先，构建脚本不自动下载或安装。`npm run build` / `build:app` 会先编译 `vendor/openscreen-wgc` 的固定版本源码；也可单独运行 `npm run build:native`。Mac 跳过这一步。缺组件会明确失败，不静默使用有时间偏移的采集器。
- 工具目录可由 `LINKREADER_BIN_DIR` 指定；解释器可由 `LINKREADER_PYTHON` 指向 `python.exe`；OpenScreen 可由 `OPENSCREEN_BIN` 指向官方安装目录中的 `Openscreen.exe`。
- Codex 优先发现原生 `codex.exe`，含常见 npm 安装的原生程序位置。可以在设置中选原生可执行文件；暂不将任意 `.cmd` 当作可安全直接启动的 CLI。
- 生成与审片使用 Codex 的原生 Windows `elevated` 沙盒（执行命令仍为低权限），分别保持工程可写和审片只读边界。需先由用户按 Codex 官方说明完成沙盒初始化；Standard 不自动请求管理员权限、不修改系统安全设置。只登录账号、能列出模型，不能证明生成所需的沙盒已就绪。
- `npm run build:app` 在 Win10 生成 `release/win10/win-unpacked`，在 Win11 生成 `release/win11/win-unpacked`。目前只是本地未签名目录程序，不是已验收安装器。两者依赖同一份源码，仍需分别验收。
- Windows 配置默认在 `%APPDATA%\OpenTake Standard`，工程默认在用户的 `Videos\LinkReader Projects`；已有显式路径设置优先，不迁移或删除旧工程。
- Windows Pro 尚未提供；下载接口会明确拒绝，避免拿到 Mac DMG。

Windows 的“开始录屏”在 Standard 内选择窗口或屏幕，并显示独立的“OpenTake 录制控制”窗口。停止按钮、OpenTake 托盘的“停止并保存录制”、应用“录制”菜单和 Ctrl+Shift+F9 都控制同一段录制；快捷键被占用时控制栏会提示。还可选择 15/30/60 秒后自动保存。录制委托官方 OpenScreen 的 record 命令，停止使用其正常保存协议，鼠标数据、工程和导出仍由官方运行库生成，不修改官方 App 或关闭窗口保护。Mac 继续使用原 OpenScreen 录制入口。

这是为 UU远程等无法显示官方受保护悬浮栏的环境提供的 Standard 控制入口。只录制一个窗口时，独立控制栏不属于该窗口画面；录制整个屏幕时控制栏可能入镜，可先隐藏后使用快捷键或托盘停止。关闭 Standard 主窗口时，正在进行的录制会先停止并保存，再退出。不要把旧入口的“停止接收”当作停止采集。

点击停止后，按钮立即显示“正在停止并保存…”，后台确认保存完成后变为绿色“录制已保存”。停止请求失败会显示原因并允许重试；迟到的旧状态不会重新启用已经保存录制的停止按钮。

Windows 录制由官方 CLI 调用本地源码构建的 WGC 采集组件，使用其原有 helper 路径接口，不修改已安装的官方程序。组件保留每帧的真实录制时钟，在原生保存完成前修正并复核 MP4 分段时长及跳转索引；返回的原定 MP4 路径就是校时结果，独立使用此组件也不依赖 Standard 补救。校时前文件保留为 `.capture-raw-<pid>-<序号>.mp4`，逐帧时钟和鼠标文件保留；编码画面与鼠标时间戳不拉伸、不重编。Standard 会独立复核，已正确的文件不再复制；较早录制若有完整时钟，仍可生成 `.clock-fixed.mp4` 副本。帧数、时钟或文件格式不匹配时会报错并保留材料，不把它标成成功。校验上限为 2 小时、100 万帧、单个元数据块 8 MB。旧录制若没有逐帧时钟，无法可靠恢复已丢失的间隔；请保留原文件重新录制。负载导致的画面停顿仍可能存在，校时不会补造画面。

Windows 编码器偶发输出的零视频帧时长同样按独立采集时钟校正；没有对应时钟或帧数不符时仍拒绝猜测。收尾前先持久保存 `.clock.json.pending` 检查点，完成校验后才发布状态为 `complete` 的 `.clock.json`；失败状态或检查点不能作为成功录制导入。工程的 `analysis/openscreen/host-sessions/<会话>.diagnostic.json` 保存有界的本次录制协议、退出状态和错误输出，不包含启动环境或命令参数，便于保留失败原因。重新录制使用新文件，不覆盖失败样本。

必须在 Windows 10 和 11 分别检查：中文及空格路径、普通权限首次启动、保存重开、Agent 15 秒生成与样张自查、通用剪辑 MP4、OpenScreen 新录制/导入/鼠标预览与导出一致性、取消导出后无残留进程、退出重启、缺依赖提示。用工程副本；录屏系统授权由使用者操作。不关闭系统安全保护、不使用管理员权限绕过失败。
