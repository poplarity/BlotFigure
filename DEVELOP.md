# 开发与调试说明

纯前端，无构建、无依赖。改完 JS/CSS 刷新浏览器即可看到效果。

## 在一台新电脑上开始

```bash
git clone https://github.com/poplarity/BlotFigure.git   # 私有仓库，需先登录 GitHub（gh auth login 或 GitHub Desktop）
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
| `&ladder=br_pp` | 指定 Ladder 型号（id 见 `js/wbladders.js`；你的 Bio-Rad 1610374 是 `br_pp`） |
| `&sel=0` | 选中第 n 个可见行，展开它的曝光对比 |
| `&annot=1` | 填入示例蛋白名、泳道名和分组 |
| `&png=600` | 按 600 dpi 渲染成图，base64 放在隐藏的 `<pre id="figpng">` 里 |
| `&exports=1` | 跑一遍"未裁切原图"和"定量 CSV"导出并记录文件大小；未裁切原图的 PNG 放在 `<pre id="rawpng">` 里 |
| `&border=1` | 打开"条带加边框" |
| `&selpiece=B` | 选中的行跨几条膜条时，泳道工具对准膜条 B 上的那个框（需同时用 `&sel=`） |
| `&zoomsel=1` | 膜图放大到选中的行（截图用） |
| `&mode=marks` / `&mode=addrow` | 进入"标 Marker" / 框选添加模式 |
| `&pose=merge` / `align` / `order` | 在成图上停在拖动的半路（截图用）：把拆开的 B 行拖到 A 行上 / 把膜条 C 往右拖一列 / 把最下面一行往上拖 |
| `&scrollto=boxTools` | 把左侧面板滚到某个元素（截图用） |
| `&scenario=…` | 脚本化地跑一遍编辑功能，每步状态记在标题 JSON 的 `scen` 里（每行：`膜条:起始列:泳道角色` 和成图列）：`lanes` 框的缩放、框内重新识别、均分、加减/切换泳道、挪列、拼接行跟随；`drag` 用鼠标/键盘事件在膜图上拖角柄、拖竖线、双击加道、Delete、移动框、框选添加；`detect` 每行的框在每张曝光里只按框内像素识别的结果（原框 t、整条膜条宽的框 l）；`stitch` 拆开与并成一行（`App.mergeRows`，叠放的膜条、同一膜条的两行应被拒绝）；`arrange` 用鼠标事件在成图上排列：上下拖行、拖到另一行上并排、按膜条左右拖（Alt 只挪一个框）、拖过第 1 列补列、拖标签、列表里拖、Alt+↑↓；`marks` / `picker` 手动 Marker。`lanes` `drag` `detect` `stitch` `arrange` 用真实样例（膜条 A–E），`marks` `picker` 用示例（`demo=1`） |

载入完成后页面标题变成 `READY {...}`，里面是膜、膜条（`pieces`：分析得到的泳道格点与 Ladder 位置 `lad`）、行（`rowsGeo`：每个框 `膜条:vc:起始列:泳道角色`、框的范围 `box`、成图列 `cols`）、曝光、显示范围（`levels`）、警告等状态的 JSON，方便脚本检查。

## 测试页（test/）

| 页面 | 用途 |
|---|---|
| `engine.html` | 算法自测：合成膜带真值对照（行位置、角度、泳道数、kDa、曝光选择），改了 `wbengine.js` 必跑 |
| `boxlanes.html` | `WB.detectBoxLanes`（框内识别泳道）自测：15 种合成框，每种写明应识别出的泳道，标题里 `fails` 应为 0，改了框内识别必跑 |
| `timing.html?dir=<目录URL>&names=a.tif,...&ladder=br_pp` | 真实数据：各步骤耗时、行、每行每张曝光的评分（过曝、信噪比、得分） |
| `ladder.html?src=<marker图URL>&pitch=140` 或 `?demo=scatter` | Ladder 条带识别结果和中间量 |
| `markerview.html?src=<图URL>&s=0.5&ys=664,808` | 画一张图加 y 刻度，在指定 y 处画标记，用来人工核对条带位置 |
| `strips.html` `geom.html` `inspect.html` `view.html` | 膜条分割、几何、分类等单项检查 |

无界面运行（Windows 示例，Mac 换成 Chrome 路径即可）：

```powershell
msedge --headless=new --disable-gpu --user-data-dir=$env:TEMP\wb_dbg --allow-file-access-from-files `
  --virtual-time-budget=400000 --dump-dom "file:///.../BlotFigure/test/engine.html" > out.html
```

注意：无界面模式下 `alert()` 会卡住；`File.arrayBuffer()` 也会卡，所以调试入口都用 `{name, buffer}` 载入。

## 数据模型（每个框有自己的泳道）

- 膜（blot）里有若干膜条（`blot.pieces`），每条膜条有自己的坐标系（以膜条中心为原点，u 沿泳道方向，v 向下）。分析给每条膜条一套泳道格点（第 m 道在 `u0 + m*pitch`，`roles[m]` 为 `sample` / `ladder` / `skip`，样品道从 `col0` 列起，`App.pieceSlots`）和 Marker 白光图上 Ladder 所在的位置 `ladderUs`；这些只用来给新框定初始泳道和列号。
- 行（一个蛋白）在它跨过的每条膜条上有一个框 `segs[{piece, vc, b0, b1, x0, x1, lanes, c0, p}]`：框横向 `x0..x1`、纵向 `vc-above … vc+below`（`above/below` 是整行共用的，各框一样高），条带 `b0..b1`（相对 vc）。`lanes [{u, r}]` 是框里的泳道（`r`：`s` 样品 / `m` Marker / `x` 不用），样品道依次放进成图的 `c0, c0+1, …` 列（`App.segCols`），`p` 是只剩一道时用的间距。
- 框的编辑都在 `wbapp.js`：`App.setBox`（缩放/移动：框内的泳道不动，新地方按间距补，留下的泳道保持列号）、`App.redetectBox`（`WB.detectBoxLanes`，只看框里的像素）、`App.evenBox`、`App.addLane / removeLane / moveLane / cycleLane / nudgeLanes / scaleLanes`、`App.shiftCols`；包在 `App.editLanes` 里，拼接行里右边的框会跟着左边的框挪列。改完框后 `App.findBand`（`WB.bandInBox`）在框里重新找条带。
- 成图的列、每行每列的来源、留白位置都由 `App.columns()` 算出（相邻两列不是同一个框里相邻的两道就留白）；`wbrender.js` 把同一个框里相邻的几道画成一张图（预览里带 `data-row` / `data-piece`，拖动排列靠它们找到行和膜条）。
- 排列（成图怎么摆）和识别（每条膜条里有什么）分开：成图从上到下就是 `S.rows` 的顺序（`App.moveRow` / `moveRowBy`）；左右位置是每个框的 `c0`（`App.shiftAlign` 默认挪这条膜条上的所有框，因为它们共用泳道）；挪到第 1 列以左时 `App.makeRoom` 在左边补列（泳道名、条件、分组、范围一起挪）；`App.mergeRows` 把两行并成一行（不同膜、同一膜条、上下叠放的膜条都拒绝）。
- `pc.marks`（手动 Marker 刻度 `{u, v, kda}`）存在时替代这条膜条的自动 Ladder 标定（`App.pieceCal`）。
- 初始列号由 `WB.assignColumns` 给出（原位对齐 → 并排续接 → 从第 1 列开始）；框选添加的行用 `App.alignSeg` 按同一膜条上其他行的泳道位置对齐。

## 代码地图

- `js/wbengine.js`（`G.WB`）：分类、归膜、膜条分割（`findStrips`）、Ladder 识别（`findLadders`）与标定（`calibrate` / `fitSeries`）、条带行（`detectRows`）、每条膜条的泳道格点（`pieceLattice` / `jointPitch`）、默认列号（`assignColumns`）、整体分析（`analyzeSession`）、框内识别泳道（`detectBoxLanes`）与条带（`bandInBox`）、曝光评分（`exposureScore`）
- `js/wbapp.js`（`G.BApp`）：状态、撤销、行与框、框里的泳道编辑、行的拼接与拆开、框选添加、手动 Marker、曝光与显示范围、规范检查
- `js/wbrender.js`：排版成 SVG；`js/wbview.js`：中间膜图（框的 8 个角柄、泳道竖线与列号、双击加道、框选添加）；`js/wbui.js`：面板（含"选中行的泳道"工具）、成图上的编辑与拖动排列（`rowRects` / `drawRowTags`，预览上的拖动在 `pdrag`，列表里的在 `ldrag`）、导出、调试参数
- `js/tiff.js` `engine.js` `export.js`：与 GelFigure 共用，改动时注意两边同步

## 已知待办

- 自动挑 Ladder 时，Bio-Rad 1610374 和天根三色预染在样例上得分几乎相同，需要手动选一次。
- iBright 文件名里没有曝光时间，图注里的曝光时间要手填。
- 最上面那行（约 290 kDa）在 250 kDa 条带之外，靠外推估算。
- 竖着剪开、又上下错位摆放的两半膜：同一个蛋白不会自动并成一行（高度差太大），需要在成图上把一行拖到另一行上。
- 框内识别泳道用的是膜上各行一致的泳道间距：若某一行的样品隔一道才有带，识别结果会保留中间的空道；只在框里的条带比这个间距还宽时才改用框自己的间距。曝光里这一行几乎没信号或严重过曝拖尾时可能不准，此时用"均分 N 道"。
- 不同膜（不同次拍摄）之间不能拼进同一行（期刊不允许一行混用不同图）。
