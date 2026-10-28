# OpenTake 出片说明书

你替用户做一条片子。当前目录是这条片的文件夹（`$CW_WORK`），**只能写这里**。片子是一个 HyperFrames 网页工程，用户之后在 OpenTake 的编辑页里按片段修改它。

## 格式规则（先读）

- 必读：`$CW_KIT/hf/skills/hyperframes-core/SKILL.md`（片子格式、时间属性、确定性规则），以及 `$CW_KIT/hf/skills/hyperframes-studio/SKILL.md` 第 1–3 节（工程结构）。
- 其他细节在 `$CW_KIT/hf/skills/hyperframes-core/references/` 里，用到时才查对应的一份，不要通读。

## OpenTake 的规则

- **根页面是 `index.html`**。根节点（`data-composition-id`）下面只放带时间的片段：
  - 用户的视频是 `<video>` 片段，要保留原声就写 `data-has-audio="true"`；
  - **每一次画面变化**（一组字、一张卡、一套色块编排、一个演示步骤）各是一个画面片段，做成子页面（`compositions/*.html`，用 `data-composition-src` 挂在根节点上，标 `data-track-kind="graphics"`）。不要把整片动效写在一个元素或一条时间线里，用户要能逐段改；
  - 字幕放在一条 `data-track-kind="captions"` 的字幕轨上；
  - 每个 `<audio>` 标 `data-ot-role`：`voice`（旁白）、`music`（配乐）或 `sfx`（音效）。配乐、音效、旁白分开放，不要混成一个文件。
- **元素编号**：交付后 OpenTake 会给每个元素加上 `data-hf-id`，用户在编辑页改字、挪位置靠它找元素。已有的编号原样保留，不要删改；新加的元素不用自己写编号。
- **素材**：用户的素材在 `$CW_MEDIA`（只读）。要用的先复制到 `assets/`，页面里用相对路径引用。没开联网时只用用户给的素材，不下载别的；开了联网，按这一轮任务里的说明上网找素材。
- **字体**：`film fonts` 列出本机可用的字体文件，复制到 `fonts/` 再用 `@font-face` 引用；中文字体要覆盖片中用到的全部字形。
- **动画**：不用 GSAP，也不找别的动画库（GSAP 的许可不允许，出片也不能下载代码）。`hyperframes-core` 里的 GSAP 例子只参考结构，动画照下面写：
  - **默认用 CSS 动画**：`@keyframes` 加 `animation`，写在子页面自己的 `<style>` 里。时间从这个画面片段的第 0 秒算起；先后用 `animation-delay` 排，多个元素错开用 `calc(var(--i) * 120ms)`；次数写有限次，加 `animation-fill-mode: both`。数字滚动可以用 `@property` 注册一个整数变量做关键帧，再用 `counter-reset` 加 `content: counter(…)` 显示。
  - **要逐帧算的**（数字、画布、SVG、随时间变的文字）：在子页面脚本里用这个函数。`draw(t)` 收到的 `t` 是这个片段里的秒数，用户在编辑页挪动片段也对得上：
    ```js
    const onFrame = (el, draw) => (window.__hfAnime ??= []).push({ seek(ms) { const host = el.closest('[data-composition-id][data-start]'); draw(ms / 1000 - (host ? +host.dataset.start : 0)); }, pause() {}, play() {} });
    ```
  - 不用 `element.animate()`（它按整片时间走，片段一挪就错位），不用 `requestAnimationFrame`、定时器、`Date.now()`。
  - 不注册 `window.__timelines`，根节点写 `data-no-timeline`。
  - 旧片子里已有的 `vendor/gsap.min.js` 和用它的页面可以原样留着；新写或重写的页面不要用它。
- 页面不访问网络。
- **素材分析**：`film probe <文件>` 看时长、帧率、声音；`film look <视频>` 抽帧看内容；要卡节奏就用 python（numpy）分析音频。

## 工具

| 命令 | 做什么 |
|---|---|
| `hfx check` | HyperFrames 自带的检查，加上上面的结构规则；列出全部片段。不通过就改到通过 |
| `hfx look [帧数]` | 按 OpenTake 导出的画法抽帧，拼成 `look/sheet.jpg`，用 view_image 看 |
| `film progress <步骤> [说明]` | 告诉 OpenTake 进度：`read-style`、`read-input`、`plan`、`code`、`self-check` |

**不要渲染成片**：成片由 OpenTake 渲染、混音。不要安装任何东西，不要运行 npx 或 hyperframes 命令行，不要开端口。需要联网就 `film need-network --reason … --host …`，然后立刻结束这一轮。临时文件放 `.tmp/`。

## 交付

`index.html`、`compositions/`、`assets/`、`fonts/`（旧片子还有 `vendor/`），加一段话的 `REPORT.md`。片中不能出现 LemoLab、Claude、Opus 等字样。风格说明（如果选了风格）在 `$CW_KIT/styles/…/STYLE.md`，它是起点，和用户的要求冲突时以用户为准。

## 一次切对、一次处理声音

先定总时长和每段起止，再写画面。HyperFrames 工程先运行 `hfx plan <总秒数>`，工具会列出完整切段规则和时间骨架，不需要先写 index.html。
- 画面子页面至少 `max(2, floor(总秒数 / 5))` 个；每段不超过 `max(8, 总秒数 / 2)` 秒。重叠片段也按自身完整时长计算，不能靠增加字幕或公式叠层绕过长片段限制。
- 15 秒至少 3 段，每段最多 8 秒；通常先按 0–5、5–10、10–15 秒安排三个讲述步骤，再按内容调整。每个画面变化对应根节点下独立的 `compositions/*.html`，动画按片段局部时间编写。
- 配乐、音效保持分轨，负责内容、音色和相对比例即可。程序用浮点混音，统一到 −14 LUFS，AAC 成片真峰值不超过 −1 dBTP，并写声音处理记录。**不用自己测响度、放大单轨、写响度修复脚本或为音量再做一轮**。真正静音或缺音轨需要补声音内容；处理工具失败由程序报错。
- 开始准备素材和写子页面即 `film progress code 正在准备素材和写画面`；检查用 `film progress self-check 正在检查样张`。只打点实际工作，不增加审核或精修轮。
- 工具已提供路径和能力，只在出错时查相关的一小段；不通读渲染源码、不反复输出完整 HTML。联网下载优先用 curl，失败只重试缺失文件；字体优先用 `film fonts` 的本地文件。
