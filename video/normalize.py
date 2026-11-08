import subprocess, re, json, sys

FF = r"D:\python\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v9.0.2.exe"
SRC = "audio/mix_raw.wav"
OUT = "audio/mix.wav"

p = subprocess.run([FF, "-hide_banner", "-nostats", "-i", SRC,
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
                    "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="ignore")
text = p.stderr
m = re.search(r"\{[\s\S]*?\}", text[text.rfind("loudnorm"):])
if not m:
    print(text[-3000:]); sys.exit(1)
data = json.loads(m.group(0))
print({k: data[k] for k in ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]})

filt = (f"loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:"
        f"measured_I={data['input_i']}:measured_TP={data['input_tp']}:"
        f"measured_LRA={data['input_lra']}:measured_thresh={data['input_thresh']}:"
        f"offset={data['target_offset']}")
p2 = subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "warning", "-i", SRC,
                     "-af", filt, "-ar", "48000", "-ac", "2", OUT], capture_output=True, text=True)
print(p2.stderr.strip())
print("wrote", OUT)
