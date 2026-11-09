# 下载统计与官方源码 ZIP

**[官方下载源码 ZIP](https://github.com/saf1102/opentake-standard/releases/latest/download/OpenTake-Standard-source.zip)** · [SHA-256](https://github.com/saf1102/opentake-standard/releases/latest/download/OpenTake-Standard-source.zip.sha256) · [每日统计](https://github.com/saf1102/opentake-standard/tree/repository-stats) · [工作流状态](https://github.com/saf1102/opentake-standard/actions/workflows/repository-stats.yml)

OpenTake Standard 不向我们上传安装、启动或使用遥测。维护工具只读取 GitHub 仓库聚合指标，不进入 App 或安装脚本。**下载次数不是人数、安装成功数或活跃用户数。**

## 三种入口分别计算

| 方式 | 可用指标 | 边界 |
|---|---|---|
| 官方 Release 附件 `OpenTake-Standard-source.zip` | 每个 GitHub asset ID 的累计 `download_count`；定期取差值 | 包括重复下载和自动化。没有独立下载人数。只统计这个明确命名的源码附件，不混入其他资源 |
| `git clone` | 最近 14 天完整克隆次数、窗口独立克隆者、UTC 每日分解 | 不含 fetch/pull；需额外 Traffic 读取权限。未配置时显示未知，ZIP 统计继续 |
| 绿色 Code → Download ZIP / GitHub 自动 Source code archives | GitHub API 没有这里需要的下载计数 | 显示未知，不能填 0，也不能拿 clone 数代替 |

两类可观测请求各自列出，不相加当作用户数。开发者、验收、工作流自身 checkout 等也可能计入克隆次数。

## 每日查看与长期留存

`Repository download statistics` 工作流在官方仓库每小时 UTC 的 17 分采集，也可手动运行。fork 默认不执行。聚合结果保存到独立 `repository-stats` 分支，只包含 `history.json` 和中文 `README.md`，不修改 main 源码。GitHub 调度可能延迟，应检查报告的最近成功采集时间。API 计数也可能尚未反映已发生的下载；采集成功只表示读取成功，0 不能直接证明无人下载。2026-10-27 上线验收中源码 ZIP 已完整下载且 SHA-256 正确，但随后平台仍返回 0，因此正向计数增量尚未确认，没有手工改数。

- README 展示最近 30 天的“同一 UTC 日内已确认 ZIP 新增”及计数修正、跨日/漏采覆盖状态；它不是精确的完整自然日下载总量。
- 上次采集和本次采集跨午夜时，增量保留为“跨 UTC 日区间”，不硬塞给任意一天；相隔超过 36 小时标为漏采。最近 72 个区间可直接查看，完整历史保存在 JSON。
- 新资产首次读到的非零数值是**首次基线**，不会记成当天新增。每个 asset ID 独立跟踪；删除附件后保留最后观测累计值。附件重建产生新 ID，另起基线，不覆盖旧 ID。若已消失的 ID 重新出现，增量起点是它真正的最近观测时刻，不能误算成最近一次采集内的增量。
- GitHub 计数向下修正会单独列为修正，不偷偷丢弃，也不当作负下载请求。日报要结合新增和修正看。
- 同一快照重复执行不重复累计。API 不可用保留旧数据并明确显示不是实时值，不写假零。任何分页失败不生成“所有后续附件被删除”的假快照。Release 和每个 Release 的 assets 都完整分页。
- clone 的重叠 14 天窗口按 UTC 日期替换，不重复相加；跨日独立克隆者不能相加。首次采集前超过窗口的 clone 历史无法补回。

公开 Release ZIP 采集和统计分支保存只需工作流自带的 `GITHUB_TOKEN`，**不需要你创建 PAT**。ZIP API 失败时，工作流先保存带有“不可用”的真实状态和旧数据，再将本次运行标为失败；可修复后重跑。

## 可选：同时启用 clone 记录

仅当所有者希望统计 clone 时，由所有者自行创建只选定这个仓库、Repository permissions **Administration: Read-only** 的 fine-grained PAT（另含 GitHub 默认 Metadata read），直接放到 Actions secret `REPOSITORY_TRAFFIC_READ_TOKEN`。不要把它发给智能体、聊天或提交到代码。无需 Administration write。

该只读 secret 只用于 clone 查询；公开 ZIP 和统计写入仍用 GitHub 临时令牌。secret 缺失、过期或被拒绝时，clone 标为未知并保留旧历史，ZIP 仍正常采集。不能把“能 push Git”当作“已获得 Traffic API 权限”。停止定时采集可在 Actions 中 Disable workflow，历史不删除。

## 官方源码 ZIP

从 1.1.3 起不再单独发布源码快照。每次正式发布（Actions 的 **Build desktop installers and prepare release draft**）都会用安装包的同一提交生成 `OpenTake-Standard-source.zip` 和 `.sha256`，附在同一个 Release 里。README 的 `releases/latest/download/OpenTake-Standard-source.zip` 因此始终指向最新正式版本的源码。

早先单独发布的 `source-<提交SHA>`、`v1.0.x` 等源码 Release 保留不删，下载计数照常统计。

## 本机验证

```sh
node --test scripts/repository-stats.test.mjs scripts/prepare-source-release.test.mjs scripts/publish-source-release.test.mjs
# 公开 ZIP API，无需任何登录令牌：
node scripts/repository-stats.mjs --repo saf1102/opentake-standard --out ./stats-result
# 后续保留历史：
node scripts/repository-stats.mjs --repo saf1102/opentake-standard --history ./stats-result/history.json --out ./stats-result
```

`--api github-cli` 使用 GitHub CLI 已管理的认证（工作流使用这种方式），不读取凭据文件。`--clone-snapshot clones.json` 可提供成功的 clones API 响应，`--release-snapshot assets.json` 提供离线标准化附件数组用于测试。测试数据不是实际下载量。不要运行打印令牌的诊断命令。

## GitHub 官方依据

- [Repository traffic API：14 天、UTC、Administration read](https://docs.github.com/en/rest/metrics/traffic)
- [Traffic 图表：full clones，不含 fetch](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)
- [Release assets API：附件 download_count](https://docs.github.com/en/rest/releases/assets)

统计不包含 IP、来源网站、用户名或 App 使用行为。
