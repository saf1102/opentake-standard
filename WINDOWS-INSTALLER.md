# OpenTake Standard Windows 安装包

`OpenTake-Standard-Setup-1.1.0-x64.exe` 是完整离线的当前用户安装器。应用、窗口和开始菜单名称均为 OpenTake Standard，版本在“帮助 → 关于 OpenTake Standard”及系统设置的“关于与诊断”中显示。

进入安装向导后选择目录，安装结束保留完成页，可勾选运行。包内提供 OpenScreen、FFmpeg/ffprobe、Python 科学计算依赖、Chromium Headless Shell 和 Codex CLI，自动从安装目录定位，不修改系统 PATH。

- 配置：`%APPDATA%\OpenTake Standard`。
- 默认工程：用户 Videos 下的 `OpenTake Standard Projects`。
- OpenScreen 配置：应用配置目录下的 openscreen 子目录。

显式配置/工程/工具环境变量仍优先；不迁移或删除旧版本工程。卸载保留工程与配置。正常编辑、录制、保存和导出不要求 OpenTake 账号；AI 功能仍需要用户自行登录、可用额度、网络及必要的 Windows 沙盒初始化。系统录屏、麦克风授权由用户确认。

运行库文件和来源见 `resources/runtimes/manifest.json`、provenance.json 与 WINDOWS-RUNTIME-NOTICES.md。完整源码另包提供，含原生采集器源码及许可证。科学计算运行模块、LGPL 动态库与对应源码归档保留；测试和开发资料不参与安装。

开发重建见 BUILD-WINDOWS.md。此包用于本地模拟正式版验收，未数字签名、未公开发布；Win10 22H2 x64、Win11 x64 的实测范围及结果见随包验收报告。macOS、其他硬件及未做的账号/音视频设备项目不得据此标为通过。遇到系统安全阻止请保留原提示，不关闭保护。

2026-11-03 官方双平台整合修订仍为 1.1.0，构建号 2026110306。在“关于与更新”查看构建号、检查官方仓库的 Windows 更新。发现更新后由系统浏览器下载 EXE，退出软件后手动安装，不会自动运行安装器。旧 fork 包需要先手动安装官方包；正式发布流程见 WINDOWS-RELEASE.md 与 RELEASE-HANDOFF-1.1.0.md。

1.1.0 的更新详情见 README。Windows 使用 Ctrl/Alt 对应上游的 Command/Option 快捷键；账号登录在独立 PowerShell 终端由用户完成。API 密钥仅以当前用户 DPAPI 密文保存。升级不清空工程或配置，旧版 R8 Preview 使用自己的配置目录，未自动迁移。
