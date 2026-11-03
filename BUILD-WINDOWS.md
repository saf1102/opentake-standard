# Windows 1.1.0 构建

源码基于官方 v1.1.0 / 786d2264db0fb29385c354a9890e96e961e2d57d，整合此前本地 Windows 树 9c66a205740c5f9120d61a2f031815091b404b92。Windows 适配、原生录屏时钟、渲染异常修复和安装器优化均保留。

目录：source 与 runtime-payload 同级。运行库按 WINDOWS-RUNTIME-LOCK.json、provenance.json 和 manifest.json 校验；不从用户 AppData 或工程复制凭据。固定官方 OpenScreen app.asar 的 SHA256 为 d325092fa699ae2d9eb2ef4a9dad930abde7b89a68ae07e3a8a0706d5c063537。

构建依赖 Node 24.x、Visual Studio 2022/2026 C++ x64、CMake 和 Windows SDK，以及 Rust MSVC、Git、LLVM/libclang。原生合成器重建会按固定版本及 SHA256 获取 OpenScreen 源码和 FFmpeg SDK；已有合成器仅在源码/二进制回执一致时复用。使用锁定依赖：

```powershell
npm ci --registry=https://registry.npmjs.org --replace-registry-host=always
npm --prefix vendor/openscreen ci --ignore-scripts --registry=https://registry.npmjs.org --replace-registry-host=always
# npm 12 阻止 Electron 生命周期脚本时，检查后运行锁定包安装器
node node_modules/electron/install.js
npx --no-install playwright-core install chromium
npm run typecheck
npm test
npm run build:installer
```

build:installer 编译 WGC、固定补丁的 OpenScreen 原生合成器、两套前端，更新独立运行库副本内的采集器及校验清单，然后生成 release/windows/OpenTake-Standard-Setup-1.1.0-x64.exe。其 win-unpacked 目录可单独启动验收。build:app 保留目录构建入口。

Windows 导出运行库由 `scripts/prepare-windows-export-runtimes.mjs` 按 `desktop/windows-export-runtime-lock.json` 下载并校验。它使用官方 Node.js ZIP 和 PyPI wheels，准备独立的 `export-node` 与 `jianying-python`；不执行 pip、不安装到系统 Python。安装器构建会自动调用此步骤。缓存位于同级 `runtime-downloads`，完整离线重建需预先准备锁定缓存。

剪映草稿可在未安装剪映时生成。Windows 导出后保留整个工程文件夹，退出剪映，再执行「导入剪映-Windows.cmd」；可在「导出默认值 → 剪映路径」设置自定义程序及草稿目录。导入器创建新 UUID 草稿、备份索引、使用进程互斥并在失败时回滚本次新草稿。它不会覆盖已有草稿，也不会自动启动或关闭剪映。实机打开和音画同步应在目标剪映版本单独验收。

通用导出子进程使用包含 Windows 延迟任务关闭修复的 Node.js 24.21.0；应用版本仍为 1.1.0。阶段、运行库版本、子进程退出码、经过脱敏的错误输出和异常栈保存在工程 `exports/.jobs/<任务编号>.diagnostics.jsonl`，失败清理临时目录后仍保留。错误输出按 UTF-8 或 Windows GB18030 解码，每个子进程管道有大小上限；不记录环境变量值。没有加入无限自动重试。

安装器保留分阶段界面、真实解压进度与关键文件校验，通过同盘重命名减少重复复制。许可、LGPL 对应源码、原始 OpenScreen helper 与运行库来源随包保留。产物不含测试工程、账号、密钥、node_modules 开发缓存或 Git 数据。

在独立配置和工程目录验收首页、智能体列表、编辑保存重开、实际录制、通用 MP4 和录屏 MP4、取消重试与退出清理。Win10、Win11 分别记录结果；虚拟显卡硬件解码失败不得标为通过。Windows 安装包未签名，支持 GitHub 检查更新后由用户手动下载安装，未实现一键自动替换。发布步骤见 WINDOWS-RELEASE.md。

本轮 QA 修复：统一 Windows 录屏窗口租约与只读导出；启用多工程库、录屏备份和恢复；修复中文工具包装脚本的固定路径与编码；取消或准备失败释放本任务暂存文件。`vendor/openscreen-compositor` 提供视频硬件初始化失败时的软件解码、系统内存帧编码回退源码补丁和故障注入测试，覆盖设备及编码帧池失败后的实际 MP4 完整解码。具体 Win10/Win11 验收范围以随包报告为准。

2026-11-02 文档复核修订：生成页面递归已有预检与有界修复，补验原始失败页面及完整 15 秒成片。Windows 安装和后续出片预检仅对应用安装树添加已有 CodexSandboxUsers 组的读取/执行权限，保留原 DACL 回执，不创建账户、不修改工程/父目录或沙盒策略；脚本加载、浏览器启动、页面加载、截图失败分别保留脱敏诊断。Windows 浏览器冷启动预检上限为 20 秒，截图表面暂未就绪的特定协议错误仅等待 250 毫秒重试一次，持续失败仍阻断。原生录屏记录实际采集/编码格式，视频媒体类型拒绝时尝试较低帧率及保持比例的有界缩放；原格式可用时不降低规格。最终失败立即回传原始 HRESULT。Win11 实测、原生编码矩阵和本轮未覆盖项目见随包报告。

2026-11-02 安装链接修订：智能体「去安装」「官方安装说明」等 HTTPS 链接交给系统默认浏览器打开，启动失败时明确提示；应用内链接仍在原窗口导航。外部网页不加载进工作台，不允许文件或自定义协议经此入口调用系统程序。

2026-11-02 Pro 提醒修订：Windows 中所有「升级到 Pro」入口统一打开「OpenTake Pro 开发中」提醒，沿用 macOS 升级对话框样式；首页卡片也直接打开提醒，关闭后保留当前工作页面。提醒不依赖网络或账号，不进入申请、登录和购买流程；Standard 的版本检查独立保留。

2026-11-02 智能体导航修订：Windows 的「已就绪」面板启用统一智能体卡片、安装链接、登录等待、定向设置与返回部署入口；通用剪辑首次选择和工作模块的智能体选择不再被 macOS 条件隐藏。工程内的选择器可直接打开对应接入设置，关闭设置仍留在原工程。就绪判断复用后端的出片能力条件，过旧版本或只有轻活能力的接入不算出片就绪。登录与 API 密钥仍由用户操作，不自动启用 Claude Code。

2026-11-03 导出编码修订：Windows 导出能力由前后端共用，HEVC 入口禁用并说明原因，旧偏好或直接请求也在渲染前拒绝。H.264 硬件模式要求 Media Foundation 硬件编码器，软件模式明确使用软件实现；自动模式优先硬件，仅在编码器初始化失败时尝试一次软件编码，取消、磁盘或权限错误不触发重试。三档码率均按分辨率和帧率计算，保留实际 MFT 实现与回退情况到导出目录的编码信息.json。原始奇数尺寸在右侧或底部最多补 1 像素，逐帧中间片也做偶数对齐，不改工程或拉伸画面。HEVC 支持及 Windows 剪映导入仍需另行开发与验收。
