# Built-in ladder sources / 内置 Marker 出处

BlotFigure ships the prestained protein ladders that show on a membrane (unstained ladders are left out: they cannot be seen on a blot). The list in [`js/wbladders.js`](../js/wbladders.js) shares its sizes and reference bands with [GelFigure](https://github.com/poplarity/GelFigure/blob/main/docs/ladders.md), where each was read from the manufacturer's product page or datasheet. A wrong size produces a wrong figure, so a ladder without a source cannot be added — see [CONTRIBUTING.md](../CONTRIBUTING.md). Any other ladder can be entered as a custom ladder in step 4.

BlotFigure 内置的是在膜上看得见的预染蛋白 Marker（非预染的在膜上看不见，没有收录）。[`js/wbladders.js`](../js/wbladders.js) 里的条带大小和参考带与 [GelFigure](https://github.com/poplarity/GelFigure/blob/main/docs/ladders.md) 共用同一份列表，均来自厂商的产品页或说明书。大小错了就会做出错图，所以没有出处的型号不会被收录。其他型号可在第 4 步建自定义 Marker。

Sizes are kDa: the **apparent** molecular weights of the prestained bands, as the manufacturer prints them, in a Tris-glycine (Laemmli) system unless the name says otherwise. They shift with gel percentage, buffer and running conditions, so a size read from a prestained marker is an estimate; the legend hint says "apparent molecular weights". **ref** = the coloured or brighter reference bands the datasheet marks (orange in the ladder chart shown while marking).

大小单位为 kDa：预染条带的**表观**分子量，与厂商标注一致；除名称注明的外均为 Tris-glycine（Laemmli）体系的数值。换胶浓度、缓冲体系或电泳条件都会偏移，因此从预染 Marker 读出的数值是估算值，图注提示会写 "apparent molecular weights"。**ref** 是说明书标注的彩色或加亮参考带（标 Marker 时的条带示意里显示为橙色）。

| id | Ladder | Cat. no. | Bands | Range (kDa) | ref |
|---|---|---|---|---|---|
| `br_pp` | Bio-Rad Precision Plus Dual Color | 1610374 | 10 | 10–250 | 75, 25 |
| `br_allblue` | Bio-Rad Precision Plus All Blue | 1610373 | 10 | 10–250 | 75, 50, 25 |
| `br_kaleido` | Bio-Rad Precision Plus Kaleidoscope | 1610375 | 10 | 10–250 | 150, 75, 37, 25, 10 |
| `br_ppx` | Bio-Rad Precision Plus Dual Xtra | 1610377 | 12 | 2–250 | 75, 25, 2 |
| `pr26616` | Thermo PageRuler Prestained 10–180 kDa | 26616 | 10 | 10–180 | 70, 25, 10 |
| `pr26619` | Thermo PageRuler Plus Prestained 10–250 kDa | 26619 | 9 | 10–250 | 70, 25, 10 |
| `sp26634` | Thermo Spectra Multicolor Broad Range | 26634 | 10 | 10–260 | 260, 70, 50, 40, 10 |
| `sp26625` | Thermo Spectra Multicolor High Range | 26625 | 8 | 40–300 | 300, 70, 50 |
| `sp26628` | Thermo Spectra Multicolor Low Range | 26628 | 6 | 1.7–40 | 40, 10 |
| `nx_lc5800` | Invitrogen Novex Sharp Pre-stained | LC5800 | 12 | 3.5–260 | — |
| `sb_lc5925` | Invitrogen SeeBlue Plus2 | LC5925 | 10 | 4–250 | — |
| `neb7719` | NEB Color Prestained Broad Range | P7719 | 11 | 10–250 | 72, 26 |
| `ab116028` | Abcam Prestained Broad Range | ab116028 | 12 | 11–245 | 75, 25 |
| `gs_m00624` | GenScript Broad Multi Color | M00624 | 10 | 10–270 | 270, 50, 30 |
| `ys_p180` | Yeasen GoldBand Plus 3-color 10–180 kDa | 26616ES | 10 | 10–180 | 70, 25, 10 |
| `ep_wj101` | Epizyme 15–150 kDa | WJ101 | 9 | 15–150 | 70, 25 |
| `ep_wj102` | Epizyme Two-color 10–250 kDa | WJ102 | 11 | 10–250 | 70, 25 |
| `ep_wj103` | Epizyme Three-color 10–250 kDa | WJ103 | 11 | 10–250 | 70, 25 |
| `ep_wj106` | Epizyme NIR 10–250 kDa | WJ106 | 11 | 10–250 | 70, 25 |
| `ep_wj107` | Epizyme Three-color 10–180 kDa | WJ107 | 10 | 10–180 | 70, 10 |
| `by_p0068` | Beyotime Prestained 10–180 kDa | P0068/P0069 | 10 | 10–180 | 72, 10 |
| `by_p0071` | Beyotime BeyoColor 6.5–270 kDa | P0071/P0072 | 10 | 6.5–270 | 270, 52, 30 |
| `by_p0075` | Beyotime BeyoColor 10–170 kDa | P0075/P0076/P0077 | 10 | 10–170 | 70, 15 |
| `by_p0776` | Beyotime BeyoColor 10–250 kDa | P0776 | 11 | 10–250 | 70, 25 |
| `by_p0773` | Beyotime BeyoColor 8–180 kDa | P0773 | 10 | 8–180 | 70, 8 |
| `by_p0779` | Beyotime BeyoColor 25–300 kDa | P0779 | 9 | 25–300 | 70, 25 |
| `by_p0771` | Beyotime BeyoColor 2.7–40 kDa | P0771 | 9 | 2.7–40 | 40, 10 |
| `tr_dm111` | TransGen Blue Plus II | DM111 | 8 | 14–120 | 120, 50, 14 |
| `tr_dm141` | TransGen Blue Plus V | DM141 | 11 | 10–190 | 70, 20 |
| `tr_dm151` | TransGen Blue Plus VI | DM151 | 11 | 10–250 | 72, 25 |
| `sl_pr1910` | Solarbio Rainbow 180 | PR1910 | 10 | 11–180 | 75, 25 |
| `sl_pr1920` | Solarbio Rainbow 245 | PR1920 | 12 | 11–245 | 75, 25 |
| `sg_c610110` | Sangon RealBand Marker II | C610110 | 10 | 10–180 | 72, 10 |
| `sg_c610210` | Sangon RealBand Two-color 10–250 kDa | C610210 | 11 | 10–250 | 70, 25 |

Spectra Low Range and BeyoColor 2.7–40 are Tricine markers. Spectra Broad / High Range, SeeBlue Plus2 and Abcam ab116028 read quite differently on Bis-Tris (NuPAGE MES / MOPS) gels — for those, use a custom ladder with the values for your system. Beyotime notes that prestained sizes can vary between lots; check the sheet that came with yours.

Spectra Low Range 和 BeyoColor 2.7–40 是 Tricine 体系的 Marker。Spectra Broad / High Range、SeeBlue Plus2 和 Abcam ab116028 在 Bis-Tris（NuPAGE MES / MOPS）胶上的数值差别很大——用这类胶请按你的体系建自定义 Marker。碧云天说明预染条带大小可能随批次略有不同，请以随货说明书为准。

Sources (vendor product pages and manuals, read 2026-10; the same as GelFigure's):
- Thermo / Invitrogen: catalogue pages thermofisher.com/order/catalog/product/<cat. no.> (Specifications); Spectra manuals MAN0011774 / MAN0011775 ("Migration Patterns"); Novex Sharp MAN0005693; SeeBlue Plus2 NuPAGE Technical Guide ("Assigned Apparent Molecular Weights", Tris-glycine 4–20 % column)
- Bio-Rad: bulletins 4110024 (All Blue), 4110182 (Kaleidoscope), 10018393 (Dual Xtra), product page 161-0374 (Dual Color)
- NEB: protein marker flyer (P7719) · Abcam: ab116028 product page · GenScript: M00624 product page
- Beyotime: product manuals P0068, P0071, P0075 and product pages P0776, P0773, P0779, P0771
- Epizyme: epizyme.cn product pages (WJ101/WJ102, WJ103, WJ106, WJ107) · TransGen: DM111, DM141, DM151 manuals
- Solarbio: PR1910 / PR1920 manuals · Sangon: C610110, C610210 manuals · Yeasen: 26616ES product page

## Not yet checked against a datasheet / 尚未逐一核对说明书的型号

These ladders came with the first version of BlotFigure and are not in GelFigure's checked list. Their sizes have not yet been compared with the manufacturer's sheet here; check yours before relying on them, and please [report](https://github.com/poplarity/BlotFigure/issues/new/choose) any difference.

以下型号来自 BlotFigure 最早的版本，不在 GelFigure 核对过的列表里，尚未在这里逐一对照厂商说明书。使用前请对照你手上的说明书，发现不一致请[反馈](https://github.com/poplarity/BlotFigure/issues/new/choose)。

| id | Ladder | Cat. no. | Bands | Range (kDa) | ref |
|---|---|---|---|---|---|
| `mmxp` | Thermo MagicMark XP ¹ | LC5602 | 9 | 20–220 | — |
| `rpn800e` | Amersham ECL Rainbow Full-Range | RPN800E | 10 | 12–225 | — |
| `rpn756e` | Amersham ECL Rainbow High-Range | RPN756E | 8 | 12–225 | — |
| `odyssey1` | LI-COR Odyssey One-Color | — | 10 | 10–250 | 75, 50, 25 |
| `tgmp211` | Tiangen Three-color Prestained | MP211 | 11 | 10–180 | 72, 25 |
| `vazmp102` | Vazyme 180 kDa Prestained | MP102 | 10 | 10–180 | 70, 10 |

¹ Detected by the antibody, so it appears in the chemiluminescence exposure, not in the white-light picture. 由抗体显色，出现在化学发光曝光图里，而不是白光图里。

## Ladders that cannot be told apart / 条带大小相同的型号

Several products have exactly the same band sizes (e.g. Bio-Rad Precision Plus Dual Color, All Blue and Kaleidoscope, and LI-COR Odyssey One-Color; PageRuler Prestained 26616, Yeasen 26616ES and Vazyme MP102; Epizyme WJ102, WJ103, WJ106 and Sangon C610210). BlotFigure never guesses the ladder: you choose it once in step 4 and it is remembered, so the legend names the one you actually used.

有些产品的条带大小完全相同（如 Bio-Rad Precision Plus Dual Color、All Blue、Kaleidoscope 与 LI-COR Odyssey One-Color；PageRuler Prestained 26616、翌圣 26616ES 与诺唯赞 MP102；雅酶 WJ102、WJ103、WJ106 与生工 C610210）。BlotFigure 不猜型号：第 4 步选一次就记住，图注里写的就是你实际用的那一种。