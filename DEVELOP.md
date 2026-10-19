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
| `&move=a.tif:2.5,140,85;b.tif:…` | 载入时把这些图里的膜当作挪动过（旋转度数、x、y 像素），模拟两次拍摄之间膜被挪动；用来测自动认膜和对齐 |
| `&demomove=a,tx,ty,a2,tx2,ty2` | 示例膜再加一次"后来的拍摄"（一张曝光图和它的白光图）：整张膜挪动 `a,tx,ty`，中间那条膜条另外再挪 `a2,tx2,ty2`（膜条切出、其余挪动、膜条放到新位置）；测认出是同一张膜、单条膜条单独对齐 |
| `&noalign=1` / `&dbg=1` | 不做对齐（各张图保持原样） / 标题 JSON 的 `dbg` 里记下认膜时的配准过程 |
| `&popimg=12` / `&alignimg=12&alignby=dx,dy,度&alignhold=1` | 打开名字以 12 开头的图的 ⋯ 菜单 / 进入它的手动对齐并拖动（`alignhold` 停在拖动中，截图用） |
| `&scrollto=boxTools` | 把左侧面板滚到某个元素（截图用） |
| `&scenario=…` | 脚本化地跑一遍编辑功能，每步状态记在标题 JSON 的 `scen` 里（每行：`膜条:起始列:泳道角色` 和成图列）：`lanes` 框的缩放、框内重新识别、均分、加减/切换泳道、挪列、拼接行跟随；`drag` 用鼠标/键盘事件在膜图上拖角柄、拖竖线、双击加道、Delete、移动框、框选添加；`detect` 每行的框在每张曝光里只按框内像素识别的结果（原框 t、整条膜条宽的框 l）；`stitch` 拆开与并成一行（`App.mergeRows`，叠放的膜条、同一膜条的两行应被拒绝）；`arrange` 用鼠标事件在成图上排列：上下拖行、拖到另一行上并排、按膜条左右拖（Alt 只挪一个框）、拖过第 1 列补列、拖标签、列表里拖、Alt+↑↓；`realign` 手动对齐曝光 12：拖动、[ ] 旋转、完成、撤销/重做、不对齐、恢复自动（每步记下对齐参数和像素签名）；`marks` / `picker` 手动 Marker。`lanes` `drag` `detect` `stitch` `arrange` `realign` 用真实样例（膜条 A–E），`marks` `picker` 用示例（`demo=1`） |

载入完成后页面标题变成 `READY {...}`，里面是各张图的对齐（`align`：`grid` 网格基准图、`marker` 读膜条和 Ladder 的白光图、每张挪动过的图 `名=角度,tx,ty+单独对齐的膜条/依据`）、膜、膜条（`pieces`：分析得到的泳道格点与 Ladder 位置 `lad`）、行（`rowsGeo`：每个框 `膜条:vc:起始列:泳道角色`、框的范围 `box`、成图列 `cols`）、曝光、显示范围（`levels`）、警告等状态的 JSON，方便脚本检查。

## 测试页（test/）

| 页面 | 用途 |
|---|---|
| `engine.html` | 算法自测：合成膜带真值对照（行位置、角度、泳道数、kDa、曝光选择），改了 `wbengine.js` 必跑 |
| `boxlanes.html` | `WB.detectBoxLanes`（框内识别泳道）自测：15 种合成框，每种写明应识别出的泳道，标题里 `fails` 应为 0，改了框内识别必跑 |
| `register.html` 或 `register.html?dir=<目录URL>&names=a.tif,...` | 对齐自测，标题 `REG {fails}`：合成膜平移、旋转后找回（含一道泳道的周期性误配）、后一次拍摄中整张膜挪动且一条膜条又单独挪动（每条膜条各自找回）、另一张膜对不上；接真实样例时：白光图分成三个位置、曝光图和同次拍摄的白光图一致、复制图挪动后找回、膜条各自挪动后单独找回 |
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

注意：无界面模式下 `alert()` 会卡住；`File.arrayBuffer()` 也会卡，所以调试入口都用 `{name, buffer}` 载入。

## 数据模型（每个框有自己的泳道）

- 膜（blot）里有若干膜条（`blot.pieces`），每条膜条有自己的坐标系（以膜条中心为原点，u 沿泳道方向，v 向下）。分析给每条膜条一套泳道格点（第 m 道在 `u0 + m*pitch`，`roles[m]` 为 `sample` / `ladder` / `skip`，样品道从 `col0` 列起，`App.pieceSlots`）和 Marker 白光图上 Ladder 所在的位置 `ladderUs`；这些只用来给新框定初始泳道和列号。
- 行（一个蛋白）在它跨过的每条膜条上有一个框 `segs[{piece, vc, b0, b1, x0, x1, lanes, c0, p}]`：框横向 `x0..x1`、纵向 `vc-above … vc+below`（`above/below` 是整行共用的，各框一样高），条带 `b0..b1`（相对 vc）。`lanes [{u, r}]` 是框里的泳道（`r`：`s` 样品 / `m` Marker / `x` 不用），样品道依次放进成图的 `c0, c0+1, …` 列（`App.segCols`），`p` 是只剩一道时用的间距。
- 框的编辑都在 `wbapp.js`：`App.setBox`（缩放/移动：框内的泳道不动，新地方按间距补，留下的泳道保持列号）、`App.redetectBox`（`WB.detectBoxLanes`，只看框里的像素）、`App.evenBox`、`App.addLane / removeLane / moveLane / cycleLane / nudgeLanes / scaleLanes`、`App.shiftCols`；包在 `App.editLanes` 里，拼接行里右边的框会跟着左边的框挪列。改完框后 `App.findBand`（`WB.bandInBox`）在框里重新找条带。
- 成图的列、每行每列的来源、留白位置都由 `App.columns()` 算出（相邻两列不是同一个框里相邻的两道就留白）；`wbrender.js` 把同一个框里相邻的几道画成一张图（预览里带 `data-row` / `data-piece`，拖动排列靠它们找到行和膜条）。
- 排列（成图怎么摆）和识别（每条膜条里有什么）分开：成图从上到下就是 `S.rows` 的顺序（`App.moveRow` / `moveRowBy`）；左右位置是每个框的 `c0`（`App.shiftAlign` 默认挪这条膜条上的所有框，因为它们共用泳道）；挪到第 1 列以左时 `App.makeRoom` 在左边补列（泳道名、条件、分组、范围一起挪）；`App.mergeRows` 把两行并成一行（不同膜、同一膜条、上下叠放的膜条都拒绝）。
- `pc.marks`（手动 Marker 刻度 `{u, v, kda}`）存在时替代这条膜条的自动 Ladder 标定（`App.pieceCal`）。
- 同一张膜的各张图在同一个网格上：`blot.frame` 是网格基准（大多数图所在位置的一张白光图），`S.align[imgId] = {a, tx, ty, pieces: {pieceId: {a, tx, ty}}, how: 'auto' | 'manual', by}` 把网格坐标映射到这张图的原图坐标（绕图片中心旋转 a 度再平移；`pieces` 是单独挪动过的膜条自己的变换）。没有条目 = 和网格一致。原图留在 `rec.raw`，`rec.img` / `rec.cs` 是重采样到网格上的图（`App.applyAlign`；撤销/重做后 `App.syncAlign` 重新采样），所以别的代码都直接用对齐后的图。分析读膜条和 Ladder 的白光图（`blot.marker`，保持最先那张：之后拍的白光图常透出曝光里的强带）用原图读，再按它的变换映射到网格（重采样会把膜条之间几个像素的切缝糊掉）。
- 对齐流程（`App.alignBlot` → 分析 → `App.alignPieces` → 有变化再分析）：白光图对第一张白光图配准、按位置分组，最多图的位置作基准；曝光图两两比相似度连成一棵树，每条边用弱的一张作参考配准、沿树合成，再整体落到某个白光图位置上（贴近 6 px 以内的取那个位置；白光图不少于曝光图时取最近的位置）；分析出膜条后，每张白光图的每条膜条单独配准，曝光图沿用同位置白光图的膜条变换。载入时不同组的白光图配准后相关 ≥ 0.9 的并成一张膜（`sameMembrane`）；整体对不上、但每条膜条单独配准后都对得上（按面积平均 ≥ 0.85、每条 ≥ 0.6）的也并（膜条被单独挪过）；只有曝光图的组不自动合并。配准本身在 `wbengine.js`：`registerRigid`（相位相关多角度粗搜 + 归一化相关细搜，粗搜保留多个峰以免差一道泳道）、`registerPieces`（膜条窗口内先粗后细，必要时在可达范围内粗搜）、`regWarp`（按膜条分段重采样，饱和像素保持饱和）。
- 初始列号由 `WB.assignColumns` 给出（原位对齐 → 并排续接 → 从第 1 列开始）；框选添加的行用 `App.alignSeg` 按同一膜条上其他行的泳道位置对齐。

## 代码地图

- `js/wbengine.js`（`G.WB`）：分类、归膜、膜条分割（`findStrips`）、Ladder 识别（`findLadders`）与标定（`calibrate` / `fitSeries`）、条带行（`detectRows`）、每条膜条的泳道格点（`pieceLattice` / `jointPitch`）、默认列号（`assignColumns`）、整体分析（`analyzeSession`）、框内识别泳道（`detectBoxLanes`）与条带（`bandInBox`）、曝光评分（`exposureScore`）、图与图的刚性配准（`registerRigid` / `registerPieces` / `regWarp`，FFT 相位相关）
- `js/wbapp.js`（`G.BApp`）：状态、撤销、同一张膜各张图的对齐（`alignBlot` / `alignPieces` / `applyAlign`）、行与框、框里的泳道编辑、行的拼接与拆开、框选添加、手动 Marker、曝光与显示范围、规范检查
- `js/wbrender.js`：排版成 SVG；`js/wbview.js`：中间膜图（框的 8 个角柄、泳道竖线与列号、双击加道、框选添加、手动对齐 `align` 模式）；`js/wbui.js`：面板（含"选中行的泳道"工具）、成图上的编辑与拖动排列（`rowRects` / `drawRowTags`，预览上的拖动在 `pdrag`，列表里的在 `ldrag`）、导出、调试参数
- `js/tiff.js` `engine.js` `export.js`：与 GelFigure 共用，改动时注意两边同步

## 已知待办

- 自动挑 Ladder 时，Bio-Rad 1610374 和天根三色预染在样例上得分几乎相同，需要手动选一次。
- iBright 文件名里没有曝光时间，图注里的曝光时间要手填。
- 最上面那行贴着 250 kDa 条带（对齐后约 224 kDa，对齐前算成约 293 kDa），这一段 Ladder 条带稀疏，分子量误差较大。
- 竖着剪开、又上下错位摆放的两半膜：同一个蛋白不会自动并成一行（高度差太大），需要在成图上把一行拖到另一行上。
- 框内识别泳道用的是膜上各行一致的泳道间距：若某一行的样品隔一道才有带，识别结果会保留中间的空道；只在框里的条带比这个间距还宽时才改用框自己的间距。曝光里这一行几乎没信号或严重过曝拖尾时可能不准，此时用"均分 N 道"。
- 不同膜（不同次拍摄）之间不能拼进同一行（期刊不允许一行混用不同图）。
- 真实样例里膜在 7 次拍摄之间挪过：01+02 一个位置，03–10 转了约 0.94°，11–14 平移约 4 px（文件按拍摄成对：白光图和曝光图一一对应）。网格基准是 04，读膜条和 Ladder 用 01。对齐之前分析把 01 的膜条套在大多数是 03–10 位置的曝光图上，最上面一行分子量算成约 293 kDa；对齐后约 224 kDa。
- 只有曝光图（没有白光图）的组不会自动并成一张膜；需要时用"移到"手动并。手动对齐只调整整张图（单独对齐的膜条保持相对整张图的偏移）。
- 曝光图之间按单条膜条配准时精度约几个像素（不同曝光条带饱和、强弱不同），所以有白光图时曝光图沿用白光图的膜条变换。
