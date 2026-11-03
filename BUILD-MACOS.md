# macOS 1.1.0 安装包构建

本轮支持 macOS Apple 芯片。FFmpeg/ffprobe、Python + numpy、智能体 CLI 和官方 OpenScreen 的准备方式仍按 README；DMG 包含 Standard App，没有新增 Mac 离线运行库或 Intel 支持。公开签名与公证暂不配置，保留原本的本机临时签名和严格验签。

推荐合并后运行 .github/workflows/desktop-release.yml，从同一官方 main SHA 出两平台包。以下适用于官方仓库的干净 checkout：

```sh
npm ci
npm --prefix vendor/openscreen ci --ignore-scripts
npx --no-install playwright-core install chromium
npm run typecheck
npm test
npm run test:release

# 输出目录必须全新；重复运行时保留旧输出，另选目录。
SOURCE_SHA=$(git rev-parse HEAD)
RELEASE_TAG=$(node -e "const p=require('./package.json'),m=require('./desktop/windows-version.json');console.log(require('./desktop/release-contract.cjs').desktopTag(p.version,m.windowsBuild))")
node scripts/prepare-source-release.mjs --ref "$SOURCE_SHA" --tag "$RELEASE_TAG" --out release/source
unzip -p release/source/OpenTake-Standard-source.zip opentake-standard/release-source.json > release-source.json
npm run build:installer
```

产物为 release/OpenTake-Standard-1.1.0-mac-arm64.dmg 及 .dmg.build.json。构建先生成 release/mac-arm64/OpenTake Standard.app，保留 framework 相对链接，执行本机临时签名、严格验签，再用 ditto/hdiutil 生成并校验 DMG。已有同名 DMG 时停止，先保留旧候选包到其他位置。

打包入口使用 .build/ui-public-* 临时目录重编译编辑器，再生成 dist，保留仓库跟踪的 public/openscreen 快照。这避免不同系统的构建哈希改变源码，源码凭据校验仍会检查所有跟踪文件。

本机签名使用锁定构建依赖中的 graceful-fs 对文件句柄耗尽进行排队重试，避免同时探测大量 SVG/依赖时出现 EMFILE；不跳过文件遍历、严格验签或隔离标记检查，不提高系统限制。

仅需本机 App 时仍运行 npm run build:app。没有 receipt 的 Git checkout 须位于干净的官方版本标签；新标签为 desktop-v{version}-{build}，不能把旧 v1.1.0 移到新提交。

双击 DMG，在独立候选位置验证首页、旧工程副本、Codex 出片、录屏与导出。hdiutil verify、本机签名校验和 CI 构建通过不代表功能、公证或分发策略验收通过。完整流程见 RELEASE-HANDOFF-1.1.0.md。
