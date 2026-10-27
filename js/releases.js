/* Local bilingual release summaries, available without network access. */
window.BlotFigureReleases = [
  {
    "version": "0.14.0",
    "date": "2026-10-27",
    "zh": [
      "桌面成图工具条、系统字体、局部文字格式与红色标注；各格式导出保持一致。",
      "区域注释框、局部放大与侧边文字；保留原有 WB 操作和独立曝光。",
      "修复 Marker 定义冲突，加入离线更新记录和反馈/支持入口。"
    ],
    "en": [
      "Desktop typography, inline formatting and red annotations with consistent editable exports.",
      "Region annotations, zoomed insets and side text, preserving independent WB settings.",
      "Safe Marker definition imports, local release history and feedback/support entries."
    ]
  },
  {
    "version": "0.13.1",
    "date": "2026-10-25",
    "zh": [
      "修复同组间距默认 2 pt、跨图片组间距默认 5 pt 的不一致。所有蛋白区域统一使用「统一行距」，默认 2 pt，已有自定义行距保留。",
      "单列、多列及按行对齐布局使用同一规则；预览、PNG/TIFF/SVG 和 PPT 导出保持一致。旧项目和样式文件中的隐藏组间距不再影响排版，无需重新识别。"
    ],
    "en": [
      "Uniform row spacing regardless of source image group."
    ]
  },
  {
    "version": "0.13.0",
    "date": "2026-10-25",
    "zh": [
      "预计泳道数改为识别参考。先找连续蛋白区域，再逐框读图数泳道；同图的 8、4、6 道各自保留。清晰图像与参考值不符时保留图像结果并提示，信号不足时才使用参考；不再按预设数量机械拆框。",
      "跨曝光核对连续泳道，保留弱端道，限制把宽条带的内部起伏误当成多道；重复候选只在同一膜条、相近高度和同一来源区域内合并。明确的 Marker 分隔与单框手动修改仍有效。",
      "原图空白处左键拖动框选多个蛋白框，Ctrl/⌘/Shift 点击增减；Backspace/Delete 批量删除，一次撤销恢复；同一膜条的其他框不受影响。空格或右键拖动继续平移，文本输入和中文输入法保持安全。"
    ],
    "en": [
      "Independent lane counts, file-manager-style box selection, compact controls and persistent custom markers."
    ]
  },
  {
    "version": "0.12.1",
    "date": "2026-10-23",
    "zh": [
      "修复「每框 2 道」把全膜网格按每个候选高度机械铺满的问题。宽膜先按局部水平信号形成区域，再约束泳道数；不再给空白网格生成框，不把同一条带的主峰、双带和拖尾重复框选。",
      "新区域直接保留支持它的泳道中心，避免随后再次拟合跳到半条宽带或其他区域。各区域仍独立选曝光，弱候选显示供人工核对；自动检测不推断蛋白身份，也不修改源图片。",
      "检查膜条可反复修改膜框、泳道数与分隔参数，点击「按当前设置重新识别本组蛋白框」。上方操作栏也提供同一入口；「保留已有框，返回编辑」是单独动作。"
    ],
    "en": [
      "Fix over-segmentation with small lane counts and make strip-stage detection repeatable."
    ]
  },
  {
    "version": "0.12.0",
    "date": "2026-10-23",
    "zh": [
      "第一步改为「分组与 Marker 参考图」，默认「图片组 1、2」。相册直接说明分组用途、判断原则和例子：同一拍摄布局的曝光与参考图放一组；不按蛋白名或曝光强弱分组，一组可包含多条膜。",
      "确认图片后从第一组检查膜条；整张分组卡片支持鼠标和键盘点击。生成或点击蛋白框会展开第 3 栏并显示对应设置，收起上一步；已有框和几何保留。",
      "新项目默认添加条带边框，旧项目的手动选择保留。kDa 标题参考 GelFigure，固定在条带旁，按字体占用避开条件表。"
    ],
    "en": [
      "Clear image groups, reliable step navigation, independent lane blocks and editable PowerPoint export."
    ]
  },
  {
    "version": "0.11.0",
    "date": "2026-10-23",
    "zh": [
      "第 2 步识别前可指定每个蛋白框的总泳道数；各框按自身图像拟合位置，弱带、空道不再改变指定数量。新加框沿用默认值，可逐框覆盖，支持明确操作后统一已有框。",
      "修复删除全部蛋白框后旧的单道显示范围继续限制新增框的问题。空排版列首次添加框时恢复完整范围；源泳道不再受成图范围过滤。",
      "关闭应用中自动 Marker 泳道推断造成的自动删道、拆框与全局范围裁切。只有用户手动标 M 或排除泳道才拆分框；手动裁切片段在批量调整时按原始框处理。"
    ],
    "en": [
      "Count-constrained lane positioning and source-crop fixes."
    ]
  },
  {
    "version": "0.10.0",
    "date": "2026-10-23",
    "zh": [
      "第 1 步改为中间相册分组、右侧大图浏览：放大查看、多选、跨膜组拖动，直接指定复合 Marker 图或曝光图。",
      "各步骤增加展开/收起按钮，返回修改保留已有调整；已删除的框不再因重新检查膜条而生成回来。添加蛋白框置顶，补充放置/拖画引导。",
      "选中蛋白框后按退格只删这个框；同膜其他框不受影响；输入框和中文输入法维持正常行为。泳道仍可用 Delete 单独删除。"
    ],
    "en": [
      "Direct editing, a photo workspace, and persistent local projects."
    ]
  },
  {
    "version": "0.9.0",
    "date": "2026-10-22",
    "zh": [
      "第 4 步直接调 Marker 全局字号；点成图数字或蛋白名旁 ⋯ 可逐区域设字号、隐藏/恢复数字，保留校准点。修复密集刻度引线挡住数字和点击的问题。",
      "第 5 步可选多列排版：各列独立标题、泳道范围、名称、分组和条件。拖区域跨列移动或用菜单选择目的列；曝光、亮度、裁切保持独立，无自动拼接。",
      "默认顶部对齐，可按行对齐；可调列间距、复制列标签、删除空列。空列不导出。"
    ],
    "en": [
      "Lightweight column layout and more direct annotation controls."
    ]
  },
  {
    "version": "0.8.2",
    "date": "2026-10-22",
    "zh": [
      "取消根据高度/强度自动拼接不同膜条，也取消拖到另一行时误触发的拼接；上下拖动只排序。",
      "每个蛋白区域独立选择曝光和调整亮度。固定已确定的图片默认显示范围，避免一个区域换曝光后其他区域跟着变。",
      "只有明确选择「高级：整张曝光」才全图调整；浏览其他图片时不会自动切成全图调整。"
    ],
    "en": [
      "Simplify the workflow: independent protein regions, without joining."
    ]
  },
  {
    "version": "0.8.1",
    "date": "2026-10-22",
    "zh": [
      "第 1 步只读取和整理图片，确认分组后才对齐并分析膜条；批量删除、移动不再重复全量分析，支持撤销。",
      "缩略图直接拖放到膜组，可多选一起移动/移除，或拖出新膜组；长文件名自动截断或换行。",
      "每个蛋白框有独立编号，同膜上的其他框不再跟着横移；同一膜条上的不同区域可以拼成一行，裁切范围独立保留。"
    ],
    "en": [
      "Faster image organisation, independent protein boxes and manual marker labels that stay visible."
    ]
  },
  {
    "version": "0.8.0",
    "date": "2026-10-22",
    "zh": [
      "中英双语界面：右上角 EN / 中文 随时切换，按浏览器语言自动选择，记住你的选择。成图、图注、导出文件始终是英文。",
      "单文件离线版：每个版本在 Releases 里附一个 BlotFigure-v版本号.html，下载后双击即可用，不用安装、不用解压、断网也能用。开始页有下载链接。",
      "浏览器存储被禁用或已满时照常可用：偏好只在本页暂存，开始页和第 5 步会提示，关闭前请保存项目。"
    ],
    "en": [
      "English interface, a one-file offline download, and the project's GitHub home set up like GelFigure's."
    ]
  },
  {
    "version": "0.7.0",
    "date": "2026-10-22",
    "zh": [
      "功能与维护更新；完整记录见 CHANGELOG。"
    ],
    "en": [
      "Everything GelFigure 0.6.5 does that a Western blot figure needs."
    ]
  }
];
