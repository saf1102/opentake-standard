# Windows 手动更新发布流程

客户端版本本轮保留 **1.1.0**。Windows 构建号为 **2026110301**，修订为 `manual-update-recovery-20261103`。构建号只用于区分相同版本的 Windows 修订，不改变安装包或应用版本号。

## 客户端行为

Windows 的“关于与更新 → 检查更新”以及每天一次的检查读取：

`https://github.com/steven90s/opentake-standard/releases/latest/download/windows-update.json`

客户端先比较三段版本号，同版本再比较 `windowsBuild`。只有更高版本或更大构建号才提示更新；旧版本即使构建号更大也不会提示降级。支持关闭自动检查、稍后提醒和跳过当前构建。检查不附带账号、令牌或随机安装编号；GitHub 仍会收到普通 HTTPS 请求的网络信息。

发现新版后，用户点击“下载 Windows 安装包”，系统默认浏览器打开清单中的 EXE 地址；用户保存工作、退出软件，再自行运行安装包。应用不会自动下载、启动安装器或替换自身。SHA-256 用于用户下载后核验；此流程并未实现自动校验浏览器下载的文件，也不代表代码签名。

清单仅接受本仓库、稳定通道、Windows x64、固定版本/构建标签的安装包地址。源未发布、网络失败或清单无效时，显示原因并移除陈旧下载提示，不显示“已是最新”，不回退到 macOS 源码更新源。macOS 原有更新流程保持独立。

以前尚未包含此 Windows 更新链路的 1.1.0 安装包，需要先手动安装本次修订，之后才能使用此机制。

## 每次发布

1. 修改代码并完成回归。若仍用 1.1.0，保持 `package.json` / `package-lock.json` 版本不变；递增 `desktop/windows-version.json` 的 `windowsBuild`，更新 `windowsRevision`。构建号是递增整数，可使用 `YYYYMMDDNN`。不要重复使用已发布构建号。
2. 提交本地源码，确认工作区干净，运行 `npm run typecheck`、`npm test` 和 `npm run build:installer`。在隔离配置和工程上验证安装包。
3. 将本次更新说明保存为 UTF-8 文本，运行：

   ```powershell
   node scripts/prepare-windows-release.mjs "release/windows/OpenTake-Standard-Setup-1.1.0-x64.exe" "更新说明.txt" "发布目录"
   ```

   工具生成 `windows-update.json` 和 `SHA256SUMS.txt`，核验构建凭据版本、修订、构建号及干净状态，不上传文件。安装包仍需复制到发布目录。
4. 在 `steven90s/opentake-standard` 创建 Release 草稿。本次标签必须为 **`windows-v1.1.0-2026110301`**。以后标签规则是 `windows-v{version}-{windowsBuild}`，与清单下载地址一致。标签指向构建时的源码提交。
5. 上传 EXE、`windows-update.json`、`SHA256SUMS.txt`、对应源码及许可证材料，填好说明。所有附件齐全后发布为正式 Release 并设为 Latest。草稿或预发布版不用于普通用户更新。
6. 用未登录请求验证上面的固定清单 URL 能返回 JSON；核对清单中的 EXE 下载地址、大小和 SHA-256。用旧构建点击检查，应提示新版；新构建应显示已是最新；执行一次真实手动覆盖安装并验证工程/设置保留。

仅推送代码或上传 EXE 不足以触发更新，必须同时发布正确清单。本仓库的 Latest 应保留给稳定 Windows 发布；将不含此附件的其他 Release 设为 Latest 会导致客户端提示更新源不可用。

GitHub 固定附件链接格式依据：[Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)。本轮只准备本地交付，没有推送或发布 GitHub Release。

## 工程恢复修订范围

- 录屏工程在 Windows 上支持回收站恢复和有确认的彻底删除，兼容旧版仅标记删除、未移动目录的工程；启用已有存储/归档路由，并采用 Windows 文件移动重试。
- 通用工程在回收站显示删除状态，提供恢复、彻底删除入口。恢复不覆盖同名目录。
- “立即备份”包含录屏和通用工程；通用工程保存元数据、编辑分轨前按自动备份间隔保留快照。快照包含工程文稿及版本/工作目录中的编辑文本；恢复生成独立副本，重写工程 URL，复制现存素材/版本，保留备份时编辑文档。
- 快照不是完整素材离线备份。原工程素材或成片缺失时明确拒绝恢复；请另行保存素材。彻底删除源工程后，只有文稿快照不能重建已删除媒体。
- 录屏导出目录选择改用跨平台目录选择器。

最终实机覆盖、未解决事项与包身份以随包验收说明为准。
