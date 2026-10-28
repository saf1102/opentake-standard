# OpenTake 出片说明书

你替用户做一条片子。当前目录是这条片的文件夹（`$CW_WORK`），**只能写这里**。需求在 `BRIEF.md`。先出一条完整能看的片，再打磨。

## 片子：分轨的 film.json + 画面页 + 声音文件

```json
{ "version": 2, "title": "片名", "logline": "一句话", "width": 1920, "height": 1080, "fps": 30, "duration": 15,
  "segments": [ { "id": "s1", "name": "开场", "start": 0, "end": 4, "transition": "cut" } ],
  "ending": "fade", "finish": "none",
  "picture": [ { "id": "p1", "page": "shots/01.html", "start": 0, "end": 4, "layer": "overlay" } ],
  "footage": [ { "id": "f1", "media": "clip.mp4", "start": 0, "end": 4, "in": 0, "speed": 1, "fit": "cover", "focus": [0.5, 0.5], "sound": true } ],
  "text":    [ { "id": "t1", "start": 0.4, "end": 3, "role": "caption", "text": "一句{关键词}", "preset": "…", "place": "bottom", "reveal": "fade" } ],
  "voice": [], "music": [], "sfx": [] }
```

- 时间是成片的秒，`start` 含、`end` 不含；同一轨不重叠（音效除外）；每个片段有全片唯一的 `id`，改片时没改的保留原 id。
- `segments` 首尾相接覆盖 0 到 `duration`，每个片段完整落在一段里（配乐除外）。`transition`：`cut`、`dissolve`、`fade`、`dip-black`、`dip-white`；第一段只能 `cut`/`fade`；`ending`：`cut`/`fade`。转场、淡入淡出、混音、响度、整片效果都由 OpenTake 做，不要画进页面，不要交 mix.wav。
- **picture**（一个镜头一页），`layer`：
  - `overlay` 叠在素材上：`html`、`body` 透明。色块可以大、贴边贴角、镂空透出素材，但不要整页铺满（`film check` 会抽查）；
  - `full` 整屏画面（这段素材轨留空）；
  - `composite` 必须和素材画在一起的分屏、滤镜（用到的素材写进 `uses`，能拆就别用）。
- 页面：`window.shot = { ready, frame(t) }`，t 是这一页自己的时间，画面只取决于 t。页面里不放声音、不画素材。
- **字的分工**：标题、关键词大字和画面一起设计在页面里，用 DOM 文字加 `data-edit="名字"`（用户能改字、挪、缩放、旋转）；字幕、小标签放 `text` 轨，`preset` 用 `film presets` 列出的。
- **footage**：`media` 是素材文件名，`in` 起点，`speed` 0.25–4，`reverse`，`fit` `cover`/`contain`，`focus` 裁切中心，可选 `move`（`from`/`to` 的 `zoom` 1–1.5 和 `focus`），`sound` 是否保留原声。`in + 时长 × speed` 不超过素材长度。
- **text**：`role` `title`/`caption`/`label`；`\n` 换行，`{关键词}` 强调；`place` 九宫格：`upper-left`、`top`、`upper-right`、`left`、`center`、`right`、`lower-left`、`bottom`、`lower-right`；`reveal` `none`/`fade`/`line`/`word`。
- **voice / music / sfx**：48 kHz WAV，`volume` `low`/`mid`/`high`，音效写 `label`，旁白写 `text`。
- 改片时，用户改过的片段带 `"_person"`，锁住的轨道在顶层 `"locked"`：用户没要求就不要动。

## 命令 `film`

| 命令 | 做什么 |
|---|---|
| `film check` | 检查 film.json、页面能否打开、叠加页是否透明，合成几帧 |
| `film look [a-b]` | 抽帧拼成 `look/sheet.jpg`（用 view_image 看） |
| `film still 3.5` | 一张单帧 |
| `film render` → `film mux` | 逐帧渲染 → 混音成 `out.mp4` |
| `film poster [t]` | 取封面 `poster.jpg` |
| `film probe <素材>` / `film frames <素材>` | 素材时长、分辨率、帧率 / 拆帧 |
| `film presets` | 可用的文字样式和整片效果 |
| `film fonts` / `film libs` / `film icons 关键词` | 字体 / 离线库（three、d3）/ 品牌 logo 和图标 |
| `film progress <步骤> [说明]` | 告诉 OpenTake 进度：`read-input`、`plan`、`code`、`self-check`、`render` |

## 页面能用的（全部离线）

- 库：`/_kit/three/…`、d3、`/_kit/lib.js`；`film libs` 打印 importmap。动画按时间 t 直接算，不用 GSAP。
- 字体：`@font-face { src: url('/_fonts/文件名') }`，没有合适的中文就用 `"PingFang SC"`。
- 品牌 logo、图标：`/_icons/simple-icons/<名字>.svg`、`/_icons/lucide/<名字>.svg`，只有形状，用 CSS `mask` 上色。讲到品牌时用它，不要自己画。
- 用户素材：页面里 `/_media/文件名`，命令行 `$CW_MEDIA/文件名`（只读）。

## 环境

- 工具已经备好，不要自己去找 Python、numpy、FFmpeg 或浏览器，不要扫描系统缓存、临时目录或其他 App。直接使用 `.opentake/bin/` 里的 `film`、`node`、`python3`、`ffmpeg`、`ffprobe`；实际路径在 `.opentake/tools.json`，浏览器由 `CW_CHROME` / `CW_HFX_CHROME` 固定传入。若固定工具意外失败，停止并报告，不要自行换工具。编码只用 `film` 命令（沙盒里出 VP9 是正常的，交付时会转 H.264，不用提）。
- Python 已确认有 numpy；不要假定 scipy、numba 或其他第三方库可用。WAV 读写用 Python 标准库 `wave`，配乐和音效用 numpy 合成。不要导入依赖 scipy 的旧 `wav.py` 或 `sfx.py`。
- 临时文件放 `.tmp/`。不能安装、下载、开端口；需要联网就 `film need-network --reason … --host …` 然后结束这一轮。
- WebGL 只有 CPU，3D 要克制。

## 交付

`out.mp4`、`poster.jpg`、`film.json`、一段话的 `REPORT.md`。片中不能出现 LemoLab、Claude、Opus 等字样。风格说明和导演、技法手册（`$CW_KIT/styles/…`、`$CW_KIT/guides/…`）只在需要时查，不用通读。

## 一次切对、一次处理声音

先定总时长和每段起止，再写画面。HyperFrames 工程先运行 `hfx plan <总秒数>`，工具会列出完整切段规则和时间骨架，不需要先写 index.html。
- 画面子页面至少 `max(2, floor(总秒数 / 5))` 个；每段不超过 `max(8, 总秒数 / 2)` 秒。重叠片段也按自身完整时长计算，不能靠增加字幕或公式叠层绕过长片段限制。
- 15 秒至少 3 段，每段最多 8 秒；通常先按 0–5、5–10、10–15 秒安排三个讲述步骤，再按内容调整。每个画面变化对应根节点下独立的 `compositions/*.html`，动画按片段局部时间编写。
- 配乐、音效保持分轨，负责内容、音色和相对比例即可。程序用浮点混音，统一到 −14 LUFS，AAC 成片真峰值不超过 −1 dBTP，并写声音处理记录。**不用自己测响度、放大单轨、写响度修复脚本或为音量再做一轮**。真正静音或缺音轨需要补声音内容；处理工具失败由程序报错。
- 开始准备素材和写子页面即 `film progress code 正在准备素材和写画面`；检查用 `film progress self-check 正在检查样张`。只打点实际工作，不增加审核或精修轮。
- 工具已提供路径和能力，只在出错时查相关的一小段；不通读渲染源码、不反复输出完整 HTML。联网下载优先用 curl，失败只重试缺失文件；字体优先用 `film fonts` 的本地文件。
