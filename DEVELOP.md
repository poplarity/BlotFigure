# 开发与调试说明

纯前端，无构建、无依赖。改完 JS/CSS 刷新浏览器即可看到效果。

## 在一台新电脑上开始

```bash
git clone https://github.com/poplarity/BlotFigure.git   # 公开仓库；推送到 main 就是更新 poplarity.github.io/BlotFigure
cd BlotFigure
# 双击 index.html 即可使用；之后更新用 git pull
```

- Mac：Chrome / Edge / Safari 都行；Windows：Chrome / Edge。
- 真实样例图**不在仓库里**（`.gitignore` 挡掉了 tif/png/csv），调试真实数据时自己拷一份到仓库外的目录，比如 `../BlotFigure_samples/real1/`。
- 调试页用 `fetch` 读本地文件，浏览器需要允许 file 访问：Chrome/Edge 加启动参数 `--allow-file-access-from-files`。也可以在仓库上一级目录起本地服务器，比如 `python3 -m http.server`，再用 `http://localhost:8000/BlotFigure/...` 打开。

## index.html 的调试参数

| 参数 | 作用 |
|---|---|
| `?demo=1` | 载入合成示例（一张切成 3 条的膜加一张斜放的膜） |
| `?srcdir=<目录URL>&srcs=a.tif,b.tif,...` | 直接载入一组图片，跳过拖放 |
| `&step=1` … `5` | 脚本运行时一次走到第几步（默认 5：Marker 图和膜条按识别的、生成蛋白框，打开第 3 步）；`1` 停在确认 Marker 图，`2` 停在检查膜条（调整膜条模式） |
| `&ladder=br_pp` | 指定 Ladder 型号（id 见 `js/wbladders.js`；你的 Bio-Rad 1610374 是 `br_pp`） |
| `&sel=0` | 选中第 n 个可见行，展开它的曝光对比 |
| `&annot=1` | 填入示例蛋白名、泳道名和分组 |
| `&png=600` | 按 600 dpi 渲染成图，base64 放在隐藏的 `<pre id="figpng">` 里 |
| `&exports=1` | 跑一遍"未裁切原图"和"定量 CSV"导出并记录文件大小；未裁切原图的 PNG 放在 `<pre id="rawpng">` 里 |
| `&border=1` | 打开"条带加边框" |
| `&selpiece=B` | 选中的行跨几条膜条时，泳道工具对准膜条 B 上的那个框（需同时用 `&sel=`） |
| `&zoomsel=1` | 膜图放大到选中的行（截图用） |
| `&mode=marks` / `&mode=addrow` / `&mode=pieces` | 进入标 Marker（`&markpiece=D`：放大到膜条 D） / 添加蛋白框 / 调整膜条模式 |
| `&draft=1` | 脚本运行时也写自动草稿（平时带调试参数载入时不写，免得盖掉真正的草稿）；脚本运行时 SHA-256 用纯 JS 算（无界面的虚拟时钟下 WebCrypto 不返回） |
| `&tour=1` | 脚本运行时也显示首次打开的三栏引导（平时只在 `localStorage` 没有 `blotfig.tour` 时显示一次） |
| `&nochemi=1` | 认膜条切缝、找 Marker 道时不对照曝光图（对比用） |
| `&pose=merge` / `align` / `order` | 在成图上停在拖动的半路（截图用）：把拆开的 B 行拖到 A 行上 / 把膜条 C 往右拖一列 / 把最下面一行往上拖 |
| `&move=a.tif:2.5,140,85;b.tif:…` | 载入时把这些图里的膜当作挪动过（旋转度数、x、y 像素），模拟两次拍摄之间膜被挪动；用来测自动认膜和对齐 |
| `&demomove=a,tx,ty,a2,tx2,ty2` | 示例膜再加一次"后来的拍摄"（一张曝光图和它的白光图）：整张膜挪动 `a,tx,ty`，中间那条膜条另外再挪 `a2,tx2,ty2`（膜条切出、其余挪动、膜条放到新位置）；测认出是同一张膜、单条膜条单独对齐 |
| `&lang=en` / `&lang=zh` | 界面语言（不带时按上次的选择，第一次按浏览器语言）。回归基线是中文界面取的，脚本运行请带 `lang=zh` |
| `&noalign=1` / `&dbg=1` | 不做对齐（各张图保持原样） / 标题 JSON 的 `dbg` 里记下认膜时的配准过程 |
| `&popimg=12` / `&alignimg=12&alignby=dx,dy,度&alignhold=1` | 打开第 1 步和名字以 12 开头的图的 ⋯ 菜单 / 进入它的手动对齐并拖动（`alignhold` 停在拖动中，截图用） |
| `&scrollto=secRows` | 把左侧面板滚到某个元素（截图用；`&sel=` 选中的行会自动滚到能看见） |
| `&scenario=…` | 脚本化地跑一遍编辑功能，每步状态记在标题 JSON 的 `scen` 里（每行：`膜条:起始列:泳道角色` 和成图列）：`lanes` 框的缩放、框内重新识别、均分、加减/切换泳道、挪列、拼接行跟随；`drag` 用鼠标/键盘事件在膜图上拖角柄、拖竖线、双击加道、Delete、移动框、框选添加；`detect` 每行的框在每张曝光里只按框内像素识别的结果（原框 t、整条膜条宽的框 l）；`stitch` 为旧诊断入口；合并操作现返回 disabled，请用 workflow 套件测解绑；`arrange` 用鼠标事件在成图上排列：上下拖行、落到另一行上也只排序、按蛋白框左右拖（其他框不动）、往左最多到第 1 列（已经在第 1 列的不动，也不推别的行；差几列的只挪到第 1 列）、拖标签、列表里拖、Alt+↑↓；`realign` 手动对齐曝光 12：拖动、[ ] 旋转、完成、撤销/重做、不对齐、恢复自动（每步记下对齐参数和像素签名）；`kind` 先改一个框和行名，再把 09 改成白光又改回、01 改成曝光图又改回、14 移到新膜又移回、重新对齐、移除 07，每步记下所有框（膜条字母、位置、范围、列）——调过的东西都应保持不变（加 `&dbgpcs=1` 还记下膜条和每条候选切缝的判定）；`marks` / `picker` 手动 Marker 的数据层（没标时没有分子量，1 条也没有，2 条才有；清除）/ 分子量选择框；`mark2` 用鼠标和键盘标 Marker：选型号后记住、点膜条标签放大（开始时一条刻度、一个推算位置都不显示）、在条带旁 3 px 点一下（吸附到带上，第一条不推荐大小）、第二条推荐型号里的下一个、标满 2 条后才出现虚线的推算位置、拖刻度吸附（Alt 不吸附）、"不加了"、输入分子量、从选择框删除、↑↓、Delete、点虚线的推算刻度、下一步、清除这张膜的刻度；`focus` 在左侧列表里输入蛋白名（输入框不应丢焦点，回车跳到下一行）；`edit2` 在 C、D 两条膜条之间的缝上拖出一个框（成图应正好是框住的部分）、把它拖到 D 上（归到 D）、拖最右一条泳道线（中间均匀排开；Alt 只动这一条）、改泳道数多一道，再调整膜条：C 右移、D 下边上移并旋转、删掉 E、画一条新的、应用，撤销 / 重做；`proj` 保存项目再打开，所有行、刻度、显示范围应与之前完全一样；`perf` 拖一个框的右边 20 次，记下每次鼠标移动和刷新成图的耗时（`window.__perfRun` 可以在性能分析器下再跑一遍）。`lanes` `drag` `detect` `stitch` `arrange` `realign` `kind` `edit2` `proj` `perf` 用真实样例（膜条 A–E），`marks` `picker` `mark2` `focus` 用示例（`demo=1`） |

载入完成后页面标题变成 `READY {...}`，里面是各张图的对齐（`align`：`grid` 网格基准图、`marker` 读膜条和 Ladder 的白光图、每张挪动过的图 `名=角度,tx,ty+单独对齐的膜条/依据`）、膜、膜条（`pieces`：分析得到的泳道格点与 Ladder 位置 `lad`）、行（`rowsGeo`：每个框 `膜条:vc:起始列:泳道角色`、框的范围 `box`、成图列 `cols`）、曝光、显示范围（`levels`）、警告等状态的 JSON，方便脚本检查。

## 自动测试、单文件版与发布

```bash
npm install                                   # 只装测试用的 Playwright
npx playwright install chromium firefox webkit
npm test                                      # 三种内核；npm test -- --browser=chromium 只跑一种
npm run build                                 # 生成 dist/BlotFigure.html（单文件，双击可用）
node scripts/docs-screenshots.mjs              # 用合成示例重做中英文截图及示例成图，不读取真实数据
```

`tests/run.mjs` 起一个本地 HTTP 服务，在每种内核里跑：`tests/startup.mjs`（浏览器存储被禁用 / 写满、`file://`、单文件离线、语言切换、示例能载入）、`test/boxlanes.html` `ladderlane.html` `register.html`（等 `window.__done`，标题里 `fails` 为 0）和 `engine.html`（不报错）、`tests/ui.mjs`（英文界面在示例膜上走一遍：五步、成图上输入泳道名、导出前检查、PNG / TIFF / SVG / 日志逐字节检查、项目与样式文件往返、回到刚导入时、草稿、分组不重叠、目标条带箭头、语言切换，以及英文界面里不能残留中文），最后从另一个源检查页面发不出任何请求。CI（`.github/workflows/ci.yml`）每次推送都跑。测试只用合成示例，不用真实样例。

单文件版：`scripts/bundle-onefile.mjs` 把 `css/` 和 `js/` 按 `index.html` 里的顺序内联（新加的脚本要同时加进这个脚本的列表，漏了会报错），把 CSP 换成允许内联脚本的版本。

界面语言：`js/i18n.js`（与 GelFigure 相同）。JS 里写 `L('中文', 'English')`（调用时求值，切换语言后重新渲染即生效，不要在载入时就算好）；HTML 里把英文放在 `data-en` / `data-en-html` / `data-en-title` / `data-en-placeholder`。切换时先把带 `data-en` 的元素恢复成静态文字，再调用 `I18N.onChange` 的回调重新渲染脚本写的内容。成图、图注、日志、CSV、文件名一律英文；国内厂家的 Marker 型号 `name` 是英文（进图注），`zh` 是中文界面显示的名字。偏好存在 `PrefStorage`（`js/storage.js`：存储不可用时退回内存，开始页和第 5 步显示提示）。

发布新版本：
1. 改版本号：`js/wbapp.js` 的 `App.VERSION`、`package.json` / `package-lock.json`、`CITATION.cff`（和日期）；`README.md`、`README.zh-CN.md`、`docs/getting-started*.md`、`index.html`（开始页的离线版链接）里的下载链接。
2. `CHANGELOG.md` 加 `## [x.y.z] - 日期` 一节（发布说明从这里取，没有这一节发布会失败）。
3. 提交、推送 main（网站随之更新），再打标签 `git tag vx.y.z` 并推送标签：`.github/workflows/release.yml` 生成 `BlotFigure-vx.y.z.html` 和源码 ZIP，建 Release。

## 测试页（test/）

| 页面 | 用途 |
|---|---|
| `engine.html` | 算法自测：合成膜带真值对照（行位置、角度、泳道数、kDa、曝光选择），改了 `wbengine.js` 必跑 |
| `boxlanes.html` | `WB.detectBoxLanes`（框内识别泳道）自测：15 种合成框，每种写明应识别出的泳道，标题里 `fails` 应为 0，改了框内识别必跑 |
| `register.html` 或 `register.html?dir=<目录URL>&names=a.tif,...` | 对齐自测，标题 `REG {fails}`：合成膜平移、旋转后找回（含一道泳道的周期性误配）、后一次拍摄中整张膜挪动且一条膜条又单独挪动（每条膜条各自找回）、另一张膜对不上；接真实样例时：白光图分成三个位置、曝光图和同次拍摄的白光图一致、复制图挪动后找回、膜条各自挪动后单独找回 |
| `classify.html` 或 `classify.html?dir=&names=&kinds=m,c,…` | 曝光图 / 白光图的自动区分（不看文件名），原样以及压到 1/4、1/10 灰度范围时各判一次，标题 `CLASSIFY {fails}`；不带参数用示例膜 |
| `ladderlane.html` | Marker 道识别自测，标题 `LADDER {fails}`：合成膜在白光图里把样品条带画黑、Marker 带变浅（40/25/18/12%），每种情况对照曝光图和不对照各跑一遍，检查 Marker 道的位置和各行的 kDa；改了 `findStrips` / `findLadders` 必跑 |
| `register2.html?dir=&names=` | 曝光图两两对齐、曝光图按膜的轮廓对白光图（跨模态，不可靠，只作参考） |
| `glow.html?dir=&names=` | 画出每张图对齐时比较的特征（曝光：条带；白光：膜的边缘和 Ladder）和曝光图里膜的底光 |
| `timing.html?dir=<目录URL>&names=a.tif,...&ladder=br_pp` | 真实数据：各步骤耗时、行、每行每张曝光的评分（过曝、信噪比、得分） |
| `ladder.html?src=<marker图URL>&pitch=140` 或 `?demo=scatter` | Ladder 条带识别结果和中间量 |
| `markerview.html?src=<图URL>&s=0.5&ys=664,808` | 画一张图加 y 刻度，在指定 y 处画标记，用来人工核对条带位置 |
| `strips.html` `geom.html` `inspect.html` `view.html` | 膜条分割、几何、分类等单项检查 |

无界面运行（Windows 示例，Mac 换成 Chrome 路径即可）：

```powershell
msedge --headless=new --disable-gpu --user-data-dir=$env:TEMP\wb_dbg --allow-file-access-from-files `
  --virtual-time-budget=400000 --dump-dom "file:///.../BlotFigure/test/engine.html" > out.html
```

注意：无界面模式下 `alert()` 会卡住；`File.arrayBuffer()` 也会卡，所以调试入口都用 `{name, buffer}` 载入。`--virtual-time-budget` 下时钟是虚拟的：`performance.now()` 量不出耗时，gzip 流（保存项目）也走不完，这类检查（`proj`、`perf`）用 Playwright 在真实时间里跑，例如借 GelFigure 的 `node_modules`：`chromium.launch({ args: ['--allow-file-access-from-files'] })`，打开带参数的页面，等标题变成 `READY`。每次运行用一个新的 `--user-data-dir`：页面在 `localStorage` 里记着上次选的 Marker 型号（`blotfig.ladder`）、看过引导（`blotfig.tour`），沿用旧目录会改变结果。

## 数据模型（每个框有自己的泳道）

- 5 步：`S.step` 是做到第几步（存在状态里，撤销跟着走；老项目没有它，打开时当作 5），`App.curStep` 是界面上打开的那一步。第 1 步确认每张膜的 Marker 图（`App.setMarkerImage`：任何一张都可以，曝光图会改成 Marker 类型；换了就按它重新找膜条）；第 2 步只看、改膜条（`'pieces'` 模式），这时还没有行；"下一步"先应用改过的膜条，再 `App.makeBoxes()` 给还没有行的膜生成行（`App.rowsFromAnalysis`），每个框 `App.levelBox` 摆正；第 4 步是 `'marks'` 模式。`App.addFiles` 不再生成行，`App.reanalyze` 只在 `S.step >= 3` 且一行都没有时（或 `{fresh: true}`）才生成。`wbui.js` 的 `openStep` / `nextStep` / `renderSteps` / `updateCoach` 管步骤的展开、完成和顶栏提示。
- 膜（blot）里有若干膜条（`blot.pieces`），每条膜条有自己的坐标系（以膜条中心为原点，u 沿泳道方向，v 向下）。分析给每条膜条一套泳道格点（第 m 道在 `u0 + m*pitch`，`roles[m]` 为 `sample` / `ladder` / `skip`，样品道从 `col0` 列起，`App.pieceSlots`）和 Marker 白光图上 Ladder 所在的位置 `ladderUs`；这些只用来给新框定初始泳道和列号。
- 行（一个蛋白）在它跨过的每条膜条上有一个框 `segs[{piece, vc, b0, b1, x0, x1, lanes, c0, p}]`：框横向 `x0..x1`、纵向 `vc-above … vc+below`（`above/below` 是整行共用的，各框一样高），条带 `b0..b1`（相对 vc）。`lanes [{u, r}]` 是框里的泳道（`r`：`s` 样品 / `m` Marker / `x` 不用），样品道依次放进成图的 `c0, c0+1, …` 列（`App.segCols`），`p` 是只剩一道时用的间距。
- 框的编辑都在 `wbapp.js`：`App.setBox`（缩放/移动：框内的泳道不动，新地方按间距补，留下的泳道保持列号）、`App.redetectBox`（`WB.detectBoxLanes`，只看框里的像素）、`App.evenBox`、`App.addLane / removeLane / moveLane / cycleLane / nudgeLanes / scaleLanes`、`App.shiftCols`；包在 `App.editLanes` 里，拼接行里右边的框会跟着左边的框挪列。改完框后 `App.findBand`（`WB.bandInBox`）在框里重新找条带。
- 成图的列、每行每列的来源、留白位置都由 `App.columns()` 算出（相邻两列不是同一个框里相邻的两道就留白）；`wbrender.js` 把同一个框里相邻的几道画成一张图（预览里带 `data-row` / `data-piece`，拖动排列靠它们找到行和膜条）。
- 排列（成图怎么摆）和识别（每条膜条里有什么）分开：成图从上到下就是 `S.rows` 的顺序（`App.moveRow` / `moveRowBy`）；左右位置是每个框的 `c0`（`App.shiftAlign` 默认挪这条膜条上的所有框，因为它们共用泳道）；‹ / 往左拖最多到第 1 列（`App.shiftCols` / `shiftAlign` 夹在第 1 列，不再推着别的行往右），`App.commit` 里的 `trimLeft` 去掉左边没有框用、也没填名字的空列（泳道名、条件、分组、范围一起挪）；`App.mergeRows` 把两行并成一行（不同膜、同一膜条、上下叠放的膜条都拒绝）。
- Marker 只有手动刻度：`pc.marks`（`{u, v, kda}`，`null` = 还没标）。分析不再按条带读 Ladder（`analyzeSession` 的 `opt.noCalib`），`App.pieceCal` 只用标了分子量的刻度，≥ 2 条才有标定。`App.markInfo`：`manual` 可算分子量（≥ 2 条）/ `few` 1 条 / `none`；顶栏和第 4 步只数成图用到的膜条（`App.usedPieces`）。点下去的位置吸附到 Marker 图这一道上最近的条带（`App.ladderPeaks`：深色和亮的带都算，复合图里条带是亮的；`App.snapMarkV`）；新刻度的分子量建议（`App.suggestKda`）：第 1 条没有，第 2 条是型号里点击那一侧的下一个，≥ 2 条后按标定推算（只推型号里还没标的大小）；推算的虚线位置也是 ≥ 2 条后才画（`wbview.js` 的 `marksOf`）。刻度所在的道是已有刻度的中位 u（`App.markLane`），没刻度时不猜。
- Marker 型号：`blot.ladderId`；用户选过的型号存在 `App.prefLadder`（`localStorage` 的 `blotfig.ladder`），新载入的膜默认用它（`App.setLadder`）；第 4 步选型号时，其他还没选型号的膜一起用它。
- 框可以单独倾斜：`sg.rot`（度，相对膜条，±15°）绕 `(sg.pu, sg.vc)` 转（`App.segFrame` 给出框自己的坐标系，成图、膜图、框内识别都用它）。`App.setSegRot` 转的时候保持框的中点在图上不动（先把转轴移到框的中点）；`App.levelBox` 按框里各道条带中心的 Theil–Sen 斜率摆正（≥ 3 道清楚的条带、残差小、0.15°–6° 才转）。框移到别的膜条上时 `rot` 按两条膜条的角度差换算。转过的框，它旁边的刻度和这一行的分子量都按框自己的坐标算（`marksIn` 把膜条上的刻度换到框的坐标里：框里水平的条带，对应的是沿框的倾斜方向、而不是沿膜条方向的那条 Marker 带）。
- 每行单独的显示范围：`row.lv = {black, white}`（没有 = 用整张图的 `S.levels[imgId]`，`App.rowLevels` / `App.rowMapper`），`runRaster` 的缓存键里带着它。膜图上方的滑条在选中一行、且显示的是这一行的曝光时只改这一行（"改整张图"切回整张图）。
- 分子量刻度和蛋白名的位置：`S.style.mwSide` / `S.style.nameSide`（`'left'` / `'right'`），`wbrender.js` 先排各行、量出刻度宽度，再从条带往外依次放：刻度、目标条带箭头、蛋白名（各在自己选的那一边）。
- 目标条带箭头 `S.arrows [{row, db, sym, side, text, auto}]`：`db` 是相对这一行第一个框里条带中点（`vc + (b0 + b1) / 2`）的位置——框被拖动（`vc` 和 `b0/b1` 反向变化）、转动、换算到别的膜条上时条带中点都留在膜上原处，所以箭头不用跟着换算。`App.addArrow` 在点击处附近找条带吸附（`App.snapBandV`，`WB.bandInBox` 只看点击处上下一个条带高的范围）；`App.arrowSize` 用这个框坐标里的标定（`App.pieceCal(b, pc, sg)`），超出标过的刻度范围时加 ≈；`App.arrowLabel` = 名称 (大小)。`*` 在 `text()` 里是斜体标记，所以符号用 `symText` 原样画。`App.commit` 去掉指向已删除行的箭头。
- 框不受膜条边界限制：成图画的是框住的像素（`App.runRaster` 不再把膜条外的部分涂成背景）。框仍在某条膜条的坐标系里（它的角度、Marker、成图里的模块），移到另一条膜条上时（`App.rehomeSeg`，按框的中点）换算到那条膜条的坐标里，图上的位置不变。添加的框（`App.addRowBox`）保留画的范围，按框里识别出的泳道间距等分成几道（`App.evenBox`），再摆正；在膜上点一下添加时框的大小取这条膜条上其他框的中位宽高（`App.defaultBox`，鼠标下先画出虚线预览）。
- 泳道（GelFigure 的"首尾泳道等间距"）：拖最左 / 最右一条泳道线时中间的泳道均匀排开（`App.dragLane`，Alt 只动这一条），修改泳道数立即在首尾两条之间等分（`App.evenEnds`）。框的左右边拖出第 1 列以左时 `sg.c0` 暂时 < 1，`App.commit` 里 `roomLeft` 给所有行在左边补列。
- 膜条可以手动调整（第 2 步的 `'pieces'` 模式，`wbview.js` 的 `pedit` 是工作副本，点"下一步"或离开第 2 步时才生效）：`App.setPieces(blot, list)` 把膜条存进 `blot.userStrips`（`{id, cx, cy, angle, w, h}`，网格坐标），之后的分析都用它们（`analyzeSession` 的 `opt.strips`，按顺序，id 跟着走），框按 id 换算、留在图上原处，删掉的膜条上的框交给最近的一条；`null` = 回到自动。撤销 / 重做后 `App.syncPieces` 发现分析用的膜条和状态里的不一致就重新分析。
- 拖动时（`App.dragging`）成图跟着刷新，但不重新评分各张曝光、不重算警告；膜图上行标签的 ★ 用上次提交时的推荐曝光（`App.bestSeen`）。`WB.evalExposure` 用定长类型数组和原生排序（一个框可以有几十万像素）。
- 项目文件（`App.saveProject` / `App.openProject`）：`'BLOTFIG1'` + 头的长度（u32）+ 头（JSON：状态 `S`、导入时的状态 `initial`、每张图的 id / 名字 / 类型 / 曝光时间 / 字节数 / `sha256`）+ 各张图原样的文件字节，整体 gzip（浏览器支持 `CompressionStream` 时）。打开时（`restoreFrom`，草稿也走它）核对每张图的 SHA-256，按原 id 解码图片，套用 `S.align`，再分析每张膜（膜条 id 按位置对上，框、刻度原样）。`rec.src` 是载入时的文件（`File` 或 `{name, buffer}`），保存时才重新读。
- 自动草稿（和 GelFigure 一样，IndexedDB 库 `blotfigure` / 表 `drafts`）：`img:<sha256>` 存每张图的原始字节（每张只写一次），`meta` 存状态、`initial`、图片列表和开始页显示的摘要；`App.commit` 之后约 1 秒写（`saveDraftSoon`）。另一个会话的草稿会被这一个替换；`file://` 下有的浏览器打不开 IndexedDB（3 秒超时），草稿是尽力而为。"新建"先 `dropDraft` 再刷新。
- "回到刚导入时"：`App.initial` 是载入图片、分析完那一刻的状态（之后再添加图片时更新）；项目和草稿把它一起存下，打开后仍回到当初导入时。0.7 以前的项目没有它，`App.initialAsOpened` 为真，回到打开时的样子（确认框里会说明）。`App.resetAll` 是一次普通的提交，可以撤销。
- 样式文件（`App.template` / `App.applyTemplate`）：泳道名、分组和条件行（按成图第一列起的相对位置）、蛋白名从上到下、Marker 型号、`S.style`；套用时按顺序对应，多的忽略。
- 导出前检查 `App.preflight()`：`[{level: 'block' | 'warn' | 'info', text, fix?: {label, run, leave?}}]`，`leave` 的修正是跳回某一步（关掉对话框）；`wbui.js` 的 `preflight()` 只在有 block / warn 时弹出，选择记在 `localStorage` 的 `blotfig.preflight`。最小字号来自 `BRender.build().minPt`（实际印出来的最小字，占位灰字不算）。
- 处理日志 `App.processingLog()`（JSON）和嵌进 PNG / TIFF 的摘要 `App.summaryText()`；`export.js` 写 PNG 的 `pHYs`（dpi）、`sRGB`、`iTXt`（Software、Description），TIFF 为 LZW 8 位灰度带分辨率。
- 文字标记（`wbrender.js` 的 `runs` / `litStar`）：`*斜体*` 的星号只在后面紧跟非空白时开、前面紧跟非空白时关（同 Markdown），配不上对的星号原样显示（`WT*`、`siRNA* ctrl`、`**`）。分组文字换行（`wrapText` / `balancedWrap`）把斜体开关换成私用字符 `TOG`，原样的星号换成 `LIT`，所以行尾、行首补上的开关不会和用户打的星号混淆。
- 行旁括号 `S.brackets [{r0, f0, r1, f1, side, text, pt}]`：从行 `r0` 的 `f0`（0 = 上沿，1 = 下沿）到行 `r1` 的 `f1`。按行存，所以行换顺序、框改高度时括号跟着行走；一端的行删掉时 `App.commit` 去掉它；一端的行隐藏时停在范围内最近的可见行。排版在刻度、箭头、蛋白名之外，窄的先放，同一边真正重叠的才往外错开一列（上下相邻的共用一列）。工具在 `wbui.js` 的 `'bracket'` 模式（`bdrag`、`rowAtY`：离行边 20% 以内吸附到行边，Alt 不吸附；点一下 = 整行）。
- Marker 型号列表（`wbladders.js`）与 GelFigure 的预染蛋白 Marker 一致（含 `ref` 参考带、`vendor` 分组），只去掉了在膜上看不见的非预染 Marker；老的 id（`br_pp` 等）不变。标 Marker 时右上角的参考图（`ladderCard`）按 log 分子量等距画。
- 重新分析（改图片类型、移图、移除图、重新对齐）用 `App.reanalyze`：膜条按位置和大小一一对上旧的（保留 id、字母、手动刻度），行和框原样保留，只把框换算到新膜条的坐标里（`carryRows`）；只有"重新识别"（`{fresh: true}`）才丢掉现在的行重新识别。`findStrips` 认切缝时，一条暗线如果大部分落在曝光图里一条带的正中（不是旁边强带的拖尾），就当作条带而不是切缝。
- 同一张膜的各张图在同一个网格上：`blot.frame` 是网格基准（大多数图所在位置的一张白光图），`S.align[imgId] = {a, tx, ty, pieces: {pieceId: {a, tx, ty}}, how: 'auto' | 'manual', by}` 把网格坐标映射到这张图的原图坐标（绕图片中心旋转 a 度再平移；`pieces` 是单独挪动过的膜条自己的变换）。没有条目 = 和网格一致。原图留在 `rec.raw`，`rec.img` / `rec.cs` 是重采样到网格上的图（`App.applyAlign`；撤销/重做后 `App.syncAlign` 重新采样），所以别的代码都直接用对齐后的图。分析读膜条和 Ladder 的白光图（`blot.marker`，保持最先那张：之后拍的白光图常透出曝光里的强带）用原图读，再按它的变换映射到网格（重采样会把膜条之间几个像素的切缝糊掉）。
- 对齐流程（`App.alignBlot` → 分析 → `App.alignPieces` → 有变化再分析）：白光图对第一张白光图配准、按位置分组，最多图的位置作基准；曝光图两两比相似度连成一棵树，每条边用弱的一张作参考配准、沿树合成，再整体落到某个白光图位置上（贴近 6 px 以内的取那个位置；白光图不少于曝光图时取最近的位置）；分析出膜条后，每张白光图的每条膜条单独配准，曝光图沿用同位置白光图的膜条变换。载入时不同组的白光图配准后相关 ≥ 0.9 的并成一张膜（`sameMembrane`）；整体对不上、但每条膜条单独配准后都对得上（按面积平均 ≥ 0.85、每条 ≥ 0.6）的也并（膜条被单独挪过）；只有曝光图的组不自动合并。配准本身在 `wbengine.js`：`registerRigid`（相位相关多角度粗搜 + 归一化相关细搜，粗搜保留多个峰以免差一道泳道）、`registerPieces`（膜条窗口内先粗后细，必要时在可达范围内粗搜）、`regWarp`（按膜条分段重采样，饱和像素保持饱和）。
- 初始列号由 `WB.assignColumns` 给出（原位对齐 → 并排续接 → 从第 1 列开始）；框选添加的行用 `App.alignSeg` 按同一膜条上其他行的泳道位置对齐。

## 代码地图

- `js/wbengine.js`（`G.WB`）：分类、归膜、膜条分割（`findStrips`）、Ladder 识别（`findLadders`）与标定（`calibrate` / `fitSeries`）、条带行（`detectRows`）、每条膜条的泳道格点（`pieceLattice` / `jointPitch`）、默认列号（`assignColumns`）、整体分析（`analyzeSession`）、框内识别泳道（`detectBoxLanes`）与条带（`bandInBox`）、曝光评分（`exposureScore`）、图与图的刚性配准（`registerRigid` / `registerPieces` / `regWarp`，FFT 相位相关）
- `js/wbapp.js`（`G.BApp`）：状态、撤销、同一张膜各张图的对齐（`alignBlot` / `alignPieces` / `applyAlign`）、行与框、框里的泳道编辑、旧版绑定的解除、框选添加、手动 Marker、曝光与显示范围、规范检查
- `js/wbrender.js`：排版成 SVG；`js/wbview.js`：中间膜图（框的 8 个角柄、泳道竖线与列号、双击加道、框选添加、标 Marker 的 `marks` 模式：`drawMarking` / `marksOf` / `markGeom`，手动对齐 `align` 模式；`fitFull` 放大到整张膜的膜条，`fitPiece` 放大到一条膜条的 Marker 道）；`js/wbui.js`：5 步面板（第 1 步 `renderBlots`、第 2 步 `renderPieces`、第 3 步 `renderRows` 和选中一行展开的曝光、泳道、倾斜工具 `rowDetail`、第 4 步 `renderMarker` / `ladderCard` 和刻度的分子量选择框 `markPicker`、第 5 步 `renderNames`；步骤切换 `openStep` / `nextStep` / `renderSteps`）、顶栏的提示 `updateCoach`（点它执行 `coachAct`）、首次引导 `showTour`、成图上的编辑与拖动排列（`rowRects` / `drawRowTags`，预览上的拖动在 `pdrag`，列表里的在 `ldrag`）、导出、调试参数
- `js/storage.js` `i18n.js`：偏好存储（`PrefStorage`）和界面语言（`L` / `I18N`），与 GelFigure 相同，最先载入
- `js/tiff.js` `engine.js`：与 GelFigure 共用，改动时注意两边同步（`tiff.js` 已同步到 GelFigure 0.6.5：按文件内容判断格式，8 位图片给出提示）
- `js/export.js`：从 GelFigure 0.6.5 移植（PNG 元数据、LZW TIFF、下载），去掉了凝胶专用的部分

## 已知待办

- 白光图的自动区分只在两套样例上验证过（iBright 的 14 张、合成示例）；别的成像仪导出的图认错时请收集样例。
- iBright 文件名里没有曝光时间，图注里的曝光时间要手填。
- 竖着剪开、又上下错位摆放的两半膜：同一个蛋白不会自动并成一行（高度差太大），需要在成图上把一行拖到另一行上。
- 框内识别泳道用的是膜上各行一致的泳道间距：若某一行的样品隔一道才有带，识别结果会保留中间的空道；只在框里的条带比这个间距还宽时才改用框自己的间距。曝光里这一行几乎没信号或严重过曝拖尾时可能不准，此时用"均分 N 道"。
- 不同膜（不同次拍摄）之间不能拼进同一行（期刊不允许一行混用不同图）。
- 真实样例里膜在 7 次拍摄之间挪过：01+02 一个位置，03–10 转了约 0.94°，11–14 平移约 4 px（文件按拍摄成对：白光图和曝光图一一对应）。网格基准是 04，读膜条用 01（第 1 步的 Marker 图）。
- 只有曝光图（没有白光图）的组不会自动并成一张膜；需要时用"移到"手动并。手动对齐只调整整张图（单独对齐的膜条保持相对整张图的偏移）。
- 曝光图之间按单条膜条配准时精度约几个像素（不同曝光条带饱和、强弱不同），所以有白光图时曝光图沿用白光图的膜条变换。


## 0.8.1：延后分析与独立框

- 导入只解码、分类、初步归组；`b.dirty` 标记待确认的组，`App.ensurePrepared()` 在第 1 步确认时才对齐并读膜条。`outlinesOnly` 不检测蛋白，`makeBoxes()` 在第 3 步检测条带。不要在 `moveImages/removeImages` 中重新跑完整分析。
- `App.removeImages(ids)` 和 `moveImages(ids, target)` 是批量操作。移除记录暂存在内存档案中以便撤销，项目/草稿只保存活跃图片；`syncImages()` 随撤销恢复。改分组后导出检查要求重新确认。
- 每个 `sg` 有独立 `id` 和稳定的 `label`（B1 等）；选择与预览拖动按 `id`，不按 `piece`。旧项目在 commit 时补齐 ID。`sg.above/below` 可覆盖行高，合并和导出保持各框自己的范围。
- `splitExcluded()` 将内部排除泳道拆成多个源框，`cut` 记录原始泳道以便 `restoreContinuous()`；接缝在渲染器按行生成，不会横贯其他连续行。
- `pieceTicks()` 接受一条手动刻度；`pieceCal()` 仍要求两条才能估算。渲染所有在裁切范围内的手动刻度；拥挤时增加文字列，不删除刻度。框外刻度给出明确提示。
- `tests/workflow.mjs` 覆盖批量整理和撤销、原生拖放、延后分析、默认显示弱带、独立框/同膜拼接/项目存档、泳道数即时应用、单 Marker 与拥挤刻度，以及文件名溢出。WebKit 可能过滤自定义拖放 MIME，因此同页拖动还保留图片 ID，不能仅依赖 dataTransfer 自定义类型。
- 只检查这轮交互：`node tests/run.mjs --suite=workflow`（默认三种内核，也可用 `--browser=webkit`）。完整 CI 仍运行所有套件。


## 0.8.2：取消拼接

- 引擎删除跨膜条的高度/强度匹配合并，只保留同一区域内重复检测的去重。每个独立区域有自己的行、曝光选择和亮度参数。
- 成图竖向拖动只排序；`App.mergeRows` 仅保留 disabled 返回值供旧诊断 URL 使用，不再有合并数据的实现或用户入口。
- `App.bindingGroups(row)` 按源框分组；同一个 `cut.id` 的片段代表原来一个蛋白区域剔除内部泳道后的片段，不是不同区域的绑定。`boundRows()` 找旧版绑定，`splitRow()`/`unbindAll()` 将其分成独立行，保留当前图片、名称、亮度和裁切范围，锁定当前曝光以免解绑瞬间自动换图。旧版已丢失的独立设置无法恢复。
- 自动生成的 `S.levels[imageId].stable` 防止一个区域换曝光后，其他区域所用图片的显示范围跟着重算。全图调整只在用户明确选择高级控制后生效；浏览不匹配的图片时禁用滑块并提供返回所选区域曝光的入口。
- 测试增加真实鼠标的落行排序、解绑保留设置、改一个区域后另一区域像素不变，以及移动膜条样例不自动合并的检查。


## 0.9.0：轻量多列与 Marker 显示

- `S.layoutColumns` 是排版列元数据；`row.column` 为所属列，旧项目未设时等于 `main`。为兼容旧项目，主列的 `lanes/range/hiCol/groups/conditions` 保存在根状态，其余列保存在各自记录中。读写请走 `columnData(id)`，局部渲染走 `columnState(id)`。`App.columns(id)` 仍表示该排版列中的泳道格点，不能和 `layoutColumns()` 混淆。
- `App.uiState()` 只将上述标签字段路由到当前列；原图、蛋白区域、Marker 校准和图像设置仍属于各自对象。导出必须显式遍历所有列，不依赖 `activeColumn`。`moveToColumn()` 只改归属和顺序；曝光推荐使用整个源区域而不受成图泳道范围影响。
- `wbrender.js` 逐列生成 SVG 内容，再水平排放。顶部对齐指图像区域顶部；可选按行对齐只改变 y 位置，不缩放条带。`columnBoxes`、`rowBoxes` 供鼠标拖动及标注定位使用。不同列不合并源区域；空列不导出。
- 校准点有稳定的 `mark.id`；区域的 `hiddenMarkers` 只控制显示，`markerPt` 只覆盖该区域字号。隐藏数字不影响 `pieceCal()`。引线绘制在所有文字背后，不拦截文字点击。恢复隐藏数字的入口始终在区域名称旁 ⋯。
- 跨列括号暂不渲染，但保留数据、提示及删除按钮；移回原列即可恢复。条件 TSV 只写当前列，明确追加或替换，空格不丢失，超出可见泳道的值拒绝导入。
- `node tests/run.mjs --suite=layout` 覆盖跨列真实拖动、像素不变、输入法、条件表、Marker 校准保留、括号、项目/样式/旧格式、多列 PNG/原图/CSV。WebKit 的 text-only SVG quad 在嵌套变换下有坐标差异；点击测试使用带背景的标签组，与用户实际点击区域相同。
