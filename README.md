# we-pkg-tool

把 Wallpaper Engine 的壁纸，原图提取出来。

提取出来的是**作者打包时的原图**，一点画质都不掉。

> **中文用户**：下载后先看 **`使用说明.txt`**，那是最直白的版本。
> 下面这份是给 GitHub 访客快速了解的。

---

## 为什么做这个

在 Wallpaper Engine 里下载了喜欢的壁纸，打开文件夹一看是这样的：

```
2269193950\
   scene.pkg        <- 5 MB，双击打不开，右键也没有"预览"
   preview.jpg      <- 只有这张能看，还糊得很
```

Windows 资源管理器里能看到缩略图，**但那个 `scene.pkg` 你双击打不开** ——
它不是压缩包，是 Wallpaper Engine 自己的私有格式，右键"解压"也没用。

想把它存成一张能用的图片，翻遍右键菜单也找不到办法。

这个工具就是干这个的：**把 `scene.pkg` 里那张原图拿出来，变成一张
你能正常打开、能设成壁纸、能丢进 PS 的普通图片。**

而且拿出来的就是**原图**，不是截图、不是缩略图，画质一点不掉。

---

## 怎么用（Windows，最简单）

**把 `.pkg` 文件拖到 `run.bat` 上面，松手。图就出来了。**

就这一步。图会出现在 `output` 文件夹里，而且会自动帮你打开。

> **不想拖？** 把 `run.bat` 和 `.pkg` 放在同一个文件夹里，双击 `run.bat` 也行。

### 去哪里找 pkg 文件

Wallpaper Engine 下载的壁纸在这个位置：

```
D:\Steam\steamapps\workshop\content\431960\
```

里面每个数字文件夹就是一张壁纸。**有 `scene.pkg` 的才能提**，见下面那张表。

（盘符按你自己的 Steam 装在哪来定。）

---

## 哪些能提，哪些不能提

Wallpaper Engine 的壁纸有四种类型，"能不能出图"完全取决于类型：

| 拖进去的东西 | 能出图吗 | 说明 |
|---|:---:|---|
| **`scene.pkg`** | ✅ **能** | 场景壁纸，最常见的。原图就在里面 |
| **`.tex` 文件** | ✅ 能 | 解包后得到的纹理，图片就在这里面 |
| **整个壁纸文件夹** | ✅ 能 | 会自动找到里面的 pkg 处理 |
| `preview.jpg` | ➖ 不用提 | 本来就是图片，直接就能用（但它是缩略图，比较糊） |
| **`.mp4` / `.webm`** | ❌ 不能 | 视频壁纸，里面没有 pkg，就是一段视频 |
| `index.html`、`.exe` | ❌ 不能 | 网页壁纸 / 应用程序壁纸，不是图片格式 |

### 怎么知道自己是哪种

打开壁纸文件夹看一眼就行：

```
有 scene.pkg          ->  场景壁纸，拖它           ✅
只有 xxx.mp4          ->  视频壁纸，见下面         ❌
有 index.html         ->  网页壁纸，图片本来就是散的 ❌
有 xxx.exe            ->  应用程序壁纸              ❌
```

**四种类型分别怎么拿到图：**

- **场景壁纸** → 用这个工具拖 `scene.pkg`，出原图
- **视频壁纸** → 里面没有 pkg，但同文件夹一般有个 `preview.jpg` 可以直接用；
  想要高清帧就用 ffmpeg 截一帧：`ffmpeg -i 视频.mp4 -vframes 1 out.jpg`
- **网页壁纸** → 图片本来就是散在文件夹里的（例如 `imgs\` 目录），直接拷出来就行
- **应用程序壁纸** → 是个小游戏，没有"壁纸图"这个概念，拿不到

> 拖错文件上去不会出错，工具会告诉你这是哪种类型、该怎么办。

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

除了上面说的类型问题，还有一种情况：

**特效遮罩图提不出来。** 水波、光晕那种灰灰的遮罩图，测试的 70 个纹理里有 27 个提不出来。

**但这不影响你要的壁纸** —— 壁纸本体全都能提出来。

---

## 支持范围

实测过 15 个真实的 Steam 创意工坊订阅包（共 297 MB）：

- PKG 解包 **15 / 15 全部成功**
- 每个包里的壁纸原图**全部无损提取**

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
