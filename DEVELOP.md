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
| `&selpiece=B` | 选中字母为 B 的膜条 |
| `&mode=marks` / `&mode=addseg` | 进入"标 Marker" / 拼接模式（拼接需同时用 `&sel=`） |
| `&scrollto=pieceBox` | 把左侧面板滚到某个元素（截图用） |
| `&scenario=stitch` / `lanes` / `marks` | 脚本化地跑一遍拆开与拼接、泳道编辑、手动 Marker，每步状态记在标题 JSON 的 `scen` 里。`stitch` 和 `lanes` 需要真实样例（膜条 A–E），`marks` 用示例（`demo=1`） |

载入完成后页面标题变成 `READY {...}`，里面是膜、膜条泳道（`pieces`）、行（`rowsGeo`：所在膜条、成图列）、曝光、显示范围（`levels`）、警告等状态的 JSON，方便脚本检查。

## 测试页（test/）

| 页面 | 用途 |
|---|---|
| `engine.html` | 算法自测：合成膜带真值对照（行位置、角度、泳道数、kDa、曝光选择），改了 `wbengine.js` 必跑 |
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

## 数据模型（泳道按膜条）

- 膜（blot）里有若干膜条（`blot.pieces`），每条膜条有自己的坐标系（以膜条中心为原点，u 沿泳道方向，v 向下）和自己的泳道：第 m 道在 `u0 + m*pitch`，角色 `roles[m]` 为 `sample` / `ladder` / `skip`。样品道依次放进成图的 `col0, col0+1, …` 列（`App.slots`）。
- 行（一个蛋白）在它跨过的每条膜条上有一段 `segs[{piece, vc, b0, b1, ms}]`：条带中心 vc、条带上下沿 b0..b1；裁切是每段的 `vc-above … vc+below`。
- 成图的列、每行每列的来源、留白位置都由 `App.columns()` 算出；`wbrender.js` 把同一条膜条上相邻的几道画成一张图。
- `pc.marks`（手动 Marker 刻度 `{u, v, kda}`）存在时替代这条膜条的自动 Ladder 标定（`App.pieceCal`）。
- 默认列号由 `WB.assignColumns` 给出（原位对齐 → 并排续接 → 从第 1 列开始）。

## 代码地图

- `js/wbengine.js`（`G.WB`）：分类、归膜、膜条分割（`findStrips`）、Ladder 识别（`findLadders`）与标定（`calibrate` / `fitSeries`）、条带行（`detectRows`）、每条膜条的泳道（`pieceLattice` / `jointPitch`）、默认列号（`assignColumns`）、整体分析（`analyzeSession`）、曝光评分（`exposureScore`）
- `js/wbapp.js`（`G.BApp`）：状态、撤销、膜条泳道编辑、行的拼接与拆开、手动 Marker、曝光与显示范围、规范检查
- `js/wbrender.js`：排版成 SVG；`js/wbview.js`：中间膜图；`js/wbui.js`：面板、编辑、导出、调试参数
- `js/tiff.js` `engine.js` `export.js`：与 GelFigure 共用，改动时注意两边同步

## 已知待办

- 自动挑 Ladder 时，Bio-Rad 1610374 和天根三色预染在样例上得分几乎相同，需要手动选一次。
- iBright 文件名里没有曝光时间，图注里的曝光时间要手填。
- 最上面那行（约 290 kDa）在 250 kDa 条带之外，靠外推估算。
- 竖着剪开、又上下错位摆放的两半膜：同一个蛋白不会自动拼成一行（高度差太大），需要手动"拼接"。
- 不同膜（不同次拍摄）之间不能拼进同一行（期刊不允许一行混用不同图）。
