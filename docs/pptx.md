# 可编辑 PowerPoint / Editable PowerPoint

`0.14.0` 还会保留所选系统字体、局部斜体/上下标/颜色、区域注释框、局部放大和侧边文字。它们继续使用原生可编辑对象；放大图与蛋白图共享完整处理后来源，使用独立的原生裁切。详见[桌面编辑说明](desktop-editing.zh-CN.md)。

Version 0.14.0 also preserves system fonts, run-level formatting, annotation frames, insets and side labels as native editable objects. Insets reuse full processed image sources with native crops.

在右上角 **导出 ▾ → PowerPoint（可编辑 .pptx）** 下载。网页版和单文件离线版都可用，不上传图片，不依赖网络或 Office 插件。

- 泳道名、蛋白名、条件、分组、Marker、箭头和括号保留为原生可编辑文字及图形，多行标签是一个文本框。
- 每个蛋白区域保留自己选定的曝光、旋转和亮度。选图片 → **图片格式 → 裁剪**，可以调整范围或恢复全图；不会牵动其他蛋白的图片设置。
- 一张 WB 图中的多列布局、边框、间隔保留。全选后组合，可整体复制到其他幻灯片；再取消组合继续编辑。

PPTX 内保存的是**完整、经过当前对齐／旋转和线性色阶处理的 PNG**，不是原始 TIFF。相同曝光、角度、色阶的来源共用图片，减少文件大小。收件人可以通过裁剪恢复被隐藏区域。请另外保留原始文件、处理日志和 `.blotfig` 项目。

「可恢复」指在 PowerPoint 中恢复裁切；不是把 PPT 的编辑自动同步回 BlotFigure。改变裁切后，Marker、文字也不会自动跟着新位置对齐。字体不嵌入，其他电脑可能替换字体；导出 DPI 不会放大 PPT 图片的原始细节。

## English

Choose **Export ▾ → PowerPoint (editable .pptx)**. Text, lines, borders, arrows and brackets are native editable objects. Each protein picture keeps its own exposure/levels and a native crop referencing the full processed PNG. Use **Picture Format → Crop** to change the crop or reveal the full picture. Multi-column WB layouts stay intact; select all and group to move the figure together.

Full processed images remain recoverable by recipients. These are aligned/rotated, tone-adjusted PNGs, not raw TIFFs. Fonts are referenced rather than embedded. Crop changes do not move annotations automatically. PPT edits are not imported back into BlotFigure; keep `.blotfig` projects and original data separately.

## 验证与实现 / Validation

The exporter adapts GelFigure’s offline DrawingML/ZIP implementation to multiple independent WB sources. Browser tests check native objects, ZIP CRCs, XML, source dimensions, layout, state isolation and offline export. `scripts/check-pptx.ps1` additionally opens synthetic outputs in Windows PowerPoint, renders them, changes text/crops and saves copies. Office-saved copies may contain local metadata and are never published. macOS PowerPoint, Keynote and WPS need separate validation.
