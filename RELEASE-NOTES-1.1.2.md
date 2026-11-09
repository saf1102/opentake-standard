# OpenTake Standard 1.1.2 更新

本次开放「不用风格」并修复 Windows 上素材拖不进去，构建号为 2026110901。

- 新增「不用风格，直接开始」：新建通用剪辑时可以不套风格，用一段话说清要做什么，再放视频、图片和音乐，画面、字体、配色、节奏都按你的话来定。Mac 和 Windows 都有。
- 「不用风格」的输入框可以直接把素材拖进去，拖到上面会亮起描边；不是视频、图片、音乐的文件会提示没放进来。
- 修复 Windows 上部分视频拖不进去或选不出来：`.mov`、`.mkv`、`.avi` 等格式在一些电脑上系统认不出类型，以前会被悄悄丢掉，现在按扩展名判断。

## 下载和首次打开

请从 [官方下载页面](https://github.com/saf1102/opentake-standard/releases/latest) 选择适合电脑的文件：

- **Mac Apple 芯片（M 系列）**：下载 `OpenTake-Standard-1.1.2-mac-arm64.dmg`。
- **Mac Intel 芯片**：下载 `OpenTake-Standard-1.1.2-mac-x64.dmg`。
- **Windows 10 / 11 64 位**：下载 `OpenTake-Standard-Setup-1.1.2-x64.exe`。

Mac：打开 DMG，将 OpenTake Standard 拖到「应用程序」。首次打开若被系统拦截，在「系统设置 → 隐私与安全性」找到 OpenTake Standard，点「仍要打开」，再次确认。只对从上述官方页面下载的应用放行，无需关闭系统安全保护。

Windows：双击 EXE 安装；若 SmartScreen 显示「Windows 已保护你的电脑」，确认来自上述官方页面后，点「更多信息 → 仍要运行」。包目前未签名，部分受管理电脑可能需要管理员允许。

更新前请保存工程并退出应用，再安装新版。升级和卸载保留工程与配置。Windows 导出支持 H.264 / ProRes，HEVC 暂不支持。智能体 CLI、媒体工具和 OpenScreen 的安装使用方法见 [README](https://github.com/saf1102/opentake-standard#readme)。
