# Safari 适配 — 检测结果与计划

状态：**检测完成**；唯一确认的外观差异（原生 `<select>` 矮 8px）已修，其余条目是**真 Safari 上的待验证项**，未验证前不能说「已适配 Safari」。日期 2026-11-04，基线 `dev@0645c23`（v0.14.0）。
姊妹文档：[quantification-plan.md](quantification-plan.md)。

---

## 0. 结论先说

**没有发现「Safari 打不开 / 用不了」级别的问题。** 静态扫描与 Playwright WebKit 实测都没有暴露功能性缺陷。

**UI 与显示效果也基本一致**：有头 Chromium 与 WebKit 的全屏像素比对，模糊掉文字抗锯齿后的结构性差异 ≤0.7%；**高亮、选中态、悬停态逐项确认一致**（详见 3.5）。唯一肉眼可见的差异是**原生 `<select>` 在 Safari 里矮 8px**，属外观不一致，**已修**（见 3.5.A）。

但有 **4 件事在 Playwright WebKit 里证明不了**，必须在真 Safari 上验证——因为 Playwright 的 WebKit 是 WebKit 引擎，不是 Safari.app：Safari 额外加了下载策略、`file://` 源限制和标签页内存回收。在真机验证之前，不能说「已适配 Safari」。

另有 **1 处代码可以顺手加固**（无 guard 的 `DecompressionStream`），以及 **1 个需要你点一下的开关**（允许远程自动化）。

---

## 1. 检测方法

| 手段 | 覆盖 | 局限 |
|---|---|---|
| 全库静态扫描（API / CSS / 事件模型） | 依赖的浏览器特性与版本下限 | 只证明「调用了什么」，不证明「行为对不对」 |
| Playwright WebKit 跑 `file://` 能力探针 | secureContext、localStorage、IndexedDB、clipboard、CompressionStream、canvas 上限、1200 dpi 真实渲染 | WebKit ≠ Safari.app |
| 既有三引擎完整回归（2026-10-29） | 435 项检查，chromium/firefox/**webkit 全 PASS** | 同上 |
| 真实 TIFF 解码 + 分析（WebKit） | 2362×1889 RGB 16-bit WB 图 | 单图，未测多图会话 |

**没做到的**：真 Safari 自动化。`safaridriver` 返回
`You must enable 'Allow remote automation' in the Developer section of Safari Settings`。
本机 Safari 27.0，`WebDriverAllowRemoteAutomation` / `IncludeDevelopMenu` 均未设置。

---

## 2. 已确认没有问题（有证据）

**没有 Chrome-only API。** 以下全部 0 命中：`showSaveFilePicker` / `FileSystemAccess`、`OffscreenCanvas`、`createImageBitmap`、`pointerrawupdate`、`navigator.share`、`scheduler.yield`、`Object.groupBy`、`Array.fromAsync`、`requestIdleCallback`、`adoptedStyleSheets`、`ElementInternals`、`<dialog>` / `showModal`、`inert`。

**没有依赖原生 Popover API（Safari 17+）。** 全库 22 处 `popover` 全是 CSS 类名 `.popover` / 变量 `pop`，`showPopover` / `togglePopover` / `popover=` 均 0 命中。这一点如果不查，很容易误判成 Safari 17 依赖。

**用到的特性全部达到 README 声明的 Safari 16.4 下限：**

| 特性 | Safari 起始版本 | 位置 |
|---|---|---|
| `Object.hasOwn` | 15.4 | `js/figure-text.js:6` |
| `:has()` | 15.4 | `css/style.css:341` |
| `dvh` | 15.4 | `css/style.css:628` |
| `Array.prototype.at` | 15.4 | `feedback.js:87` 等 6 处 |
| `color-mix()` | 16.2 | `css/style.css:401,403,519` |
| `CompressionStream` | 16.4 | `js/wbapp.js:309` |
| `DecompressionStream` | 16.4 | `js/wbapp.js:316` |

**没有 `backdrop-filter`**（Safari 需要 `-webkit-` 前缀的经典坑），0 命中。`-webkit-` 前缀已覆盖滚动条、滑块、`appearance`。

**交互模型是 mouse events 而非 Pointer Events**（12 处 `mousedown`），不需要 `setPointerCapture`，Safari 上无风险。

**三处 Safari 历史坑，代码里已经处理过了：**

- 自定义 MIME 拖拽被 Safari 剥离 → `js/wbui.js:369` 的 `imageDragIds` 内存回退（注释已写明是为 Safari）。
- 绘制时序 → `js/wbui.js:1286`（注释 `a frame later they were, in Safari`）。
- SVG 内文本四边形上报错误 → `tests/layout.mjs:121` 已有 WebKit 专用绕过。

**WebKit 实测全部通过：** `file://` 下 `isSecureContext` 为真、localStorage 可写、IndexedDB 可开、`navigator.clipboard` 存在、Compression/Decompression 均存在、canvas 到 16384×16384 不失败、1200 dpi 成图渲染 2193×1300 用时 60 ms（Chromium 31 ms），页面与控制台 0 报错。

**导出下载在 WebKit 里是真跑通的**，不是只断言按钮能点：`tests/ui.mjs:87-108` 用 `waitForEvent('download')` 取真实产物，校验 `suggestedFilename()` 与文件字节，PNG/TIFF/SVG/处理日志四项齐全，三引擎均通过。

---

## 3. 需要在真 Safari 上验证的 4 件事

按风险从高到低。**这 4 条是「Safari 适配」这句话能不能成立的真正判据。**

### ① 下载在多次 `await` 之后是否仍落盘（最高风险）

`js/export.js:80`：

```js
const c = await svgToCanvas(...);            // await 1：等 Image.onload
const blob = await new Promise(r => c.toBlob(r, 'image/png'));  // await 2
download(await pngDecorate(blob, dpi, texts), name);            // await 3 后才 a.click()
```

Safari 对「用户激活」（transient activation）的有效期比 Chrome 短。`<a download>` + blob URL 在激活过期后，Safari 可能改为**新标签页打开图片而不是下载**，或直接静默失败。TIFF/PPTX 走的是同类路径。

> 为什么 WebKit 通过还不能放心：Playwright 的下载事件由引擎层接管，绕过了 Safari.app 的下载 UI 策略。

**验证**：真 Safari 里依次导出 PNG / TIFF / SVG / PPTX / CSV / 处理日志 JSON，逐个确认文件真的出现在下载目录、文件名正确（含中文名）。

**若失败**：把 `download()` 的调用提前到同步段——先 `a.click()` 一个占位，或在 `svgToCanvas` 之前就把 `a` 元素挂好、拿到 blob 后只改 `href` 再 `click()`。这是标准修法，改动局部。

### ② `file://` 下的 IndexedDB / localStorage

README 已声明「从磁盘直接打开时，部分浏览器会禁用本地文件的 IndexedDB，项目库可能不可用」。Playwright WebKit 对 `file://` 更宽松，**不能据此推断 Safari 可用**。

**验证**：双击 `index.html`（`file://`），确认：能正常作图、自动存档失败时有明确提示、`导出项目`（`.blotfig`）可用作退路。`startup` 套件已覆盖「存储被禁用」的降级路径，但那是模拟的。

### ③ 多图会话的内存

真实 TIFF 是 2362×1889、RGB 16-bit。每张图在内存里约 **18 MB 分析缓冲 + 18 MB 显示缓冲**。用户实际的 iBright 一组 14 张曝光 → **500 MB 量级**。Safari 的标签页内存上限低于 Chrome，触顶会整页重载而不是抛错——用户看到的是「突然回到起始页」。

**验证**：真 Safari 里导入 14 张真实 TIFF，走完五步，观察活动监视器里 Safari 的内存与是否发生页面重载。WebKit 侧可先做合成压力测试，但天花板不同，只能作参考。

### ④ 字体度量漂移

`js/wbrender.js` 用 `measureText` 决定成图换行与溢出（第 37/51/60/187 行）。Safari 的字体回退链与 Chromium 不同，同一串文字宽度可能差几个百分点，导致成图里条件行换行位置变化。

**已验证部分**：Playwright WebKit 与有头 Chromium 的全屏像素比对显示，模糊后的结构性差异 ≤0.7%，说明排版在两引擎下基本一致（详见 3.5.B）。

**仍需真机验证部分**：WebKit 与 Safari.app 的字体回退未必相同（Safari 会额外走系统字体服务）。真 Safari 打开一个含长中文条件名与上下标蛋白名的项目，与 Chrome 导出的 PNG 并排比对排版。属于「显示差异」而非「功能损坏」，优先级最低，但涉及发表成图，要记录在案。

---

## 3.5 UI 与显示效果（有头 Chromium vs WebKit 实测）

方法：同一 1600×960 视口、同一 demo 状态，两引擎各截全屏图做像素比对，并用 `getBoundingClientRect()` 比对 14 个关键元素的几何。**Chromium 必须用有头模式**——headless 不画滚动条，会伪造出 10px 的假差异（见 3.5.C）。

### 3.5.A 真实差异：原生 `<select>` 的尺寸

`index.html` 里有 9 个 `<select>`：`dpiTop` / `groupFit` / `labelAngle` / `mwSide` / `nameSide` / `rangeA` / `rangeB` / `viewBlot` / `widthPreset`。

只有 `#dpiTop` 做了外观归一（`css/style.css:38`，且第 37 行注释写明「WebKit otherwise draws a white native control on the dark bar」）。其余 8 个走原生渲染。

实测 `angleMode`（第 3 步的 Auto/Custom 下拉）：

| | Chromium | WebKit | 差 |
|---|---|---|---|
| 尺寸 | 82 × 28 | 76 × 20 | 宽 −6，**高 −8** |

**影响**：Safari 里的下拉框明显更矮，和旁边 28px 高的输入框、按钮排在同一行时不对齐。这是**外观不一致**，不是功能损坏——原生控件在 Safari 上本来就是「标准 macOS 长相」。

**修法（已落地）**：照抄 `#dpiTop` 的做法，`css/style.css` 里加了 `select:not(#dpiTop)`——`appearance:none` + 28px 高 + 自绘 SVG 箭头（`background-image`，不用伪元素，Firefox 也认）。`.range-row select` 原来的 `padding:4px 6px` 同时删掉，否则会覆盖新内边距。三引擎回归通过。

### 3.5.B 文本度量差异：存在，但很轻微

三态全屏像素比对（有头 Chromium vs WebKit）：

| 状态 | 完全相同像素 | 严格差异 >24 | **高斯模糊后差异 >48** |
|---|---|---|---|
| 起始页 | 92.83% | 1.62% | **0.010%** |
| 第 3 步（含选中高亮） | 83.06% | 2.89% | **0.139%** |
| 导出菜单展开 | 80.76% | 2.84% | **0.701%** |

「模糊后差异 >48」这一列是关键：模糊会抹掉文字抗锯齿的差别，只剩真正的色块/边框/阴影差异。三态都 ≤0.7%，且导出菜单那 0.7% 主要来自面板滚动位置不同（内容高度略有差异），不是配色问题。

**高亮相关的样式在两引擎下没有大面积差异**，逐项确认过：
`.item.sel`、`.row-item.sel`、`.bt-seg.sel`、`.rowtag.sel`、`.thumb.selected canvas` 的 outline、`#preview .ed:hover text` 的 `fill:#2f6feb`、以及拖拽高亮 `.drop-images` / `.dragging`。

结论：**高亮、选中态、悬停态的显示效果可以直接认定与 Chrome 一致**；剩下的细微差别是字体渲染，系统级，不可也不该消除。

### 3.5.C 一个反转：我最初测出的「面板窄 10px」是假象

第一轮用 headless Chromium 比对，得到左面板 `#sections` 宽 **329（Chromium）vs 319（WebKit）**，看起来像 Safari 的严重布局缺陷。

实际原因是：`css/style.css:13` 有 `::-webkit-scrollbar { width: 10px; height: 10px }`，而 **headless Chromium 根本不绘制滚动条**（实测 `offsetWidth − clientWidth = 0`）。换成有头 Chromium 后：

| | Chromium（有头） | WebKit |
|---|---|---|
| 滚动条占用 | 10 px | 10 px |
| `#panel` | 330 | 330 |
| `#sections` | **319** | **319** |
| `#stBlots`（步骤状态，之前 35 vs 52） | **52** | **52** |

**完全一致。** 之前所有 10px 级别的差异全部消失，剩下的只有 `angleMode`（3.5.A）。

**教训**：跨浏览器布局比对必须用有头浏览器，headless 的滚动条策略会伪造整类假阳性。这条要写进 `AGENTS.md` 的验证约定。

### 3.5.D 查过但**不是**问题的两处

**`user-select` 无前缀 —— 检测不出来，建议仍加前缀。**
MDN 的 compat 数据里，`user-select` 的 Safari 条目**只有 `-webkit-` 前缀（Safari 3 起），没有无前缀记录**，且该属性被标记为 non-Baseline。但当前 WebKit 实测：带正对照的拖选测试中，普通段落能被选中，`.switch` 和 `.rowtag`（只写了无前缀 `user-select:none`）**选不中**——说明现行 WebKit 已认无前缀。

冲突的解释只能是：BCD 数据滞后，或支持是较新 WebKit 才加的。**老 Safari 是否支持无法在本机证伪。** 由于 `css/style.css` 有 5 处 `user-select: none` 而 `-webkit-user-select` 是 **0 处**，加前缀是零成本保险（一行 sed），建议做，但**不列为 bug**。

**`#cacheStatus` 宽度差 41px —— 是状态时序，不是渲染。**
该按钮文案会在「Recent projects」和「Saved · recent projects」之间切换（`js/wbextras.js:10`）。两引擎截图时刻的 IndexedDB 写入进度不同，所以显示的字不同。不是缺陷。

---

## 4. 可以顺手加固的一处代码

`js/wbapp.js:316`：

```js
if (u8[0] === 0x1f && u8[1] === 0x8b) { buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); ... }
```

紧邻的 `saveProject`（第 309 行）是有 guard 的：

```js
if (typeof CompressionStream !== 'undefined') blob = await ...
```

`openProject` 没有。后果：在低于 Safari 16.4 的浏览器上打开 gzip 项目文件，得到的是 `ReferenceError: Can't find variable: DecompressionStream`，而不是「此浏览器版本过低」这类可读提示。

**定性**：这不是受支持浏览器上的 bug（16.4+ 都有此 API），属于**容错性缺口**。加到 `typeof DecompressionStream === 'undefined'` 时抛出 `L(...)` 的友好错误即可，两行。

---

## 5. 计划

| 阶段 | 内容 | 前提 | 工作量 |
|---|---|---|---|
| **S0** | 真 Safari 基线跑通：`file://` 打开、导入真实 TIFF、走完五步、六种导出落盘 | **需要你在 Safari 里开「允许远程自动化」**，或你手工点一遍 | 自动化 ~10 min；手工 ~15 min |
| **S1** | 按 S0 结果修下载时序（若需要）；`DecompressionStream` 加 guard | S0 | 0.5–1 天 |
| **S2** | 面板 `<select>` 外观归一（`appearance:none` + 固定高 28px + 自绘箭头），照抄 `#dpiTop`；顺手补 `-webkit-user-select` 前缀 | 无（纯 CSS，可独立做） | 半天 |

**S2 已于 2026-11-04 完成**（仅 `<select>` 部分）：`css/style.css` 新增 `select:not(#dpiTop)` 规则，复用 `#dpiTop` 的 data-URI 箭头。实测 `angleMode` 两引擎均为 76→78×28；`rangeA/rangeB/mwSide/nameSide/widthPreset` 全部 28px 且零差异。回归：`layout`/`ui`/`usability` 在 chromium + webkit + firefox 全 PASS，`workspace`/`parity` 在 chromium + webkit 全 PASS，`npm run build` 正常（909 KB）。
**未做**：`-webkit-user-select` 前缀——按维护者 2026-11-04 的决定，只适配新版 Safari，不做老版本兜底。

**S2 遗留的一处差异（决定不改）**：`input[type=number]` 的步进箭头在 Safari 常驻显示、Chrome 只在悬停时出现。这是原生行为且步进本身有用，改法是加 `::-webkit-inner-spin-button{display:none}`，会同时去掉 Chrome 的悬停步进，故保留差异。
| **S3** | 多图内存压力：WebKit 合成压力测试 + 真 Safari 14 张实测；必要时在导入时对超大图做降采样提示 | S1 | 1 天 |
| **S4** | 把 WebKit 已经跑通的回归固化为「Safari 冒烟清单」，写进 `AGENTS.md` 的验证表；补一条「跨引擎布局比对必须用有头浏览器」的约定 | S2 | 半天 |
| **S5** | 字体度量比对，记录已知差异（不追求像素一致） | 可选 | 半天 |

**建议**：S0 必须先做。在真 Safari 上跑之前，S1 的下载修复是盲修——`export.js` 的时序改动影响全部六种导出，没有真机信号就改，风险大于收益。

**S2 可以脱离 S0 先做**：它是纯 CSS，不依赖真机结论，而且已经有明确的实测证据（`angleMode` 82×28 vs 76×20）。如果你希望先看到可见改善，S2 是最快见效的一项。

---

## 6. 需要你做的一件事

在 Safari 里打开：**设置 → 高级 → 勾选「显示网页开发者功能」**，然后菜单栏 **开发 → 允许远程自动化**。

（或者终端里 `safaridriver --enable`，会弹管理员密码框。）

开了之后我就能用 `safaridriver` 把现有 `tests/run.mjs` 的 WebKit 套件换成真 Safari 跑一遍，S0 就自动化了。不开也可以——你手工走一遍上面 4 条验证，把现象告诉我，效果一样，只是慢一点。

⚠️ 开这个开关会重启 Safari，你当前打开的标签页可能丢失。**建议你先把 Safari 里的东西存一下再开。**

---

## 7. 明确不做

- **不**为了「兼容 Safari」降级任何已用的现代特性（`:has()` / `color-mix()` / `dvh`）——它们都在 16.4 以内，降级只会让代码变脏。
- **不**承诺 Safari 与 Chrome 的成图**像素级一致**。字体度量差异是系统级的，能承诺的是「布局不溢出、不丢元素」。
- **不**在真机验证前更新 README 的浏览器支持表述。现在写的是 Safari 16.4+，在 S0 完成前这句话是**未经真机验证的声明**。
- **不**把 Playwright WebKit 的通过当作 Safari 的通过来汇报。
