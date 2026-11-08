import asyncio, edge_tts, json, os, subprocess, re

LINES = [
    ("hook",    "还在为不知道选什么课而苦恼吗？"),
    ("pain1",   "培养方案翻了三遍，学分还是没算明白。"),
    ("pain2",   "课程评价刷到凌晨，越看越不敢选。"),
    ("pain3",   "两门课到底撞不撞？排完课表才知道。"),
    ("pain4",   "方案 A 还是方案 B？全凭感觉。"),
    ("turn",    "停！选课，不该是一场赌博。"),
    ("reveal",  "选课工作台，把培养方案、课程库、课表，装进同一张图。"),
    ("feat1",   "学分缺口，一眼看穿。"),
    ("feat2",   "时间冲突，提前拦截。"),
    ("feat3",   "方案 A、方案 B，并排开卷。"),
    ("delight", "拖一拖，换一换，反悔还能撤销。"),
    ("payoff",  "把熬夜排课的晚上，还给你。"),
    ("cta",     "先规划，再选课。"),
]

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+12%"
PITCH = "+3Hz"

async def main():
    meta = []
    for key, text in LINES:
        out = f"audio/vo_{key}.mp3"
        comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
        await comm.save(out)
        # duration via ffmpeg
        ff = r"D:\python\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v9.0.2.exe"
        p = subprocess.run([ff, "-hide_banner", "-i", out], capture_output=True, text=True, encoding="utf-8", errors="ignore")
        m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", p.stderr)
        dur = int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3)) if m else 0
        meta.append({"key": key, "text": text, "file": out, "duration": round(dur, 3)})
        print(f"{key:8s} {dur:6.2f}s  {text}")

    with open("audio/vo_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print("TOTAL", round(sum(x["duration"] for x in meta), 2), "s")

asyncio.run(main())
