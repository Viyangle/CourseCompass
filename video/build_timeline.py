import json

META = {m["key"]: m for m in json.load(open("audio/vo_meta.json", encoding="utf-8"))}

# key, gap after voice, label
SCENES = [
    ("hook",    0.90, "还在为不知道选什么课而苦恼吗？"),
    ("pain1",   0.50, "培养方案，翻了三遍"),
    ("pain2",   0.45, "评价刷到凌晨"),
    ("pain3",   0.40, "两门课，到底撞不撞"),
    ("pain4",   0.40, "方案 A，还是方案 B"),
    ("turn",    0.70, "停"),
    ("reveal",  0.70, "把三张表，装进一张图"),
    ("feat1",   0.45, "学分缺口，一眼看穿"),
    ("feat2",   0.45, "时间冲突，提前拦截"),
    ("feat3",   0.45, "A 案 B 案，并排开卷"),
    ("delight", 0.60, "拖一拖，换一换"),
    ("payoff",  0.70, "把熬夜排课的晚上，还给你"),
    ("cta",     2.80, "先规划，再选课"),
]

LEAD = 0.22
t = 0.30
scenes = []
for key, gap, label in SCENES:
    dur = META[key]["duration"]
    start = round(t, 3)
    vo_start = round(start + LEAD, 3)
    end = round(vo_start + dur + gap, 3)
    scenes.append({
        "key": key, "label": label, "start": start, "end": end,
        "dur": round(end - start, 3), "vo_start": vo_start, "vo_dur": dur,
        "gap": gap,
    })
    t = end

total = round(scenes[-1]["end"] + 0.0, 3)
out = {"fps": 30, "width": 1920, "height": 1080, "duration": total, "lead": LEAD, "scenes": scenes}

with open("timeline.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
with open("timeline.js", "w", encoding="utf-8") as f:
    f.write("window.TL = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n")

for s in scenes:
    print(f"{s['key']:8s} {s['start']:6.2f} → {s['end']:6.2f}  ({s['dur']:4.2f}s)  vo@{s['vo_start']:.2f}")
print("TOTAL", total)
