# 宣传片制作说明

55 秒、1920×1080、30fps 的文字动效广告片。全片不使用实拍素材：以中文大字排版推动叙事，产品界面使用项目真实运行截图（演示数据），配音为 edge-tts，配乐与音效由脚本合成。

成片：`../选课工作台-宣传片.mp4`  
封面：`cover.png`

## 1. 为什么没有直接套用 MoneyPrinterTurbo

MoneyPrinterTurbo 的主流程是「素材库视频 + 文案 + TTS + 字幕」的拼接，适合有实拍/B-roll 的短视频。本片要求「主要用文字」，素材是排版而不是视频片段，因此只复用了它最合适的部分：

- 用 `edge-tts` 生成中文旁白（与 MoneyPrinterTurbo 的 TTS 思路一致）；
- 用 `ffmpeg` 完成混音、响度归一和 H.264/AAC 编码。

其余改为**确定性的 HTML/CSS/JS 时间轴渲染**：每一帧由 `applyFrame(t)` 计算，Playwright 逐帧截图，因此文字排版、出入点、UI 缩放和旁白可以精确对齐，也方便改文案后重出片。

## 2. 文件结构

```
video/
├─ index.html           # 13 个场景的排版与样式
├─ video.js             # 时间轴动画（applyFrame(t)）
├─ timeline.json/.js    # 由旁白时长生成的时间轴
├─ make_vo.py           # edge-tts 生成 13 句旁白
├─ build_timeline.py    # 根据旁白时长计算场景起止
├─ make_audio.py        # 合成配乐、音效，混入旁白并做侧链闪避
├─ normalize.py         # 两遍 loudnorm，输出 -16 LUFS / -1.5 dBTP
├─ render.mjs           # Playwright 逐帧渲染（1652 帧）
├─ capture.mjs          # 从本地运行的项目截取界面图（2x）
├─ shots/               # 界面截图（3840×2160）
├─ assets/              # 字体、噪点纹理
├─ audio/               # 旁白、配乐、混音
└─ frames/render/       # 渲染中间帧（可删除）
```

## 3. 重新生成

前置：Node 22 + pnpm（项目本身）、Python 3.13、`pip install edge-tts imageio-ffmpeg numpy scipy pillow`、Edge 浏览器。

```powershell
# 0. 启动项目（另开窗口），截图需要 5173
pnpm dev

cd video

# 1. 旁白（需要联网）
python make_vo.py

# 2. 时间轴
python build_timeline.py

# 3. 配乐 / 音效 / 混音
python make_audio.py
python normalize.py

# 4. 截图（项目已启动时）
node capture.mjs

# 5. 起静态服务（另开窗口）
python -m http.server 8010 --bind 127.0.0.1

# 6. 逐帧渲染
node render.mjs

# 7. 编码
$ff = "D:\python\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v9.0.2.exe"
& $ff -y -framerate 30 -i frames/render/f_%05d.jpg -i audio/mix.wav `
  -vf "scale=in_range=pc:out_range=tv,format=yuv420p" `
  -c:v libx264 -preset slow -crf 17 -color_range tv `
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 `
  -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart `
  "..\选课工作台-宣传片.mp4"
```

只改某一句文案时：改 `make_vo.py` 的 `LINES` → 重跑 1–3 → 重渲染。只改画面时：直接改 `index.html` / `video.js`，重跑 6–7。

## 4. 设计口径

- **文案浮夸，事实克制。** “全凭玄学”“大型开盲盒现场”是情绪表达；159 学分、103 已获、14 计划覆盖、1 处冲突都来自项目演示数据。
- **颜色沿用产品。** 暖纸白 `#f5f4f0`、墨色 `#17161a`、主色 `#6d28d9`；痛点段落反转为深色，产品段落回到纸白。
- **界面不造假。** UI 镜头全部来自项目真实页面截图；片尾明确标注“课程作业演示 / 演示数据均为虚构 / 不替代学校正式选课系统”。
- **节奏。** 0–21 秒痛点（深色、快切、压迫感），21 秒“停”转折（白场、巨字），25–46 秒产品演示（暖白、UI 卡片），46–50 秒情绪落地（日出），50–55 秒片尾（深紫、品牌收束）。

## 5. 素材与许可

- 字体：Noto Sans SC / Noto Serif SC（SIL OFL），随仓库放在 `assets/fonts/`。
- 界面截图：项目自身，演示数据为虚构。
- 配乐/音效：本仓库脚本用 numpy 合成，无第三方音源。
- 旁白：edge-tts（Microsoft Edge 在线语音），仅用于课程作业演示。
