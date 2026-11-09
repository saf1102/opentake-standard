# OpenTake Standard 1.1.3 更新

本次修好软件内更新，构建号为 2026111001。

- **用安装包装的 Mac 用户**：这一次请到 [官方下载页面](https://github.com/saf1102/opentake-standard/releases/latest) 下载 1.1.3 安装包，打开后把 OpenTake Standard 拖到「应用程序」替换旧版。以前版本的「现在更新」按钮在安装包版上出不来，从 1.1.3 开始就能在软件里一键更新。
- Mac 一键更新改为直接换安装包：软件里下载官方安装包，核对校验码后替换 App，新版启动不起来会自动换回旧版。不再需要安装 Node、Python，也不需要交给智能体。
- Windows 一键更新：软件里下载安装程序，核对校验码后静默安装到原来的位置，装完自动打开新版，不用再去浏览器下载。
- Mac 和 Windows 都直接从 GitHub 检查新版本。GitHub 打不开时会改用备用地址，提醒照常收到。
- 修复源码版升级后下一次无法一键更新的问题。

## 下载和首次打开

请从 [官方下载页面](https://github.com/saf1102/opentake-standard/releases/latest) 选择适合电脑的文件：

- **Mac Apple 芯片（M 系列）**：下载 `OpenTake-Standard-1.1.3-mac-arm64.dmg`。
- **Mac Intel 芯片**：下载 `OpenTake-Standard-1.1.3-mac-x64.dmg`。
- **Windows 10 / 11 64 位**：下载 `OpenTake-Standard-Setup-1.1.3-x64.exe`。

Mac：打开 DMG，将 OpenTake Standard 拖到「应用程序」。首次打开若被系统拦截，在「系统设置 → 隐私与安全性」找到 OpenTake Standard，点「仍要打开」，再次确认。只对从上述官方页面下载的应用放行，无需关闭系统安全保护。

Windows：双击 EXE 安装；若 SmartScreen 显示「Windows 已保护你的电脑」，确认来自上述官方页面后，点「更多信息 → 仍要运行」。包目前未签名，部分受管理电脑可能需要管理员允许。

更新前请保存工程并退出应用，再安装新版。升级和卸载保留工程与配置。Windows 导出支持 H.264 / ProRes，HEVC 暂不支持。Intel Mac 版没有在 Intel 实机上测试过。智能体 CLI、媒体工具和 OpenScreen 的安装使用方法见 [README](https://github.com/saf1102/opentake-standard#readme)。
用源码装的 Mac 用户，软件内的更新照旧，这次会直接换成官方安装包版本。**1.0.0 用户请对智能体说：按 AGENTS.md 更新到最新版。** 1.0.0 没有更新提醒；从 1.0.1 开始每天检查。
