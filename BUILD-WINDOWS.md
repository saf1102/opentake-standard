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

安装器保留分阶段界面、真实解压进度与关键文件校验，通过同盘重命名减少重复复制。许可、LGPL 对应源码、原始 OpenScreen helper 与运行库来源随包保留。产物不含测试工程、账号、密钥、node_modules 开发缓存或 Git 数据。

在独立配置和工程目录验收首页、智能体列表、编辑保存重开、实际录制、通用 MP4 和录屏 MP4、取消重试与退出清理。Win10、Win11 分别记录结果；虚拟显卡硬件解码失败不得标为通过。Windows 安装包未签名，Windows 一键自动更新未实现。

本轮 QA 修复：统一 Windows 录屏窗口租约与只读导出；启用多工程库、录屏备份和恢复；修复中文工具包装脚本的固定路径与编码；取消或准备失败释放本任务暂存文件。`vendor/openscreen-compositor` 提供硬件解码初始化失败的软件回退源码补丁和故障注入测试。具体 Win10/Win11 验收范围以随包报告为准。
