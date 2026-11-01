# 重建 Windows 完整离线安装器

这是交接快照加已验收 Windows 修复的本地源码。产品版本展示对齐官方 v1.0.2 标签，不能据此认为已合入上游该标签的全部功能。不要用 GitHub main 覆盖本副本。

产物：`release/windows/OpenTake-Standard-Setup-1.0.2-x64.exe`；目录程序：`release/windows/win-unpacked/OpenTake Standard.exe`。仅在本机构建，不签名、不发布。

开发环境需要 Node 24.x、两份锁定 npm 依赖、Visual Studio 2022/2026 C++ x64 工具、CMake 和 Windows SDK。运行安装包的电脑不需要这些开发工具。

目录关系：

```text
OpenTake-Windows/
  source/
  runtime-payload/
```

可从同版安装目录复制 `resources/runtimes` 为 runtime-payload。不要复制 AppData、账号文件或工程。运行库保留来源清单、许可证、对应 FFmpeg 源码与配方，以及 OpenScreen 原 helper。官方 OpenScreen app.asar 的固定 SHA256 为 d325092fa699ae2d9eb2ef4a9dad930abde7b89a68ae07e3a8a0706d5c063537。

在 source 执行：

```powershell
npm ci
npm --prefix vendor/openscreen ci --ignore-scripts
npm run typecheck
npm test
npm run build:installer
```

构建前应从现有 PNG 图标生成多尺寸 public/opentake.ico（16/24/32/48/64/128/256），保留同一图形。该图标已随源码提供。构建会编译 WGC，生成两套前端、检查并更新随包 helper/运行库清单，再构建 NSIS；EXE 图标与版本资源会写入，数字签名单独禁用。

本机复用两份锁文件对应的物理 Windows 依赖；版本元数据从 1.0.0 改为 1.0.2，依赖解析未变。npm 12 对旧镜像锁 URL 的 EALLOWREMOTE 限制没有关闭，不用 --force 掩盖失败。新源码环境若遇到该限制，应正规更新依赖来源及锁文件，或使用相同解析结果的已验证 Windows 缓存。

生产包将静态资源只放在 dist，排除重复 public、测试、声明、source map 和已编译进前端的 lucide-react 包；运行时不从后者导入。运行库仅排除 Python tests、FFmpeg 手册/开发头库/预设和 ffplay，保留工具、动态库、科学计算功能、许可与对应源码。NSIS 禁用差分压缩布局，使用最大整包压缩；未实现自动更新。

每次重建必须在独立配置和工程库中执行实际录制、导入、保存重开及两类 MP4 导出，不以构建成功代替功能验收。登录和系统授权由用户操作，不修改系统安全保护。
