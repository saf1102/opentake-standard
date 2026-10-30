# OpenTake Standard 安装与验收

先完整读 README.md，按其中 macOS 安装步骤依次执行。仓库是公开的，不需要 GitHub 登录。不要读取用户的密码、令牌或私钥；智能体登录与 API 密钥输入由用户自行完成，不代读登录凭据。

macOS 首次安装运行 npm run setup：检查系统、芯片、Node 与磁盘，安装根目录和 vendor/openscreen 两份锁定依赖、匹配的 Playwright Chromium、独立 Python + numpy，并执行 build:live。随后运行 typecheck、test；用户在设置接通智能体后，运行 npm run doctor。任何一步非零退出都不能当作成功。可重复运行 setup，不用 sudo，不清空旧构建。npm start 打开原生 Standard 窗口；验收实际首页与录屏运镜编辑器，不把构建通过当作功能验收。

OpenScreen 由用户从官方发布页 https://github.com/getopenscreen/openscreen/releases 下载安装，推荐已验证的 2.1.2。不要从第三方镜像下载，不自动授权屏幕录制；需要权限时请用户在系统界面操作。

不使用 sudo、不修改系统设置、不覆盖同名 App 或用户工程、不安装无关工具。缺运行库按 README 处理并说明影响。先用隔离工程验证保存、重开与导出；任何失败都保留工程和日志，说明下一步，不能声称全部完成。

本机 App 用 npm run build:app 构建，在 release 中验收；没有发布、签名或公证授权。默认用户工程位置与 Pro 共用；测试设置独立 OPENTAKE_STANDARD_USER_DATA 和 LINK_READER_PROJECTS_DIR。

## 统一接入与能力边界

两种接法由同一设置组件管理：命令行账号登录、API 密钥。只列已接通的智能体，模型跟随各家默认；无效模型回退时应有提示。只有 API 密钥、没有支持的命令行，不能执行出片。Codex 与 Claude Code 的出片走共用适配层，其余标为待适配的不得承诺可用。

Claude Code 默认关闭；不要替用户开启或使用订阅账号。需要时由用户在界面确认风险，推荐 API 密钥。测试 Claude Code 及其他 Agent / 服务时只检查连通，不运行任务、不消费生成额度；真实出片验收仅使用 Codex 命令行；所有 API（含 Codex）仅测连通。任务17 connect 隐藏输入密钥，仅内存传给一次性测试接口，不进文件、日志、钥匙串、参数或环境变量；回车跳过记未实测。产品日常保存接入的密钥仅存 macOS 钥匙串，不写设置、日志、截图或工程；不改用户的 ~/.codex 或 ~/.claude。

setup 成功只证明安装步骤完成。还须在隔离工程验证首页、通用剪辑真实出片与导出、录屏引导；缺 OpenScreen 时确认下载提示。安装好后用「重新检测」与 doctor 检查，不自动授权系统权限。FFmpeg 缺失请按 README 安装，不从未确认的源下载。网络失败保留目录重试，磁盘不足不代删用户文件。
