# Desktop figure editing (0.14.0-dev)

[中文说明](desktop-editing.zh-CN.md) · [Project](../README.md)

This is the `dev` preview. The stable site remains v0.13.1. Image groups, the five-step workflow, per-region exposure/levels, local lane detection, manual Marker calibration and sorting retain their existing behaviour.

![Desktop typography and region inset, using the synthetic built-in example](desktop-typography.png)

## Typography

Use **Font / sizes** above the figure for Arial, Times New Roman, Helvetica, Calibri or Cambria, and shared figure/lane/protein sizes. Fonts are installed system fonts; missing fonts fall back locally.

The same menu can enable shared italic lane names. Explicit upright runs still override that default.

Lane angles default to **Auto**. Custom angles accept 0–90° through a slider or numeric input. A slider gesture previews live and commits one undo step.

Click a name to edit. Select text to apply upright/italic, superscript/subscript or red. Without a selection, formatting applies to the whole name. Clear format removes run formatting. **Only this lane name** opts into a local size/angle; disabling it resumes inheritance. Marker sizes remain globally unified.

The editor supports Ctrl/Cmd+Z and redo; Escape restores both text and formatting. IME composition does not trigger next-field navigation.

## Region annotations and insets

In step 5, choose **Region annotation / inset**, then draw inside one protein region on the figure. This is separate from a protein crop and does not alter detection or source geometry.

Add a label, solid/dashed line, size and default/red colour. Drag its edge to move or lower-right handle to resize. Choose ×2/×3/×4 to display an inset beside that column. The inset uses the same exposure and levels, preserves gaps between visible source fragments and remains linked when sorting or moving the protein to another column. Cropped-out parts do not silently reappear. Insets do not add source detail; the effective-resolution check includes magnification.

Delete an annotation without deleting its protein region, and restore it with undo.

## Side labels and brackets

Add side text such as `IB: anti-HA` or `IP: Flag`, bound to the selected protein or the current figure column. Place it left/right or below the figure, use vertical text where appropriate and drag it to adjust position. Text formatting and red/default colour are available.

Hover over a side bracket to reveal its end handles; drag them to change the span directly. Existing vertical-label and straight-line options remain available.

## Export and persistence

PNG/TIFF/SVG and native editable PowerPoint preserve fonts, script baselines and annotation colours. Pure grayscale figures use grayscale TIFF; coloured annotations select RGB TIFF automatically. Source blots still use grayscale, linear processing.

PPT keeps native editable text/shapes and native image crops, including insets, with full processed source images. These are not the original TIFF files. Re-cropping in PowerPoint requires manual annotation adjustment.

Projects/history preserve the new fields and every source image. Templates transfer annotations by protein order and relative region geometry. Save a `.blotfig` file to continue on another computer.

## Updates, feedback and support

Local bilingual release history is available on the start screen, File and Help, including offline. A once-per-version startup notice does not open a modal.

**Feedback / support** is always available. Feedback sends only the entered text, optional reply address and version to the configured service after an explicit submission. No image, project, filename or lane labels are attached automatically. Failed submissions preserve the draft. Local HTML users can write/copy feedback and send it online.

Author support and GitHub Star are voluntary. Successful figure exports may show a dismissible reminder after delivering the file; saving a support QR image does not replace the exported figure.
