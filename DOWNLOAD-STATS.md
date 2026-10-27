# 仓库下载统计（维护者）

OpenTake Standard 不向我们上传安装、启动或使用遥测。这里的统计工具仅查询 GitHub 的仓库指标，不进入 App 或安装脚本。

## 能记录什么

| 方式 | 可用指标 | 边界 |
|---|---|---|
| `git clone` | GitHub 最近 14 天完整克隆次数、窗口独立克隆者、UTC 每日分解 | 不含 fetch/pull；重复克隆、维护者、自动化也可能计入，不能称为用户数或安装量 |
| GitHub “Download ZIP” / 自动生成的 source archives | 本工具没有可用计数 | 显示未知，不能填 0，也不能用 clone 数代替 |
| 人工上传到 Releases 的附件 | GitHub Release Asset `download_count` | 是附件下载次数，单独统计；不能覆盖源码 ZIP、clone，也不能代表安装成功 |

脚本按 UTC 日期替换重叠窗口的数据，不累加重复的 14 天窗口。跨日独立克隆者不相加。首次启用最多取得 GitHub 当前保留的窗口，更早的数据无法恢复；中断过久会留下缺口，缺失日期不补零。最近一天仍会变化。工作流本身的 checkout 可能计入 clone 数，因此不能按下载次数估计“外部真实用户”。

## 启用前：仓库所有者操作

工作流默认不执行。只有完成以下配置后才会每天运行；定时任务依赖 GitHub Actions，不能保证零延迟，应至少每周检查一次成功记录。

1. 阅读本说明，确认允许在公开仓库的 `repository-stats` 分支公开聚合次数及按日记录。该分支只含 `history.json` 和 `README.md`，不包含 App 数据或个人信息。
2. 所有者自行创建仅选定 `saf1102/opentake-standard` 的 fine-grained PAT，Repository permissions 只需 **Administration: Read-only**（及 GitHub 默认 Metadata read）。不要添加 Administration write。不要把令牌发给智能体、聊天或提交到代码。
3. 在仓库 Settings → Secrets and variables → Actions 添加 repository secret `REPOSITORY_TRAFFIC_READ_TOKEN`，由所有者直接粘贴。到期需要所有者更新。普通 `GITHUB_TOKEN` 不提供此 Traffic Administration 权限。
4. 在同一页面的 Variables 中设 `ENABLE_REPOSITORY_STATS=true`。这是公开聚合统计的显式开关。
5. 在 Actions → Repository clone statistics 手动 Run workflow 一次。成功后打开 `repository-stats` 分支的 README。以后每天采集；`main` 不写统计提交。

读 Traffic 的专用 secret 仅用于采集步骤；写统计分支使用 GitHub 的临时 `GITHUB_TOKEN`，不把 PAT 扩大为写权限。工作流不打印凭据或错误响应正文。若 API 失败则失败退出，保留历史，不生成虚假的零次记录。不启用开关、不配置 secret 时，没有统计数据是正常状态，不能标作已上线。

## 本机采集和测试

已由所有者登录且具有上述权限的 GitHub CLI 可以运行（脚本不读取凭据文件）：

```sh
node --test scripts/repository-stats.test.mjs
node scripts/repository-stats.mjs --repo saf1102/opentake-standard --out ./stats-result
# 后续采集必须给已有历史，避免丢失窗口之外的数据：
node scripts/repository-stats.mjs --repo saf1102/opentake-standard --history ./stats-result/history.json --out ./stats-result
```

离线验证可增加 `--snapshot clones.json`，输入为 GitHub clones API 的响应形状。测试数据不是真实下载量。不要提交真实访问令牌，不要运行打印令牌的诊断命令。停止自动采集只需将变量改为 `false`；已有历史仍保留。

## GitHub 官方依据

- [Repository traffic API：最近 14 天、UTC、Administration read](https://docs.github.com/en/rest/metrics/traffic)
- [Traffic 图表：full clones，不含 fetch](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)
- [Release assets API：附件 download_count](https://docs.github.com/en/rest/releases/assets)

没有把 referrers、IP、用户名或 App 使用数据纳入统计。统计脚本、工作流与权限配置需要先通过维护者审核；新增流程不自动授权发布安装包或启用第三方分析服务。
