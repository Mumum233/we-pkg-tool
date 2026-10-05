# we-pkg-tool

把 Wallpaper Engine 的壁纸，原图提取出来。

提取出来的是**作者打包时的原图**，一点画质都不掉。

---

## 怎么用（Windows，最简单）

**把 `.pkg` 文件拖到 `run.bat` 上面，松手。图就出来了。**

就这一步。图会出现在 `output` 文件夹里，而且会自动帮你打开。

拖这些东西都行：

| 拖什么 | 结果 |
|---|---|
| `.pkg` 文件 | 自动解包 + 自动提图，一步到位 |
| `.tex` 文件 | 直接提出图片 |
| 整个文件夹 | 批量处理里面所有包 |

> **不想拖？** 直接把 `run.bat` 和 `.pkg` 放在同一个文件夹里，双击 `run.bat` 也行。

### 去哪里找 pkg 文件

Wallpaper Engine 下载的壁纸在这个位置：

```
D:\Steam\steamapps\workshop\content\431960\
```

里面每个数字文件夹就是一张壁纸，`scene.pkg` 就是它。拖它就行。

（盘符按你自己的 Steam 装在哪来定。）

---

## 怎么用（其它系统 / 命令行）

macOS、Linux 或者喜欢敲命令的，用这两个脚本：

```bash
node pkg.mjs scene.pkg --extract out/     # 解包
node tex.mjs out/ --out images/           # 提图
```

也可以直接处理一整个文件夹：

```bash
node pkg.mjs "D:\Steam\steamapps\workshop\content\431960" --extract out/
node tex.mjs out/ --out images/
```

只想知道包里有什么，不解包：

```bash
node pkg.mjs scene.pkg
```

---

## 需要装什么

**Node.js**。下载地址：https://nodejs.org/

装的时候一路点"下一步"就行。装完之后 `run.bat` 才能用。

不用联网、不用管理员权限、不用装别的。

---

## 会掉画质吗

**不会。**

Wallpaper Engine 的 tex 文件里，装的本来就是一张完整的 PNG 或 JPEG 图片。这个工具只是把那张图**原样拷出来**，完全没有转换过。

（有些工具会先转一遍格式再存，反而白白损失画质。）

---

## 提不出来图？

有两种情况：

**1. 这个壁纸本来就没有图片**
有些壁纸是纯特效或纯代码做的（比如互动小游戏、时钟），里面没有壁纸图。这种打开 `output` 会发现只有 json 和脚本，没有图片，属于正常。

**2. 特效遮罩图提不出来**
水波、光晕那种灰灰的遮罩图，测试的 70 个纹理里有 27 个提不出来。

**但这不影响你要的壁纸** —— 壁纸本体全都能提出来。

---

## 支持范围

实测过 15 个真实的 Steam 创意工坊订阅包（共 297 MB）：

- PKG 解包 **15 / 15 全部成功**
- 壁纸图片 **全部无损提取**

Tested against 15 real Steam Workshop packages (297 MB). All packages parsed, all wallpaper images extracted losslessly.

---

## 注意

这个工具是给你提取**自己已经订阅、已经买过的**内容，自己留着用的。

壁纸版权属于原作者。发到网上之前，先看看作者在创意工坊页面写的授权说明。

This tool is for extracting content **you already own or subscribe to**.
Wallpaper artwork belongs to its author — please respect the licence they state on their Workshop page.

---

## 协议

MIT
