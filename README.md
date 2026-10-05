# we-pkg-tool

Extract the original wallpaper images from **Wallpaper Engine** `.pkg` / `.tex` files.

从 Wallpaper Engine 的 `.pkg` / `.tex` 文件里提取原始壁纸图片。

**Zero dependencies** — pure Node.js, built-in modules only.
No .NET, no network, no admin rights.

---

## Why lossless / 为什么是无损的

A `.tex` file usually **contains a complete PNG or JPEG** rather than a
compressed block texture. This tool copies those bytes out verbatim, so the
extracted image is bit-for-bit identical to what the author packed.

Many tools instead decode the texture to DXT and re-encode it, which throws
away quality for no reason.

`.tex` 里存的往往就是**一张完整的 PNG 或 JPEG**。本工具把这些字节**原样抠出来**，
所以提取结果和作者打包时**一模一样**，不掉任何画质。

（有些工具会先解成 DXT 再转存，白白损失一次画质。）

## Requirements / 环境要求

Node.js 18 or newer. Nothing else.

## Usage / 用法

```bash
# list what's inside / 列出包里有什么
node pkg.mjs scene.pkg

# unpack / 解包
node pkg.mjs scene.pkg --extract out/

# a whole folder of packages / 批量处理整个文件夹
node pkg.mjs "C:\Steam\steamapps\workshop\content\431960" --extract out/

# extract the images out of the .tex files / 从 tex 里提取图片
node tex.mjs out/ --out images/

# single file, plus every mipmap level / 单个文件，连各级 mipmap
node tex.mjs some.tex --out images/ --all-mips
```

Both scripts also work as ES modules:

```js
import { parsePkg, readPkgFile } from './pkg.mjs';
import { parseTex, decodeMip } from './tex.mjs';
```

## Verified against real packages / 实测覆盖

Tested against 15 real Steam Workshop subscriptions (297 MB), Wallpaper Engine
appid `431960`:

| | Result |
|---|---|
| PKG parsing | **15 / 15** packages, versions `PKGV0009`–`PKGV0024`, up to 129 entries / 128 MB |
| TEX image extraction | **43 / 70** textures extracted losslessly (37 PNG + 6 JPEG) |

Correctness is not assumed. A parse is only accepted when it **closes exactly**:
the record table plus the payload must add up to the file size, and the payload
must be gapless from offset 0. A wrong layout fails this check instead of
silently producing garbage.

正确性靠**字节级闭环**保证：条目表 + 数据区必须**精确等于文件大小**，且数据区必须
从 0 开始无空洞。布局猜错会直接失败，不会静默产出垃圾文件。

## Format notes / 格式要点

Two things surprised me while reverse-engineering these files, and both cause
silent corruption if you assume otherwise:

**1. `imageFormat` lies.** Textures labelled `13` (DXT1) or `2` (DXT5) very
often carry a complete PNG or JPEG instead. Always sniff the byte signature
(`89 50 4E 47` for PNG, `FF D8 FF` for JPEG) before trusting the field.

**2. `mipCount` lies too.** Packages were found declaring 7 mip levels while
storing only 2. The parser walks the mip chain data-driven and stops when a
record can no longer be formed.

Also note `TEXI` holds two sizes: `texW/texH` is the GPU-aligned storage size
(4096×4096) while `imgW/imgH` is the real image size (3840×2160). They often
disagree.

详见代码注释。

## Known limitations / 已知限制

27 of the 70 textures in the test set could not be extracted. They are all
`imageFormat = -1` **LZ4-compressed RGBA masks** (greyscale effect textures
such as water ripples and god rays) — not wallpaper images.

19 of those are handled. The remaining 8 use multi-level mip chains whose
payload start offset is not consistent between files (`p+8` and `p+12` were
both observed), so they are not supported yet.

**This does not affect wallpaper extraction** — wallpapers are plain embedded
PNG/JPEG and all of them extract correctly.

测试集中 70 个纹理有 27 个提取不出，全部是 `imageFormat = -1` 的 **LZ4 压缩
遮罩纹理**（水波、光晕等特效灰度图），**不是壁纸本体**。其中 19 个已支持，
剩 8 个多级 mip 链的数据起始位置在文件间不统一，暂未支持。

**不影响提取壁纸** —— 壁纸本体都是内嵌 PNG/JPEG，全部能正常提取。

## License / 协议

MIT. See [LICENSE](LICENSE).

## Please note / 提醒

This tool is for extracting content **you already own or subscribe to**, for
personal backup.

Wallpaper Engine Workshop wallpapers remain the property of their authors.
Respect the licence each author states on their Workshop page, and do not
redistribute extracted artwork.

本工具用于提取**你自己已订阅/已拥有**的内容用于个人备份。创意工坊壁纸的版权属于
其作者，请遵守作者标注的授权条款，不要二次分发提取出的作品。
