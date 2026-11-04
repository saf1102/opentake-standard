# OpenTake Standard 1.1.0 更新

本次修复智能体接入的三个问题，应用版本仍为 1.1.0，构建号为 2026110401。

- Windows 能识别通过 npm 安装的 `.cmd`、`.bat` 智能体程序；支持手动选择其他目录中的程序，修复含空格、中文等路径的启动处理。
- 修复部分第三方 Responses 接口测试连接失败。有些服务需要发送一次极短请求来验证连接，会消耗极少量额度；测试结果会明确说明。
- 出片、复查和文字任务正确使用接入设置中选择的模型。第三方服务没有声明默认模型时，会提示先选择模型。
- DeepSeek Harness 已安装时会显示安装状态；命令行出片仍待适配。API 接口能否出片取决于它是否支持所选智能体需要的协议。

## 下载和首次打开

请从 [官方下载页面](https://github.com/saf1102/opentake-standard/releases/latest) 选择适合电脑的文件：

- **Mac Apple 芯片（M 系列）**：下载 `OpenTake-Standard-1.1.0-mac-arm64.dmg`。
- **Mac Intel 芯片**：下载 `OpenTake-Standard-1.1.0-mac-x64.dmg`。
- **Windows 10 / 11 64 位**：下载 `OpenTake-Standard-Setup-1.1.0-x64.exe`。

Mac：打开 DMG，将 OpenTake Standard 拖到「应用程序」。首次打开若被系统拦截，在「系统设置 → 隐私与安全性」找到 OpenTake Standard，点「仍要打开」，再次确认。只对从上述官方页面下载的应用放行，无需关闭系统安全保护。

Windows：双击 EXE 安装；若 SmartScreen 显示「Windows 已保护你的电脑」，确认来自上述官方页面后，点「更多信息 → 仍要运行」。包目前未签名，部分受管理电脑可能需要管理员允许。

更新前请保存工程并退出应用，再安装新版。升级和卸载保留工程与配置。Windows 导出支持 H.264 / ProRes，HEVC 暂不支持。智能体 CLI、媒体工具和 OpenScreen 的安装使用方法见 [README](https://github.com/saf1102/opentake-standard#readme)。
