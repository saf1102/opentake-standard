# OpenTake Standard 安装与验收

先完整读 README.md，按其中 macOS 安装步骤依次执行。仓库是公开的，不需要 GitHub 登录。不要读取用户的密码、令牌或私钥；Codex 登录由用户自行完成。

必须安装根目录和 vendor/openscreen 两份锁定依赖，准备匹配的 Playwright Chromium，再执行 typecheck、test、build。npm start 打开原生 Standard 窗口；验收实际首页与录屏运镜编辑器，不把构建通过当作功能验收。

OpenScreen 由用户从官方发布页 https://github.com/getopenscreen/openscreen/releases 下载安装，推荐已验证的 2.1.2。不要从第三方镜像下载，不自动授权屏幕录制；需要权限时请用户在系统界面操作。

不使用 sudo、不修改系统设置、不覆盖同名 App 或用户工程、不安装无关工具。缺运行库按 README 处理并说明影响。先用隔离工程验证保存、重开与导出；任何失败都保留工程和日志，说明下一步，不能声称全部完成。

本机 App 用 npm run build:app 构建，在 release 中验收；没有发布、签名或公证授权。默认用户工程位置与 Pro 共用；测试设置独立 OPENTAKE_STANDARD_USER_DATA 和 LINK_READER_PROJECTS_DIR。

仅支持 macOS（Apple 芯片）。Windows：适配中，暂不支持。

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
