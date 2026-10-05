# we-pkg-tool

把 Wallpaper Engine 的壁纸，原图提取出来。

Extract the original wallpaper image from a Wallpaper Engine `.pkg` file.

提取出来的是**作者打包时的原图**，不掉一点画质。

---

## 怎么用

三步：

```bash
# 1. 解包（把包里所有文件拿出来）
node pkg.mjs scene.pkg --extract out/

# 2. 提图（从 tex 文件里把图片拿出来）
node tex.mjs out/ --out images/

# 3. 打开 images 文件夹，图就在里面
```

就这样。

也可以直接拖整个文件夹进去批量处理：

```bash
node pkg.mjs "C:\Steam\steamapps\workshop\content\431960" --extract out/
node tex.mjs out/ --out images/
```

只想知道包里有什么，不用解包：

```bash
node pkg.mjs scene.pkg
```

## 需要装什么

只有 **Node.js**。不用联网、不用管理员权限、不用装别的。

## 会掉画质吗

**不会。**

Wallpaper Engine 的 tex 文件里，装的本来就是一张完整的 PNG 或 JPEG。这个工具只是把那张图**原样拷出来**，完全没有转换过。

（有些工具会先转一遍格式再存，反而白白损失画质。）

## 什么情况提不出来

一些**特效用的遮罩图**（水波、光晕那种灰灰的图）提不出来。测试的 70 个纹理里有 27 个属于这种。

**但壁纸本身全都能提出来**，不影响你要的东西。

## Supported / 支持范围

实测过 15 个真实的 Steam 创意工坊订阅包（共 297 MB），PKG 解析全部成功，壁纸图片全部无损提取。

Tested against 15 real Steam Workshop packages (297 MB). All packages parsed; all wallpaper images extracted losslessly.

## 注意

这个工具是给你提取**自己已经订阅、已经买过的**内容，自己留着用的。

壁纸版权属于原作者。发到网上之前，先看看作者在创意工坊页面写的授权说明。

This tool is for extracting content **you already own or subscribe to**, for personal use.
Wallpaper artwork belongs to its author — please respect the licence they state on their Workshop page.

## 协议

MIT
