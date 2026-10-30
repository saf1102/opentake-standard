# OpenTake Standard 安装与验收

先完整读 README.md，按其中 macOS 安装步骤依次执行。仓库是公开的，不需要 GitHub 登录。不要读取用户的密码、令牌或私钥；智能体登录与 API 密钥输入由用户自行完成，不代读登录凭据。

macOS 首次安装运行 npm run setup：检查系统、芯片、Node 与磁盘，安装根目录和 vendor/openscreen 两份锁定依赖、匹配的 Playwright Chromium、独立 Python + numpy，并执行 build:live。随后运行 typecheck、test；用户在设置接通智能体后，运行 npm run doctor。任何一步非零退出都不能当作成功。可重复运行 setup，不用 sudo，不清空旧构建。npm start 打开原生 Standard 窗口；验收实际首页与录屏运镜编辑器，不把构建通过当作功能验收。

OpenScreen 由用户从官方发布页 https://github.com/getopenscreen/openscreen/releases 下载安装，推荐已验证的 2.1.2。不要从第三方镜像下载，不自动授权屏幕录制；需要权限时请用户在系统界面操作。

不使用 sudo、不修改系统设置、不覆盖同名 App 或用户工程、不安装无关工具。缺运行库按 README 处理并说明影响。先用隔离工程验证保存、重开与导出；任何失败都保留工程和日志，说明下一步，不能声称全部完成。

本机 App 用 npm run build:app 构建，在 release 中验收；构建包含无需证书或私钥的本机临时签名；没有公开发布或苹果公证动作。默认用户工程位置与 Pro 共用；测试设置独立 OPENTAKE_STANDARD_USER_DATA 和 LINK_READER_PROJECTS_DIR。

仅支持 macOS（Apple 芯片）。Windows：适配中，暂不支持；不在本版本运行 Windows 构建、安装或更新。

## 更新到最新版

1. 读 README、package.json 和 upgrade.json。先读其中 endpoint 的 `/standard/upgrade.json`，失败再读 `https://raw.githubusercontent.com/saf1102/opentake-standard/main/upgrade.json`。从 `standard` 取得 version、notes、url、sha256；无可用清单则停止，不猜版本或下载地址。
2. 只下载 HTTPS 源码 ZIP；核对 SHA-256 与清单完全一致，失败不安装。不读取登录令牌或私钥，不把用户身份附在下载请求中。
3. 保留正在用的旧 App 和源码，先检查 git status。工作区有改动必须保留 diff，在新目录处理，绝不 reset/clean 或覆盖用户更改。不要写工程、素材、agent-settings.json、system-settings.json、upgrade-session.json。
4. 解压到全新目录，拒绝路径穿越和符号链接。核对 package.json 的 name 为 opentake-standard，版本等于清单；完整阅读新包 AGENTS.md。分别 npm ci、npm --prefix vendor/openscreen ci --ignore-scripts，再 typecheck、test、build:app。失败保留旧版本与日志，不切换 App。
5. 退出旧版前确认没有运行任务。备份旧 Standard App 到 Standard 用户数据 backups，保留最近两份成功备份。Mac 用独立候选路径验证启动及 API、工程副本读取，再替换指定的 Standard App；启动失败立即退出候选并换回旧 App，再启动旧版。不要碰 OpenTake Pro 或日常 OpenTake.app。
6. 验证真实运行版本、旧工程/设置保留、再次重启不重复更新，记录哈希和结果。不要仅以 npm 成功宣称更新完成。1.0.0 没有自动提醒，这一跳使用上述智能体流程。


### FFmpeg 环境检查

安装后先运行 `npm run doctor`，也可到“关于与更新 → FFmpeg 环境检查”查看两个程序的版本和路径。必须在同一目录找到可执行的 ffmpeg 与 ffprobe。按 LINKREADER_BIN_DIR、登录 shell PATH、当前 PATH、macOS 常见安装目录依次查找。缺失时以亮紫提示具体缺项和已查目录；没有“运行工具目录”设置项。macOS 可运行 `brew install ffmpeg`。FFmpeg 由用户安装，不下载或打包进 Standard。

### macOS 出片前检查

点“开始生成”后，程序先实际检查 Python 3 + numpy、HyperFrames Chromium 的启动与页面截图、FFmpeg / ffprobe 和 Codex 登录。缺项用亮紫提示安装命令，保留输入；修好后点“重新检查”，全部通过才开始。`npm run doctor` 和“关于与更新 → 出片工具环境检查”使用同一套检查。

Python 推荐独立环境：`python3 -m venv "$HOME/.opentake-venv" && "$HOME/.opentake-venv/bin/python3" -m pip install numpy`。程序会优先检查这个环境；也可在启动前设置 `LINKREADER_PYTHON` 为自己的解释器绝对路径。检查与智能体均禁用用户 site-packages，不修改系统 Python。

Chromium：在 Standard 源码目录运行 `npx --no-install playwright-core install chromium`。默认使用当前锁定 Playwright 对应的 headless shell，服务端渲染模式在应用进程中单独检查；Codex 的本地 sandbox 命令只检查单进程样张模式（不调用模型、不消耗 token），不要求多进程渲染模式在沙盒内启动。指定路径可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`；存在却无法启动也会拦住，不自动查找其他 App 或临时目录。

检查通过后，工程 `.opentake/bin/` 包装脚本与 `.opentake/tools.json` 固定使用本轮确认的路径；工具中途失效应报告，不让智能体安装依赖或另找程序。`build:live` 保留已打开窗口引用的旧资源。

## 统一接入与能力边界

两种接法由同一设置组件管理：命令行账号登录、API 密钥。只列已接通的智能体，模型跟随各家默认；无效模型回退时应有提示。只有 API 密钥、没有支持的命令行，不能执行出片。Codex 与 Claude Code 的出片走共用适配层，其余标为待适配的不得承诺可用。

Claude Code 默认关闭；不要替用户开启或使用订阅账号。需要时由用户在界面确认风险，推荐 API 密钥。测试 Claude Code 及其他 Agent / 服务时只检查连通，不运行任务、不消费生成额度；真实出片验收仅使用 Codex 命令行；所有 API（含 Codex）仅测连通。任务17 connect 隐藏输入密钥，仅内存传给一次性测试接口，不进文件、日志、钥匙串、参数或环境变量；回车跳过记未实测。产品日常保存接入的密钥仅存 macOS 钥匙串，不写设置、日志、截图或工程；不改用户的 ~/.codex 或 ~/.claude。

setup 成功只证明安装步骤完成。还须在隔离工程验证首页、通用剪辑真实出片与导出、录屏引导；缺 OpenScreen 时确认下载提示。安装好后用「重新检测」与 doctor 检查，不自动授权系统权限。FFmpeg 缺失请按 README 安装，不从未确认的源下载。网络失败保留目录重试，磁盘不足不代删用户文件。

## 常见问题：打开提示「已损坏」

只修复自己从官方 OpenTake Standard 源码构建的 App。旧版构建可能在改名后留下失效的 Electron 签名；浏览器下载带来的隔离标记会使问题显现。新版 `npm run build:app` 在装配后先清理产物扩展属性，再做本机临时签名，最后严格验签；任何一步失败都不能把产物当作安装成功。不要关闭 Gatekeeper，不用 sudo，也不要对来路不明的 App 执行修复。

在包含本修正的源码目录运行（Apple 芯片）：

```sh
npm run build:app
/usr/bin/codesign --verify --deep --strict "$PWD/release/mac-arm64/OpenTake Standard.app"
npm run doctor
```

如果只需修复本源码目录里已经生成的 App，先正常退出该 Standard App，再运行：

```sh
node desktop/sign-local-app.cjs "$PWD/release/mac-arm64/OpenTake Standard.app"
/usr/bin/codesign --verify --deep --strict "$PWD/release/mac-arm64/OpenTake Standard.app"
```

修复工具仅处理指定的 Standard App：先 `xattr -cr` 清理产物，再由 Electron 签名工具从内到外签名，最后执行 `codesign --verify --deep --strict` 并确认没有 `com.apple.quarantine`。它不修改源码、工程或系统安全策略。旧源码没有此脚本时，先取得包含修正的官方源码并重新构建，不跳过错误。`doctor` 默认检查本目录 `release/` 中的产物；检查其他明确的 Standard 测试副本可设置 `OPENTAKE_STANDARD_CHECK_APP` 为其绝对路径。

这只是本机临时签名，不是 Developer ID 签名或苹果公证；`spctl -a -vv` 的分发策略结果要单独记录，不能把清理隔离标记写成“公证通过”。安装验收仍须实际打开 App，确认没有「已损坏」提示、窗口和本机服务正常；仅 `open` 返回0不算成功。
