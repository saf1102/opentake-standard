# Windows 1.1.0 官方发布与手动更新

本轮将 Windows 最终 QA 修复交回 saf1102/opentake-standard，应用版本保持 1.1.0，构建号为 desktop/windows-version.json 中的 2026110304。新标签为 desktop-v1.1.0-2026110304。不移动已有 v1.1.0，不覆盖已有 Release 附件。

完整交接、macOS 影响预评估、验收范围和负责人操作见 [RELEASE-HANDOFF-1.1.0.md](RELEASE-HANDOFF-1.1.0.md)。合并后运行官方 main 的 .github/workflows/desktop-release.yml，汇总同一 SHA 的源码、Mac DMG、Windows EXE 和凭据并创建草稿。负责人完成验收后发布并设为 Latest。

Windows 客户端读取：

`https://github.com/saf1102/opentake-standard/releases/latest/download/windows-update.json`

只接受官方仓库稳定通道、Windows x64、与版本/构建号对应的固定桌面标签 EXE。先比较三段版本，同版本再比较递增 windowsBuild。下载由默认浏览器完成，用户退出软件后手动运行安装包；应用不会自动下载、执行或替换自己。SHA-256 供下载后核验，不代表代码签名。

旧 fork 包仍使用旧 fork 更新地址，先手动安装官方包，再验证新更新链路。清单缺失或网络失败时显示原因，不声称已是最新。Mac 原源码更新流程独立保留。

每次修订先递增 windowsBuild、更新 windowsRevision 并提交。运行 typecheck、test、test:release、build:installer，保持工作区干净。安装器旁 .exe.build.json 必须对应实际字节和源码提交，不能混用旧交接 EXE 与新凭据。

仅在本地准备 Windows 清单可运行：

```powershell
node scripts/prepare-windows-release.mjs "release/windows/OpenTake-Standard-Setup-1.1.0-x64.exe" "更新说明.txt" "release/windows-update"
```

工具验证安装包凭据，生成 windows-update.json 和 SHA256SUMS.txt，不上传。完整双平台汇总及附件要求见交接文档。

源码单独发布使用 --preserve-latest，保持含 windows-update.json 的完整桌面 Release 为 Latest。公开发布后，用未登录请求检查固定清单 URL、EXE 大小和哈希，在旧官方构建验证更新提示及真实覆盖安装，确认工程和设置保留。
