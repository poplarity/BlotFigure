# BlotFigure — 开发与维护交接 / Agent handover

这份文档面向后续开发者和 coding agent，记录当前产品约定、代码入口、容易回退的交互、验证与发布方式。先读 [CONTRIBUTING.md](CONTRIBUTING.md)；调试参数和历史实现细节见 [DEVELOP.md](DEVELOP.md)。用户指南见 [README.zh-CN.md](README.zh-CN.md)。`CLAUDE.md` 引用本文，不维护另一份独立交接。

The maintainer communicates in Chinese. This is the authoritative handover for coding agents; keep the existing WB workflow and independent protein regions. Develop and push to `dev`; merge into `main` and release only when the maintainer asks. Current user instructions take precedence over this snapshot.

## 接手快照 — 2026-10-29

- **已发布 v0.14.0**，标签 [`v0.14.0`](https://github.com/poplarity/BlotFigure/tree/v0.14.0) 对应 `e0cbdb0`，发布时间 2026-10-27。网站、单文件 HTML 和源码 ZIP 已发布。不要把已完成的 GelFigure 对标工作再当作待开发事项。
- 发布提交的 [main CI](https://github.com/poplarity/BlotFigure/actions/runs/40478213062) 已完成且成功，三种浏览器通过；[Pages](https://github.com/poplarity/BlotFigure/actions/runs/40478213101) 和 [Release](https://github.com/poplarity/BlotFigure/actions/runs/40478213511) 发布成功。可编辑 PPT 另经 Windows PowerPoint 验证。这是历史验证记录，不代表未来提交已通过检查。
- 本次交接编辑前，远程 `main` / `dev` 均为 `75d3389`：它只更新首页展示图和截图脚本，应用仍为 v0.14.0。本轮交接文档在 `dev` 提交；开始新任务时重新检查真实分支和工作区，不能把这个 SHA 当作永久最新状态。
- 正式站点：[poplarity.github.io/BlotFigure](https://poplarity.github.io/BlotFigure/)；源码：[poplarity/BlotFigure](https://github.com/poplarity/BlotFigure)；[发布附件](https://github.com/poplarity/BlotFigure/releases/tag/v0.14.0)。`main` 推送会部署网站；`dev` 推送只触发 CI，不更新正式站点。
- 本轮只整理维护文档，不改变图像算法、交互或版本号，不新建发布标签。

## 在另一台电脑接手

1. Clone 仓库，读本文与贡献指南。检查 `git status -sb`、最近提交、`git worktree list`，再 `git fetch origin` 检查远程。保留现有未提交修改；不要用 reset/clean 清理别人的工作。
2. 在 `dev` 开发；已有工作树占用该分支时，到那个工作树操作或建立隔离分支。使用 `git pull --ff-only origin dev` 前先确认当前分支。正式版本复现使用标签的独立 checkout。
3. Node.js 22 与 CI 一致；`npm ci` 只安装测试工具。应用本身是静态 HTML/CSS/JS，正常使用可直接双击 `index.html`，无需 npm、后端或构建服务。
4. GitHub 登录用当前机器的授权。不要假设上一位 agent 的临时 Git 脚本、浏览器进程、端口、Python 依赖、凭据或本地路径仍然存在；这些不属于项目依赖。Git 网络失败要检查退出码，不能把本地提交当作已推送。
5. 跨电脑继续编辑实验请导出 `.blotfig` 项目，它包含全部输入图与状态。Git 不会同步浏览器历史、参数预设、自定义 Marker 缓存和“已看更新”状态；样式文件也不代替包含原图的项目文件。

```bash
npm ci
npx playwright install chromium firefox webkit
node scripts/check-updates.mjs
npm run build
node tests/run.mjs --suite=lanecount --browser=chromium
# 完整回归（包括全部三个浏览器）
npm test
```

Linux 缺浏览器系统库时用 `npx playwright install --with-deps chromium firefox webkit`。正常页面支持 `file://`；需要 fetch 本地测试数据时用本地 HTTP 服务。用真实浏览器时钟测存档与性能，不要把 `--virtual-time-budget` 的耗时当作实际性能。

## 已确定的产品边界

这些来自维护者多轮实际使用反馈，不是待探索的默认方案。新需求可以调整它们，但不要在常规“对标 GelFigure”或整理代码时自行撤销。

| 主题 | 保持的行为 |
|---|---|
| 轻量桌面工具 | Mac / Windows 浏览器与离线 HTML；不引入框架、云端图像处理或必须安装的运行依赖。当前不做手机/平板工作台，也不做多面板论文排图工具。小尺寸电脑窗口仍需可用。 |
| 图片分组 | 对外叫“图片组”。同一拍摄布局的各次曝光与可见 Marker 的白光/复合参考图放一起，一组可有多条膜。换布局且不能对应时另建组；不按蛋白名、亮度或最终排版顺序分组。 |
| 五步流程 | 分组与参考图 → 检查膜条 → 调整蛋白框/曝光 → 手动标 Marker → 名称、标注与导出。先确认上一阶段，再生成下一阶段内容；每步可展开返回修改，不要求从头再来。 |
| 蛋白区域独立 | 每个区域独立选曝光、调线性色阶、裁切和旋转。同一条膜上的两个框也独立；上下拖动只排序。取消自动拼接、拖动误拼与曝光联动。 |
| 轻量多列 | 可按任意样本/条件需要分列，不限定为重复对照；各列标签独立。横向排版不会绑定区域，更不把不同曝光拼成一个连续条带。 |
| 框与膜边界 | 膜条用于坐标、倾角和校准，不能充当遮罩。框可自由缩放、跨膜移动，预览必须显示实际框住的像素。 |
| 泳道数 | 自动识别前输入的是**参考数量**，不是切块尺寸或所有区域的强制值。同图 8/4/6 道可并存。手动新增框采用默认值；用户可单独改框内条数。 |
| Marker | 手动标记优先；起初不显示猜测刻度，不自动排除所谓 Marker 道。保留吸附、已标点辅助推测和参考示意；一条刻度可显示，至少两条才估算分子量。当前操作无需重做，仅修复有证据的严重问题。 |
| Marker 字体与位置 | 全局统一字号，不恢复单个区域字号覆盖。不用挪走数字、延长引线或偷偷隐藏数字来掩盖重叠；保持真实位置，让用户调全局字号/显示。kDa 不挤开条件行或制造整行空白。 |
| 名称与删除 | 成图上直接编辑，左栏避免重复名称输入。选框后 Backspace/Delete 可删，矩形多选可批量删；编辑文字或中文输入法组合期间绝不能误删框。 |
| 图像颜色 | WB 始终按灰度处理；不添加原色/灰度切换或 RGB 源图显示。**红色标注**可导出 RGB TIFF，这是保留标注色彩，不是源图原色功能。 |

## 代码地图与数据流

运行时采用普通 `<script>`、IIFE 和 `window` 全局；`package.json` 的 ES module 设置仅用于 Node 工具。脚本顺序见 [index.html](index.html)，单文件构建的列表在 [scripts/bundle-onefile.mjs](scripts/bundle-onefile.mjs)。新增运行脚本必须同步两处；漏项构建会主动失败。

| 文件 | 入口/职责 |
|---|---|
| `js/storage.js`, `js/i18n.js` | `PrefStorage` / `I18N` / `L`：容错偏好与双语文字。 |
| `js/tiff.js`, `js/engine.js`, `js/export.js` | TIFF 解码、通用图像函数、PNG/TIFF/SVG 与下载。源数据保持精度，显示缓冲与原始字节分开。 |
| `js/wbladders.js` | `ProteinLadders`：预染蛋白 Marker、自定义导入、持久缓存、定义冲突处理。 |
| `js/wbengine.js` | `WB`：图片类型、配准、膜条、局部蛋白信号、框内泳道、曝光评分；也有供诊断页使用的历史 Marker 算法。 |
| `js/wbdemo.js` | `WBDemo`：测试和宣传用合成图；不包含用户实验。 |
| `js/wbapp.js` | `BApp`（文件内部名 `App`）：状态、几何、确认/重新识别、曝光、撤销、项目、版式、导出数据。 |
| `js/wblibrary.js` | 扩展 `BApp`：多项目历史、原图去重、自动缓存、旧草稿迁移、参数预设。 |
| `js/name-text.js`, `js/figure-text.js` | `NameText` / `FigureText`：安全文字片段、字体测量、上下标/颜色、SVG 文本；与 GelFigure 复用思路。 |
| `js/wbnotes.js`, `js/wbnote-render.js` | `WBNotes` / `WBNoteRender`：与蛋白裁切分离的区域注释、放大图、侧边文字及来源锚点。 |
| `js/wbrender.js` | `BRender`：状态 → 以 pt 为单位的 SVG、命中区域、来源片段、最小字号。 |
| `js/pptx.js` | `PPTX`：原生可编辑文字/图形、可恢复裁切的图片、无依赖 ZIP。 |
| `js/wbview.js` | 原图画布、膜条/蛋白框/泳道/Marker 手势、缩放、拖动与矩形多选。 |
| `js/wbui.js`, `js/wbextras.js` | `UI` 与扩展：五步菜单、相册分组、曝光比较、成图编辑、历史和导入入口。 |
| `js/wbformat.js`, `js/wbnote-ui.js` | `Formatting` / `NoteUI`：桌面文字工具条、角度、注释手势与弹层。 |
| `js/support-config.js`, `js/feedback.js`, `js/export-support.js` | 作者已确认的反馈/支持配置、主动文本反馈、可关闭的导出后提醒。 |
| `js/releases.js`, `js/updates.js` | `BlotFigureReleases` 与更新界面：离线版本历史、每版本一次的提示。 |

主流程：输入原始字节 → 解码/分类 → 图片组和配准 → 用户确认参考图与膜条 → 检测局部蛋白区域及泳道 → 每区域曝光评分 → 用户调整与手动校准 → `BRender.build()` → 预览与导出。诊断 URL 可自动走过这些步骤，普通导入不能因此跳过用户确认。

### 状态、坐标和刷新

- `BApp.images` 保存原始文件、解码图和分析缓冲；`BApp.analysis` 是派生分析。可撤销/序列化状态在 `BApp.S`，不要把像素数组、DOM 或选择集合塞进去。
- `S.blots` 是图片组的历史内部命名；`blot.pieces` 是膜条；`S.rows` 是蛋白区域；`row.segs` 是该区域的源框/片段。单个框有稳定 `id` 和 B1/B2…标签。选中、移动、删除按框 ID，不能按膜条 `piece` 一起操作其所有兄弟框。
- 原图坐标 → 图片组对齐网格 → 膜条/框局部 `(u,v)` → 成图 pt 是四个不同空间。`rec.raw` 保留原图，`rec.img` / `rec.cs` 用于对齐后的采样；`S.align` 描述映射。用 `WB.frame/toImg/toFrame`、`BApp.segFrame`、`rehomeSeg` 等现有函数换算，不把预览坐标直接当原图像素。
- 跨膜移动、改图片类型、改参考图、重新对齐时保存用户框的实际位置。`reanalyze` 默认携带旧框与校准；`rebuildBoxes(ids)` 才显式替换指定图片组的检测结果，出错原子恢复，成功一次撤销。`boxesReady` 区分未生成与用户主动删空，返回步骤不能复活删除的框。
- `BApp.refresh()` 合并到下一帧，不记录历史；`commit()` 规范化状态、更新派生数据、快照、排队存档并发出 `change`。拖动中轻量 refresh，结束 commit 一次；不要在每个 mousemove 重跑全部分析/曝光评分或重建大幅图片。
- `undo/redo` 替换 `S` 对象，弹层/输入器/拖动持有的旧引用会失效。取消旧手势，用稳定 ID 重新找对象；不要将旧对象写回新项目。

### 检测、曝光与排版不能互相误伤

- 自动区域由实际局部信号与明确分隔产生，不用“全膜格点 × 条带高度”铺满候选框。保留 `signalLanes` 的真实位置；同一道不同高度的蛋白不能只留最高峰。
- `S.defaultLaneCount` 供参考、手动新框及明确批量操作；`sg.laneCount` 为当前框数量，`countOrigin` / `expectedLaneCount` 记录来源。不要将旧 0.11/0.12 的“固定条数拆整膜”说明恢复为现行算法。改识别要覆盖参考值 2–6、同图 8/4/6 道、弱/空道、窄伪影和多蛋白高度。
- `blot.dividerLane` 是明确指定的内部排除泳道。9 道、第 5 道为 Marker 时应生成左右独立区域；不能因某一道缺带就自动把样品当 Marker，或只留下其中一侧。
- 应用分析使用 `noCalib:true, autoMarkerLanes:false`。诊断页能运行自动 Marker 算法，不意味着应在用户工作流重新启用它。
- `row.img`、`row.auto`、`row.lv` 控制区域曝光与独立显示范围；无 `row.lv` 时继承 `S.levels[imgId]`。稳定的图像默认范围不随别的区域换曝光而重算。没有曝光时间信息就按信号比较，不能凭像素编造秒数。
- `runRaster` 对框住的像素采样，不按膜条外沿涂背景。拓宽边界应能找回边缘条带；既有源范围不能被成图 `range` 提前裁死。
- `mergeRows` 保留 disabled 兼容入口，旧绑定用 `splitRow/unbindAll` 拆开。相同 `cut.id` 的片段可来自同一区域排除内部泳道，不能把它与两个独立蛋白错误绑定混为一谈；不连续来源仍须保留分隔说明。
- `S.layoutColumns` / `row.column` 是排版列；`columnData()`、`columnState()`、`uiState()` 处理主列兼容字段。`BApp.columns()` 表示泳道格点，和 `layoutColumns()` 不是一个概念。导出遍历全部列，不依赖当前激活列；横向移动不改曝光/亮度。
- 默认 `style.border:true`、统一 `rowGapPt:2`，不同图片组不额外插入组间距。`mwSide` / `nameSide` 控制 kDa/蛋白名侧边。单位标题不能为所有条件行预留巨大空隙。

### Marker、文字和局部放大

- `pc.marks` 是实际校准点，具有稳定 `mark.id`。显示隐藏与校准数据分开；单点能显示，双点才能估算。Marker 型号参考图是示意，不是每张膜实际迁移距离。
- Marker 只读 `S.style.markerPt`，`commit()` 会删除旧 `row.markerPt`。字号继承修复不能重新引入每区域覆盖。
- 文字用 `NameText` 片段：纯文本加可选 `italic`、`script:'sup'|'sub'`、`color:'red'`；片段拼接必须等于原始文字。不要执行用户 HTML，不用 Unicode 替代字形假装上下标。旧项目/普通名称继续支持。
- 字体为本地系统白名单，不下载字体。lane 的 `nameStyle` 只在用户选择局部设置后存在；清除后恢复 `lanePt` 等共享设置。清除分组/条件的颜色还要清除关联线条颜色。
- 中文 IME 的 Enter 不确认、不跳到下一个字段；Backspace 仅在非文字输入时删所选框。Escape 恢复本次编辑前的文字与格式。界面文案用 `L('中文','English')` 或 `data-en*`，切换语言时重新求值，别在模块加载时缓存当前语言。
- `S.notes` 的注释框与蛋白裁切框是不同对象。区域注释以图片组坐标保存 corners，关联 row/box ID；放大图复用原区域曝光/线性色阶，不能另选一张更好看的来源。×2/×3/×4 放大要进入有效分辨率检查。注释跟随排序、分列、撤销、项目、预设和日志。

### 存档与缓存

- `.blotfig`：`BLOTFIG1` 头、JSON 状态/初始快照/图片元数据和原始字节，支持 gzip；恢复验证 SHA-256，按原 ID 重建。保存全部输入图，不只保存当前选中的曝光。`initial` 用于“回到刚导入时”；历史、项目和重置引用必须一起迁移。
- 多项目库在 IndexedDB `blotfigure` v1 / `drafts`：`project:<id>` 存状态，`img:<sha256>` 去重存原图，`meta` 指向最近项目。由 `wblibrary.js` 接管旧草稿 API；写入排队、状态先捕获、图像与元数据在同一事务，失败不删旧历史。不能恢复早期“新实验覆盖唯一草稿”的行为。
- 自定义 Marker 独立存在 `blotfigure-markers` v1 / `catalog` 的 `ladders`，兼容 `blotfig.customLadders`。等 `ProteinLadders.ready` 再恢复/使用，`flush()` 用于等待持久写入。删项目不能清空型号库。
- 导入遇到相同 ID、不同条带定义时保留两者，重映射导入项目、预设和 reset 初始快照；不能覆盖已被其他实验使用的定义。相同名称也不能作为同一型号的充分依据。
- 浏览器缓存不是跨浏览器同步或永久备份。保存失败要保留内存内容和导出项目入口；不要在未落盘时宣称已缓存。

### 导出与网络

- 同一行保持单一曝光来源；调整仅使用现有线性色阶，保留处理记录。PNG/TIFF 的 dpi 不等于原始图像的有效分辨率。新增绘图元素必须同时检查 SVG、PNG/TIFF 和 PPT。
- PPT 从 `BRender.build(false,true)` 的 SVG/`exportSlices` 映射到原生 DrawingML：文字、线条可编辑，图片引用完整处理图并使用 `a:srcRect` 裁切。禁止改成整图截图或只有裁后小图。接收者可恢复裁切范围；不承诺找回原始位深或未处理像素，原始字节在项目/原图导出中。
- 上下标/红色保留原生 PPT run 属性；新增 SVG 元素时更新适配器，不能静默丢掉不支持的元素。纯灰度 WB 加红色标注可用 RGB TIFF 保留色彩。
- 正常启动、编辑、自动存档和导出不自动联网。文本反馈仅用户明确提交时发往既有配置端点，不附图片/项目；测试拦截请求，不能真实发反馈。保留 CSP 的精确允许项。
- 支持入口和付款目的地已由作者确认，位于 `js/support-config.js`；不要替换、编造或把私密配置/激活链接写进仓库。提示必须可关闭，导出成功后才出现，失败导出不能触发。

## 按改动选择验证

`node tests/run.mjs --suite=<name> --browser=chromium` 运行一个套件/内核；不指定 browser 会跑三种。`npm test` 会自动构建单文件并跑完整测试。仅文档更新核对内容、链接、构建/打包所需文件即可，不必重复跑整套图像回归。

| Suite / 入口 | 应覆盖的改动 |
|---|---|
| `startup` | 存储禁用/配额、`file://`、离线单文件、起始页。 |
| `ui` | 五步、成图文字、基础导出、项目/样式往返、双语。 |
| `workflow` | 图片整理/拖放、独立区域、排序和旧绑定兼容、弱带和单点 Marker。 |
| `layout` | 独立多列、标签/条件、Marker 显示、跨列布局和多列导出。 |
| `usability` | 相册、步骤返回、统一字号、Marker 导入、预设、历史、缓存故障。 |
| `lanecount` | 框内数量/端点、清空后重建范围、数量输入的“应用”、存档兼容。 |
| `redetect` | 局部信号区域、再次识别、指定图片组、失败回滚和撤销。 |
| `iteration012` | 图片组引导、检查卡整卡点击、选框展开、分隔道两侧、kDa 与条件、PPT 和离线导出。 |
| `workspace` | `tests/workspace014.mjs`：小电脑窗口、多选/Backspace/IME、参考数 2–6、同图 8/4/6、自定义 Marker 持久化。 |
| `parity` | v0.14 文字格式/字号继承、颜色、来源注释/放大、可编辑 PPT、RGB 标注 TIFF、导入型号冲突。 |
| `community` | 更新提示/历史、主动反馈（mock）、支持入口、导出提醒、离线与网络边界。 |
| `test/boxlanes.html`, `test/ladderlane.html`, `test/register.html`, `test/engine.html` | 完整 runner 包含的算法检查；其他诊断页见 DEVELOP。实际应用的手动 Marker 流程不能仅用旧算法诊断页替代。 |

发布前跑完整三内核；修改导出时额外检查实际产物，不只验证“有下载”。可选 Windows PowerPoint 验证器是 `scripts/check-pptx.ps1`，调用时 `-Folder` 与 `-Names` 必须对应本次真实生成的 PPT，默认文件名可能不存在；不能将空报告当作成功。Office 另存文件可能带机器身份元数据，只放忽略目录、不公开。

交互回归使用实际 locator 点击/拖动，不靠 evaluate 绕过 UI。尤其泳道数“应用”：聚焦输入不得被刷新覆盖，mousedown 防止 blur 重绘移动按钮，click 读取当前草稿；测试不要拿刷新前的旧屏幕坐标点击。独立弹层精确选 ID，避免 `.popover` 误选到隐藏弹层。

CI 在 `main` / `dev` 推送和 PR 运行 Node 22 + 三内核。检查 workflow 的 **SHA、状态和结果**；浏览器安装失败、取消、未结束不能说成应用通过/失败。先定位失败步骤再修代码。真实 TIFF 不在仓库；更换机器后缺样本时明确说明验证仅覆盖合成图，不虚构已跑私人样例。

## 提交、发布与交接更新

1. 默认开发提交并推送 `dev`，供维护者检查；只有明确要求“合并 / 发布”后才更新 `main`。不要因之前某一版获准发布就自动发布后续功能。纯文档不升应用版本；同步到哪些分支按当前授权，不夹带待审功能。
2. 功能发布时更新 `js/wbapp.js` 的 `App.VERSION`、`package.json` / lock 两处、`CITATION.cff` 的版本/日期、两份 README 和入门指南、`index.html` 的下载链接。全库检查旧版当前下载地址，历史日志/旧标签保留原样。
3. `CHANGELOG.md` 增加对应版本与日期（含中文摘要）；`js/releases.js` 最新版本与 App 一致，每种语言 1–3 条短摘要，保留旧版本。执行 `node scripts/check-updates.mjs`、`node scripts/release-notes.mjs vX.Y.Z`、`npm run build` 和完整回归。
4. 合并前 fetch，检查远程没有意外前进。可用 `release/<旧版>` 保存上一正式版本；已有备份不覆盖。合并已审查提交，创建带注释的 `vX.Y.Z` 标签；不移动已发布标签、不强推 main。
5. `pages.yml` 部署 main 的 `index.html/css/js`；`release.yml` 由 `v*` 标签触发，生成单 HTML 和源码 ZIP。新增必须交付的文件要更新 ZIP 的显式复制列表。交接文档属于源码包，网站无需展示它。
6. 核对目标提交的 CI、Pages、Release，打开真实站点和下载的 release HTML 验证新行为。后来的文档提交不会更新已经发布标签的附件；不要擅自替换旧版发布物。Windows/Linux 比较文本构建时可规范化 CRLF/LF。

提交身份沿用 `poplarity <145547323+poplarity@users.noreply.github.com>`，在当前仓库检查 `git config user.name/user.email`。不提交私人邮箱、机器路径、凭据、用户 TIFF、项目/处理日志或真实实验截图。`.gitignore` 已屏蔽常见数据扩展名，但不能代替审查 `git diff --cached`。

以后大改完成或发布时更新本文的接手日期、版本/标签、验证证据、已解决/待复现问题。把“已实现”和“计划”分开；有细节放对应文档并链接，不保留相互矛盾的多份规则。

## 文档与宣传素材

- [docs/dev-parity-plan.md](docs/dev-parity-plan.md) 是 v0.14 已完成范围记录，不是新一轮授权清单。GelFigure 的原色/手机/Marker UI 设计不能直接搬到 WB。共享函数可参考其当前实现，但先核对 WB 的独立区域数据模型和回归。
- 首页 `docs/example-figure.png` 使用已经校正的宣传成图：三行、名称左、kDa 右、紧凑条件、等间距。`node scripts/docs-screenshots.mjs --showcase` 仅更新主成图与两种语言首页截图；不带参数还会更新图库/流程/多列示例。运行前确认确实需要替换这些资源。
- 截图用合成 `WBDemo`，当前首页 UI 图为 1920×1080；两种语言各自全新加载。更换图片可更新 README 的资源查询参数刷新缓存。截图、宣传与视频不得混入真实实验数据。
- 小红书图文、视频和朋友圈海报已交付，编辑源保存在维护者另行保存的宣传目录，不属于 git clone 内容。没有这些文件时说明缺少素材，不假设绝对路径可用。已确认的五个重点是选曝光、多图裁切、歪条带转正、Marker/分子量、图注排版。宣传视频不放链接/二维码；朋友圈单张海报应带工具二维码，这两个要求不要混淆。

## 待复现事项与实际限制

- **观察到、尚未修复：** 首页截图时，先加载英文再切中文，个别动态文字工具控件或标题可能保留旧语言。各语言新页面加载截图可避免混杂，但不是运行时修复。若处理双语问题，要测试同一会话双向切换。
- **待确认范围：** 旧截图过程中英文顶栏在较窄宽度有拥挤现象；v0.14 已有小屏控件回归。区分主顶栏与成图工具栏，实际复现后定位，不能因 1920 宽截图正常就宣称所有窗口都无溢出。
- `DEVELOP.md` 的“已知待办”与逐版本模型是历史记录，部分已被后续版本解决（拼接、单草稿、区域 Marker 字号、按参考数切块等）。先核对当前代码和本文，再决定是否仍为问题。
- 自动分类/配准/识别受复合参考图、弱带、不规则摆膜影响。保留用户纠正与显式重新识别入口，不宣传每张图都自动正确；无曝光时间时不能还原真实拍摄时长。
- 字体是本地系统字体，不保证每台电脑完全相同；PPT 可恢复裁切的是完整**处理后**图像；缓存跨设备不自动同步。

与维护者沟通用简明中文，先说结果、验证和剩余限制。复现用户报告后区分真实 bug 与难发现的操作，两者都可能需要改善体验；不要把“用户没找到入口”当作无需处理的理由。
