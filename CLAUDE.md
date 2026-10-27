# OpenTake Standard 安装与验收

先完整读 README.md，按其中 macOS 安装步骤依次执行。仓库是公开的，不需要 GitHub 登录。不要读取用户的密码、令牌或私钥；Codex 登录由用户自行完成。

必须安装根目录和 vendor/openscreen 两份锁定依赖，准备匹配的 Playwright Chromium，再执行 typecheck、test、build。npm start 打开原生 Standard 窗口；验收实际首页与录屏运镜编辑器，不把构建通过当作功能验收。

OpenScreen 由用户从官方发布页 https://github.com/getopenscreen/openscreen/releases 下载安装，推荐已验证的 2.1.2。不要从第三方镜像下载，不自动授权屏幕录制；需要权限时请用户在系统界面操作。

不使用 sudo、不修改系统设置、不覆盖同名 App 或用户工程、不安装无关工具。缺运行库按 README 处理并说明影响。先用隔离工程验证保存、重开与导出；任何失败都保留工程和日志，说明下一步，不能声称全部完成。

本机 App 用 npm run build:app 构建，在 release 中验收；没有发布、签名或公证授权。默认用户工程位置与 Pro 共用；测试设置独立 OPENTAKE_STANDARD_USER_DATA 和 LINK_READER_PROJECTS_DIR。
