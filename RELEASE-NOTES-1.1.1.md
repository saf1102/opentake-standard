# OpenTake Standard 1.1.1 更新

本次修复智能体接入和中转站连接问题，构建号为 2026110601。

- DeepSeek Harness（`dsh`）现在可以用来出片，它里面配置的千问等其他模型也能用。这是新支持的接法，遇到问题请反馈。
- DeepSeek 卡片的 API 密钥只能处理纯文字，界面会写明；只有 API 密钥也要出片时，可以在 Codex 的 API 密钥里点「填入官方地址」接 DeepSeek。
- CodeBuddy 没登录时说清楚原因：只用自己的模型（models.json）也要先登录；Windows 上也可以设置环境变量 `CODEBUDDY_API_KEY`。
- 接口地址填错不再直接失败：多填的 `/v1/messages`、`/responses`、`/chat/completions` 等路径会自动去掉，已保存的地址也一样。
- 兼容更多中转站：没有模型列表或 token 计数接口时，手动填写模型后会发一次最小请求来确认，消耗极少量额度。接口不存在时，报错会写明实际请求的地址。
- 修复 Windows 上 Chromium 检查偶尔报 `EPERM` 导致无法渲染（[#2](https://github.com/saf1102/opentake-standard/issues/2)）。

## 下载和首次打开

请从 [官方下载页面](https://github.com/saf1102/opentake-standard/releases/latest) 选择适合电脑的文件：

- **Mac Apple 芯片（M 系列）**：下载 `OpenTake-Standard-1.1.1-mac-arm64.dmg`。
- **Mac Intel 芯片**：下载 `OpenTake-Standard-1.1.1-mac-x64.dmg`。
- **Windows 10 / 11 64 位**：下载 `OpenTake-Standard-Setup-1.1.1-x64.exe`。

Mac：打开 DMG，将 OpenTake Standard 拖到「应用程序」。首次打开若被系统拦截，在「系统设置 → 隐私与安全性」找到 OpenTake Standard，点「仍要打开」，再次确认。只对从上述官方页面下载的应用放行，无需关闭系统安全保护。

Windows：双击 EXE 安装；若 SmartScreen 显示「Windows 已保护你的电脑」，确认来自上述官方页面后，点「更多信息 → 仍要运行」。包目前未签名，部分受管理电脑可能需要管理员允许。

更新前请保存工程并退出应用，再安装新版。升级和卸载保留工程与配置。Windows 导出支持 H.264 / ProRes，HEVC 暂不支持。智能体 CLI、媒体工具和 OpenScreen 的安装使用方法见 [README](https://github.com/saf1102/opentake-standard#readme)。
