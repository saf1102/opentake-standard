# OpenTake Standard 1.1.0 双平台发布交接

交接对象：`saf1102/opentake-standard` 维护负责人。评估日期：2026-11-03。目标是在原仓库以同一份已合并源码发布 macOS Apple 芯片 DMG 与 Windows x64 EXE；本轮暂不配置公开签名证书或苹果公证。

## 结论与上线边界

Windows 最终 QA 分支包含当前官方 1.1.0 的全部代码，原仓库 main 是其祖先，合并预演无文本冲突。共享代码已经过平台路径审查、macOS 编码参数对照和 Windows 自动化回归。Windows 运行库已经从锁定归档在新目录重建，后续出包无需复制交接人的旧 App、账号目录或开发机运行库。

这是兼容性预评估，不能代替 macOS 实机验收。新增 CI 在 Apple 芯片 macOS 和 Windows 执行测试及前端编译，并实际构建 Mac DMG、执行本机临时签名的严格校验及镜像完整性检查；CI 的 Mac 包带 localCandidate 标记，仅供验收，不能用于正式发布。手动发布工作流再从同一官方 main 提交构建两平台安装包。负责人须完成下表中的实际使用验收后公开上线；CLA 确认仍按 CONTRIBUTING.md 执行。

## 源码与版本身份

| 项目 | 本次基线 |
| --- | --- |
| 官方仓库 | `saf1102/opentake-standard` |
| 官方 1.1.0 / 评估时 main | `786d2264db0fb29385c354a9890e96e961e2d57d` |
| 纳入的 Windows 最终 QA 提交 | `b9d354467fcb65df49404c71f25f2b5f3aa79971`，包含此前全部 19 个增量提交 |
| 交付分支 | `steven90s/opentake-standard:release/1.1.0-cross-platform` |
| 应用版本 | `1.1.0`，两平台显示版本一致 |
| 当前桌面构建号 | `2026110305`，来源为 desktop/windows-version.json |
| 新安装包发布标签 | `desktop-v1.1.0-2026110305` |
| 最终构建源码 | PR 合并后的官方 main 提交；工作流固定完整 SHA，两个构建任务均使用该 SHA |

现有 v1.1.0 标签保留在原始官方提交，不移动、不删除、不替换其附件。桌面修订使用新的构建号和 `desktop-v{version}-{build}` 标签。再次修改发布代码时递增构建号，不重新使用已发布标签；包名中的应用版本仍是 1.1.0。

## macOS 影响预评估

| 范围 | 评估与处理 | 负责人仍需验证 |
| --- | --- | --- |
| 构建 | Windows C++/Rust 脚本在非 Windows 平台先退出，不查工具链、不下载 Windows SDK；已加隔离进程测试 | Mac 两份 npm ci、完整编译、DMG 构建 |
| 资源 | Mac 配置不包含 native/windows 采集程序，离线运行库仅由 Windows 安装器加入 | App、图标、编辑器资源正常 |
| 启动与目录 | 原应用名、appId、Application Support、Movies 保留；Windows 目录默认值由 Windows 分发标记控制 | 旧配置、工程副本保存重开 |
| 智能体 | Mac 统一接入、Terminal 登录、钥匙串保留；DPAPI、PowerShell 登录仅用于 Windows | Codex 登录、切换、取消和真实短片；API 只测连接 |
| 命令 PATH | 修复适配中丢失的 POSIX PATH 兜底，无继承 PATH 时保留 /usr/bin:/bin:/usr/sbin:/sbin | Finder 启动后的工具发现、Chromium 样张 |
| 录屏 | Mac 外部官方 OpenScreen、权限引导保留；新增采集、控制栏、文件选择桥接限定 Windows | 新录制、鼠标、缩放预览和 MP4 一致性 |
| 编码 | H.264/HEVC/ProRes、三档质量、三种偏好共 27 组参数与官方 1.1.0 一致；Windows MFT 回退不会重试 Mac 编码器 | 真实音视频、帧率、声音与画面 |
| 更新与 Pro | Mac 原源码更新和 Pro 账号组件保留；Windows 使用独立 EXE 更新清单和 Pro 开发中提示 | Mac 更新对话框、升级入口 |
| 共享修复 | 原子写入、导出取消、恢复、页面预检及奇数画面补边属于两平台共享改动；导出状态写入失败时用平台对应的停止方法，避免 Mac 非独立进程组无法结束 | 取消重试、独立恢复副本、奇数尺寸、旧工程 |

出包修复还包括：新克隆没有 ../evidence 时打包钩子自动建立证据目录；Windows 从固定 URL/SHA-256 准备运行库；Mac 构建识别新桌面标签，DMG 保留原本的本机临时签名和严格验签。

Mac CI 还验证了一个实际出包阻塞：public/openscreen 是受跟踪的预编译快照，跨平台重编译会改变资产哈希和文件名，触发源码凭据校验。正式 build/build:live 已改为在 .build/ui-public-* 中生成编辑器和公共资源，再编译到 dist；受跟踪快照保持原样。build:live 继续保留已打开窗口引用的旧 dist 资源。不得以跳过源码校验解决此问题。

首轮新主机 CI 发现缺少 FFmpeg、可选中文系统字体依赖和 Mac 临时目录符号链接导致构建入口漏执行。现已显式准备两平台媒体测试工具、用合成字体文件隔离字幕映射测试，并按真实路径识别原生构建入口。合成字体只验证复制和映射，不代表真实字体或剪映验收。CI 的 Mac FFmpeg 由 Homebrew 准备，不随 DMG 分发；Windows 使用运行库锁中的归档与 SHA-256。

## 自动化与本机验证

执行环境为 Windows 11 x64 build 26200，Node 24.18.0 / npm 12.0.2。Mac 分支检查使用隔离进程模拟平台，编码检查使用显式 darwin 参数，不代表在 Mac 上运行过应用。

| 检查 | 本次记录 |
| --- | --- |
| 合并预演 | 官方 main 与 Windows 最终 QA 分支无冲突；保留完整 Windows 历史 |
| TypeScript | npm run typecheck 通过 |
| 服务端 | 367 项：366 通过、1 跳过、0 失败 |
| 桌面 | 84 项：83 通过、1 跳过、0 失败，包含新增 Mac 资源隔离检查 |
| 内嵌编辑器 | 10 项通过 |
| 发布工具 | npm run test:release：33 项通过，含同提交、哈希、脏构建拒绝和禁止覆盖 |
| Mac 编码 | 对照官方原提交 27 组参数一致 |
| Windows 运行库 | 新目录从锁定归档重建，逐文件哈希、OpenScreen app.asar 校验通过 |
| 运行库实际执行 | 科学计算库导入、剪映预检、Node 24.21.0、h264_mf、Chromium 版本检查通过 |
| Windows 候选启动 | 隔离配置/工程目录的打包程序启动通过；首页及编辑器/壁纸资源返回 200，原生首页和录屏工程列表正常 |
| Windows 完整出包 | 新运行库的完整 EXE 构建通过；最终干净提交的包凭据随 PR 记录提供，公开包由合并后的 main 重建 |
| Mac CI 安装包 | PR 自动执行完整 DMG 构建、临时签名严格校验与 hdiutil verify，以 PR 最新 Checks/候选附件为准 |
| Mac 实际使用、Win10 实机 | 本机未执行，属于发布前验收门槛 |

两项跳过为 POSIX Codex 子进程 fixture 和仅 macOS 执行的 App framework 相对链接测试；没有把它们写成通过。早期交接包“服务端 37 项失败”的报告对应旧提交，本次已按最终 QA 代码重跑，不混用旧报告、旧构建号和旧安装包。

本机原生合成器按固定源码/二进制回执校验后复用，WGC 与前端按构建入口编译；全新 CI 主机的 Rust/SDK 构建及 Mac 安装包仍以实际工作流结果为准。

## 负责人合并与发包流程

1. 审阅 PR 最终提交、确认 CLA，等待 macOS and Windows compatibility 的两平台检查通过。首次外部贡献的 Actions 运行可能需要维护者允许。
2. 在独立配置和工程副本上完成 Mac 回归，确认后合入原仓库 main。若 main 在本次评估后有新增提交，先同步到集成分支并重跑相关检查。
3. 检查 desktop/windows-version.json 的 repository、upstreamVersion、windowsBuild、windowsRevision。若同标签/构建号已发布，先递增构建号并提交 main。
4. 在原仓库 Actions 的 main 分支手动运行 **Build desktop installers and prepare release draft**（.github/workflows/desktop-release.yml）。该流程只在官方仓库 main 启动。
5. 工作流冻结 main 的完整 SHA、准备官方源码 ZIP；macos-14 Apple 芯片和 windows-2025 x64 使用相同 SHA 安装依赖、检查、编译、出包。没有扩展 Mac Intel 支持；Windows Server CI 不代替 Win10/Win11 实机。
6. 汇总检查源码 SHA、版本、构建号、平台和 SHA-256，创建 Release 草稿。任一平台失败不会生成完整草稿；已有草稿保留检查，不覆盖标签或附件。
7. 下载草稿候选包，完成下节验收，核对 SHA256SUMS，更新发布说明中的实际支持范围。
8. 负责人确认后把草稿发布为稳定 Release，并设为 Latest。当前工作流不会自动公开上线。

## Release 附件

- OpenTake-Standard-1.1.0-mac-arm64.dmg 及 .dmg.build.json。
- OpenTake-Standard-Setup-1.1.0-x64.exe 及 .exe.build.json。
- OpenTake-Standard-source.zip、.zip.sha256、source-release.json。
- windows-update.json、upgrade.json、desktop-release.json、SHA256SUMS.txt 和发布说明。

生成的 .build.json 记录安装包实际哈希和源码凭据。汇总拒绝不同提交、脏工作区、错平台、错构建号及构建后被修改的包。源码由 git archive 从选定官方 main 生成；Windows 运行库许可及对应源码归档随包保留。不上传本机 node_modules、工程、账号目录或下载缓存。

## 最终候选包实机验收

| 项目 | Mac Apple 芯片 | Win10 22H2 x64 | Win11 x64 |
| --- | --- | --- | --- |
| 下载、哈希、普通用户安装、首页 | 待负责人实测 | 待负责人实测 | 用最终候选包复验 |
| 中文/空格路径、旧工程副本保存重开 | 待负责人实测 | 待负责人实测 | 用最终候选包复验 |
| Codex 短片、样张自查、通用 MP4 | 待负责人实测 | 待负责人实测 | 用最终候选包复验 |
| 录屏、鼠标/缩放预览、MP4 一致性 | 待负责人实测 | 待负责人实测 | 用最终候选包复验 |
| 取消、重试、无残留任务、退出重启 | 待负责人实测 | 待负责人实测 | 用最终候选包复验 |
| 回收站、独立备份恢复、写入保护 | 待负责人实测 | 待负责人实测 | 用最终候选包复验 |
| 剪映目标版本打开、音画同步 | 待负责人实测 | 待负责人实测 | 待负责人实测 |
| 升级/卸载保留工程和配置 | 待负责人实测 | 待负责人实测 | 用最终候选包复验 |

本机烟测和早期 Windows QA 不能替代最终候选包全流程验收。录屏授权、智能体登录及真实 API 密钥由使用者操作。签名、公证暂不配置，发布说明保留产物真实状态。

## 更新源与 Latest

正式 Windows 包读取 `https://github.com/saf1102/opentake-standard/releases/latest/download/windows-update.json`，仅接受官方仓库固定桌面标签的 EXE。旧 fork 安装包仍读取 fork 地址，需要先手动安装官方包。

完整桌面 Release 设为 Latest 时必须同时带源码 ZIP 与 windows-update.json。源码单独发布工作流已加入 --preserve-latest，避免抢占桌面更新入口；手动调用源码发布脚本也应带此参数。

同版本 Windows 按递增构建号提示更新。Mac 原逻辑只比较三段应用版本，现有 1.1.0 不会自动提示同为 1.1.0 的桌面修订，首次 DMG 手动下载。未来维护公开 upgrade.json / 更新服务时使用本次生成的源码 URL 和 SHA-256，不把 DMG 填入源码更新字段。

## 重建与回退

Mac 手工构建见 BUILD-MACOS.md，Windows 见 BUILD-WINDOWS.md。两平台使用官方同一 SHA、两份锁定 npm 依赖和匹配 Playwright；不跨平台复制 node_modules。

固定下载不可用、哈希不符、工具链缺失或测试失败时保留日志、缓存，修复后重出候选包。不要绕过失败、换未核验镜像或借模型调用掩盖环境问题。

上线前发现问题则保留草稿不公开。上线后需要回退时保留问题包和日志，将 Latest 指回上一完整、含更新清单的稳定 Release；Windows 不会自动降级，用户保存工程后手动安装旧包，不删除工程或配置。原 v1.1.0 标签及旧安装包继续保留。
