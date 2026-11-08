import json, math, os, subprocess, wave
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
TL = json.load(open("timeline.json", encoding="utf-8"))
DUR = TL["duration"]
N = int(round(DUR * SR))
SC = {s["key"]: s for s in TL["scenes"]}
FF = r"D:\python\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v9.0.2.exe"
rng = np.random.default_rng(42)

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)

def t_axis(dur): return np.arange(int(dur * SR)) / SR

def env_adsr(n, a=0.01, d=0.1, s=0.7, r=0.2):
    a = max(1, int(a * SR)); d = max(1, int(d * SR)); r = max(1, int(r * SR))
    if a + d + r >= n:
        a = max(1, int(n * .08)); d = max(1, int(n * .12)); r = max(1, int(n * .2))
    s = max(1, n - a - d - r)
    env = np.concatenate([np.linspace(0, 1, a, endpoint=False), np.linspace(1, .7, d, endpoint=False),
                          np.full(s, .7), np.linspace(.7, 0, r)])
    if len(env) < n:
        env = np.pad(env, (0, n - len(env)))
    return env[:n]

def fade(x, a=0.01, r=0.05):
    n = len(x); a = min(n, int(a * SR)); r = min(n, int(r * SR))
    if a > 0: x[:a] *= np.linspace(0, 1, a)
    if r > 0: x[-r:] *= np.linspace(1, 0, r)
    return x

def place(buf, x, at):
    i = int(round(at * SR))
    if i >= len(buf): return
    j = min(len(buf), i + len(x))
    if buf.ndim == 2 and x.ndim == 1:
        x = np.stack([x, x], axis=1)
    buf[i:j] += x[:j - i]

def place_pan(buf, x, at, pan=.5):
    place(buf, np.stack([x * (1 - pan), x * pan], axis=1), at)

def lowpass(x, fc, order=2):
    fc = min(fc, SR * .45)
    sos = signal.butter(order, fc / (SR / 2), btype="low", output="sos")
    return signal.sosfilt(sos, x)

def highpass(x, fc, order=2):
    sos = signal.butter(order, max(20, fc) / (SR / 2), btype="high", output="sos")
    return signal.sosfilt(sos, x)

def bandpass(x, lo, hi, order=2):
    lo = max(20, lo); hi = min(SR * .45, hi)
    sos = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], btype="band", output="sos")
    return signal.sosfilt(sos, x)

def saw(freq, n, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * freq + phase) % 1.0) - 1

def sine(freq, n, phase=0.0):
    return np.sin(2 * np.pi * (freq * np.arange(n) / SR + phase))

# ---------------- instruments ----------------
def pad_note(freq, dur, amp=.05):
    n = int(dur * SR)
    out = np.zeros(n)
    for det, pan in [(-.0025, .0), (0.0, .5), (.0028, 1.0)]:
        x = saw(freq * (1 + det), n, rng.random())
        x += .6 * saw(freq * (1 + det * 1.7) + .7, n, rng.random())
        out += x * (0.65 if pan == .5 else .45)
    out = lowpass(out, 1500 if freq < 300 else 2200, 2)
    out *= env_adsr(n, .9, .4, .75, 1.2)
    return out * amp

def pluck(freq, dur, amp=.10, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h in range(1, 9):
        f = freq * h
        if f > 12000: break
        decay = (1.1 + .55 * h) * (1.0 / bright)
        out += (1.0 / (h ** 1.55)) * np.sin(2 * np.pi * f * t + rng.random() * 6.28) * np.exp(-t / decay)
    out *= (1 - np.exp(-t / .004))
    out = lowpass(out, 6000, 2)
    return out * amp

def piano(freq, dur, amp=.12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    partials = [(1, 1.0, 1.8), (2, .42, 1.0), (3, .2, .65), (4, .09, .45), (5, .04, .3)]
    for h, a, d in partials:
        out += a * np.sin(2 * np.pi * freq * h * t + rng.random()) * np.exp(-t / d)
    out *= (1 - np.exp(-t / .003))
    out = lowpass(out, 7000, 2)
    return out * amp

def bell(freq, dur=1.6, amp=.12):
    n = int(dur * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, a, d in [(1, 1, 1.8), (2.0, .45, 1.2), (2.76, .3, .9), (4.07, .16, .55), (5.4, .08, .35)]:
        out += a * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t / d)
    out *= (1 - np.exp(-t / .002))
    return out * amp

def bass_note(freq, dur, amp=.16):
    n = int(dur * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) + .22 * np.sin(2 * np.pi * freq * 2 * t)
    x = lowpass(x, 320, 2)
    x *= env_adsr(n, .005, .08, .75, .12)
    return x * amp

def kick(amp=.5):
    n = int(.55 * SR); t = np.arange(n) / SR
    f = 44 + 95 * np.exp(-t * 26)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-t * 7.5)
    click = bandpass(rng.normal(0, 1, n), 800, 5000) * np.exp(-t * 110) * .18
    return (body + click) * amp

def clap(amp=.2):
    n = int(.3 * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for d in [0, .011, .022]:
        i = int(d * SR)
        seg = rng.normal(0, 1, n - i) * np.exp(-np.arange(n - i) / SR / .045)
        out[i:] += seg
    out = bandpass(out, 900, 3600, 2)
    out *= np.exp(-t / .14)
    return out * amp

def hat(amp=.06, dur=.05):
    n = int(dur * SR); t = np.arange(n) / SR
    return highpass(rng.normal(0, 1, n), 6500, 2) * np.exp(-t / .012) * amp

def snare(amp=.12):
    n = int(.2 * SR); t = np.arange(n) / SR
    noise = bandpass(rng.normal(0, 1, n), 1400, 5200) * np.exp(-t / .055)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t / .045) * .5
    return (noise + tone) * amp

def impact(amp=.9):
    n = int(2.4 * SR); t = np.arange(n) / SR
    f = 30 + 55 * np.exp(-t * 8)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-t / .85)
    boom = lowpass(rng.normal(0, 1, n), 260, 2) * np.exp(-t / .35) * .5
    return (body + boom) * amp

def whoosh(dur=.7, amp=.18, rev=False):
    n = int(dur * SR); t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    # time-varying bandpass using overlapping segments
    out = np.zeros(n)
    for i in range(0, n, 1024):
        seg = noise[i:i + 1024]
        p = i / n
        fc = (400 + 2600 * (p if not rev else 1 - p))
        sos = signal.butter(2, [max(80, fc * .6) / (SR / 2), min(SR * .45, fc * 1.8) / (SR / 2)], btype="band", output="sos")
        out[i:i + 1024] = signal.sosfilt(sos, seg)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.7
    return out * env * amp

def riser(dur, amp=.22):
    n = int(dur * SR); t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    out = np.zeros(n)
    for i in range(0, n, 2048):
        p = i / n
        fc = 300 + 7000 * p
        sos = signal.butter(2, [max(80, fc * .5) / (SR / 2), min(SR * .45, fc * 1.6) / (SR / 2)], btype="band", output="sos")
        out[i:i + 2048] = signal.sosfilt(sos, noise[i:i + 2048])
    tone = np.sin(2 * np.pi * np.cumsum(120 + 500 * (t / dur) ** 1.5) / SR) * .25
    env = (t / dur) ** 2.2
    return (out + tone) * env * amp

def click(amp=.13, freq=1200, dur=.03):
    n = int(dur * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t / .003)
    x += rng.normal(0, 1, n) * np.exp(-t / .0015) * .4
    return x * amp

def pop(amp=.15):
    n = int(.12 * SR); t = np.arange(n) / SR
    f = 500 + 500 * np.exp(-t * 22)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28) * amp

def error_buzz(amp=.12):
    n = int(.55 * SR); t = np.arange(n) / SR
    x = signal.square(2 * np.pi * 110 * t) * .3 + signal.square(2 * np.pi * 164 * t) * .2
    x = lowpass(x, 1800, 2)
    env = (1 - np.exp(-t * 50)) * np.exp(-t * 6) * (1 + .3 * np.sin(2 * np.pi * 17 * t))
    return x * env * amp

def coin(amp=.18):
    n = int(1.5 * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for f, a, d in [(1860, .5, .35), (2630, .3, .25), (3520, .12, .18)]:
        out += np.sin(2 * np.pi * f * t + rng.random()) * np.exp(-t / d) * a
    out += bandpass(rng.normal(0, 1, n), 4000, 8000) * np.exp(-t / .05) * .15
    return out * amp

def typing(dur=2.0, amp=.05):
    n = int(dur * SR)
    out = np.zeros(n)
    for _ in range(46):
        at = rng.uniform(0, dur - .08)
        k = click(amp * rng.uniform(.5, 1.1), rng.uniform(800, 1800), .02)
        place(out, k, at)
    return out

# ---------------- reverb ----------------
def make_ir(seconds=2.2, damp=3800):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, (n, 2)) * np.exp(-t / (seconds * .3))[:, None]
    ir[:, 0] = lowpass(ir[:, 0], damp)
    ir[:, 1] = lowpass(ir[:, 1], damp)
    ir /= np.sqrt((ir ** 2).sum(axis=0, keepdims=True)) + 1e-9
    return ir

IR = make_ir()

def reverb(x, wet=.28):
    if x.ndim == 1:
        y = signal.fftconvolve(x, IR[:, 0], mode="same")
    else:
        y = np.stack([signal.fftconvolve(x[:, 0], IR[:, 0], mode="same"),
                      signal.fftconvolve(x[:, 1], IR[:, 1], mode="same")], axis=1)
    return x if x.ndim == 2 else y * wet + x * (1 - wet)

# ---------------- music ----------------
music = np.zeros((N, 2), dtype=np.float64)
dry = np.zeros((N, 2), dtype=np.float64)  # to be reverbed later

def add_pad(at, dur, notes, amp=.035):
    for i, m in enumerate(notes):
        x = pad_note(midi(m), dur, amp)
        pan = .5 + .3 * math.sin(i * 2.1)
        place_pan(music, x, at, pan)

def add_piano(at, dur, note, amp=.12, pan=.5):
    x = piano(midi(note), dur, amp)
    place(music, x * (1 - pan), at); place(music, x * pan, at)
    place(dry, x * (1 - pan), at); place(dry, x * pan, at)

def add_bell(at, dur, note, amp=.1, pan=.5):
    x = bell(midi(note), dur, amp)
    place(music, x * (1 - pan), at); place(music, x * pan, at)
    place(dry, x * (1 - pan), at); place(dry, x * pan, at)

def add_pluck(at, note, dur=.7, amp=.06, pan=.5):
    x = pluck(midi(note), dur, amp)
    place(music, x * (1 - pan), at); place(music, x * pan, at)
    place(dry, x * (1 - pan), at); place(dry, x * pan, at)

def add_bass(at, note, dur, amp=.11):
    x = bass_note(midi(note), dur, amp)
    place_pan(music, x, at, .5)

def add_kick(at, amp=.42):
    x = kick(amp); place_pan(music, x, at, .5)

def add_clap(at, amp=.13):
    x = clap(amp); place_pan(music, x, at, .48)

def add_hat(at, amp=.05, dur=.05):
    x = hat(amp, dur); place_pan(music, x, at, .62)

# ---- intro 0..21.4 ----
INTRO_END = SC["turn"]["start"]
intro_chords = [(0, 45, [57, 60, 64, 69]), (5, 41, [53, 57, 60, 65]),
                (10, 48, [60, 64, 67, 72]), (15, 43, [55, 59, 62, 67])]
for at, root, notes in intro_chords:
    add_pad(at, 5.6, notes, .030)
    add_bass(at, root - 12, 4.7, .075)
    for k in range(8):
        add_hat(at + k * .625, .022 if k % 2 else .034)
    # sparse motif
    for k, note in enumerate([notes[3], notes[2], notes[1], notes[3] + 3]):
        add_pluck(at + .6 + k * 1.05, note, .9, .038, .35 + .3 * (k % 2))
add_pad(20, 1.7, [57, 60, 64, 69], .032)

# clock ticks
for i in range(int(21.2 / .625)):
    x = click(.028, 2300, .02)
    place_pan(music, x, i * .625, .58)

# riser into turn
r = riser(3.2, .26)
place_pan(music, r, 18.3, .5)

# ---- turn 21.4..25.73 ----
TURN = SC["turn"]["start"]
place_pan(music, impact(.68), TURN, .5)
# low drone
n = int(4.2 * SR); t = np.arange(n) / SR
drone = (np.sin(2 * np.pi * 55 * t) * .5 + np.sin(2 * np.pi * 82.5 * t) * .2) * (1 - np.exp(-t * 1.5)) * np.exp(-t / 3.5) * .12
place_pan(music, drone, TURN + .05, .5)
add_piano(TURN + 1.0, 2.2, 69, .10, .5)
# snare roll
for i in range(22):
    at = TURN + 2.4 + i * .062
    if at > 25.6: break
    add_hat(at, .012 + .02 * (i / 22), .04)
r2 = riser(3.1, .30)
place_pan(music, r2, 22.3, .5)

# ---- groove 25.73..46.28 ----
G0 = SC["reveal"]["start"]
GROOVE_END = SC["payoff"]["start"]
place_pan(music, impact(.34), G0, .5)
groove_chords = [(25.73, 41, [53, 57, 60, 65]), (30.73, 48, [60, 64, 67, 72]),
                 (35.73, 43, [55, 59, 62, 67]), (40.73, 45, [57, 60, 64, 69]),
                 (45.73, 41, [53, 57, 60, 65])]
# drums
bt = 0.625
bar0 = G0
tcur = G0
beat_i = 0
while tcur < GROOVE_END - .05:
    add_kick(tcur, .40 if beat_i % 4 == 0 else .34)
    if beat_i % 4 in (1, 3):
        add_clap(tcur, .125)
        add_hat(tcur, .03)
    for k in range(2):
        add_hat(tcur + k * bt / 2, .036 if k == 0 else .05)
    tcur += bt; beat_i += 1

# bass / pads / arps
for at, root, notes in groove_chords:
    dur = min(5.0, GROOVE_END - at)
    add_pad(at, dur + .2, notes, .042)
    for k in range(int(dur / (bt / 2))):
        note = root - 12 + (12 if (k // 4) % 2 == 1 else 0)
        add_bass(at + k * bt / 2, note, bt * .46, .105)
    # arpeggio 16ths
    patt = [0, 2, 1, 3, 2, 1, 3, 2]
    step = bt / 4
    for k in range(int(dur / step)):
        note = notes[patt[k % len(patt)]] + 12
        add_pluck(at + k * step, note, .55, .030, .30 + .4 * ((k % 4) / 3))
    # lead bell every 2 bars
    add_bell(at + 1.2, 1.4, notes[3] + 12, .055, .45)

# extra sparkle in delight section
for at in [42.4, 43.0, 43.6, 44.2, 44.8, 45.4]:
    add_bell(at, .9, 84, .028, .35)
    add_bell(at + .16, .9, 88, .022, .65)

# fill before payoff
for i in range(8):
    add_hat(GROOVE_END - 1.0 + i * .12, .03 + i * .004, .04)

# ---- payoff 46.28..49.91 ----
P0 = SC["payoff"]["start"]
add_pad(P0, 3.8, [48, 55, 59, 64, 67], .050)
add_piano(P0 + .15, 2.6, 60, .11, .45)
add_piano(P0 + .75, 2.4, 64, .095, .55)
add_piano(P0 + 1.35, 2.2, 67, .085, .5)
add_piano(P0 + 1.95, 2.2, 72, .075, .45)
add_bass(P0, 36, 3.4, .075)
add_bell(P0 + .6, 2.2, 84, .035, .4)
add_bell(P0 + 1.8, 2.2, 88, .028, .6)

# transition into CTA
place_pan(music, impact(.45), SC["cta"]["start"] - .02, .5)
r3 = riser(1.8, .12)
place_pan(music, r3, SC["cta"]["start"] - 1.6, .5)

# ---- CTA 49.91..end ----
C0 = SC["cta"]["start"]
add_pad(C0, max(1.0, DUR - C0), [48, 55, 59, 64, 67, 72], .055)
add_bass(C0, 36, 4.6, .09)
place_pan(music, impact(.55), C0, .5)
for i, note in enumerate([84, 88, 91, 96]):
    add_bell(C0 + .3 + i * .22, 2.8, note, .055, .35 + .1 * i)

# ----- reverb -----
wet = reverb(dry, .32)
music += wet * .55

# mute music in the tiny pre-drop silence
mute_a = int((25.55) * SR); mute_b = int(25.73 * SR)
music[mute_a:mute_b] *= np.linspace(1, 0, mute_b - mute_a)[:, None]

# ----- VO track -----
def decode_mp3(path, out_wav):
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", path, "-ar", str(SR), "-ac", "1", out_wav], check=True)

vo = np.zeros(N)
meta = json.load(open("audio/vo_meta.json", encoding="utf-8"))
for m in meta:
    wav = f"audio/_{m['key']}.wav"
    decode_mp3(m["file"], wav)
    sr, x = wavfile.read(wav)
    x = x.astype(np.float64) / 32768.0
    # trim leading/trailing near-silence
    idx = np.where(np.abs(x) > 10 ** (-42 / 20))[0]
    if len(idx):
        x = x[max(0, idx[0] - int(.02 * SR)): min(len(x), idx[-1] + int(.06 * SR))]
    rms = np.sqrt(np.mean(x ** 2)) + 1e-9
    x *= 10 ** (-20 / 20) / rms
    pk = np.max(np.abs(x))
    if pk > .9: x *= .9 / pk
    x = fade(x, .01, .06)
    sc = SC[m["key"]]
    place(vo, x, sc["vo_start"])
    print(f"VO {m['key']:8s} at {sc['vo_start']:6.2f}  dur {len(x)/SR:5.2f}  rms {20*np.log10(np.sqrt(np.mean(x**2))+1e-9):6.1f} dBFS")

# ----- SFX -----
sfx = np.zeros((N, 2))

def add_sfx(x, at, pan=.5, amp=1.0):
    x = x * amp
    place(sfx, x * (1 - pan), at); place(sfx, x * pan, at)

# typing in hook
add_sfx(typing(2.0, .05), .5, .5, .8)
# section whooshes
for k in ["pain1", "pain2", "pain3", "pain4"]:
    add_sfx(whoosh(.65, .12), SC[k]["start"], .5, .8)
# notification pings in pain2
for i, at in enumerate([8.9, 9.7, 10.4, 11.1]):
    add_sfx(bell(midi(88 + (i % 3) * 4), .6, .055), at, .35 + .1 * i, .8)
# conflict impact
add_sfx(impact(.45), SC["pain3"]["start"] + 1.26, .5, .5)
add_sfx(error_buzz(.10), SC["pain3"]["start"] + 1.3, .5, .62)
# coin
add_sfx(coin(.15), SC["pain4"]["start"] + .9, .55, .8)
add_sfx(coin(.10), SC["pain4"]["start"] + 2.2, .45, .6)
# turn
add_sfx(impact(.8), SC["turn"]["start"], .5, 1.0)
# reveal chime
add_sfx(bell(midi(84), 1.6, .09), SC["reveal"]["start"] + 1.15, .45, .9)
add_sfx(bell(midi(91), 1.8, .06), SC["reveal"]["start"] + 1.45, .6, .8)
# feature transitions and clicks
for k, off in [("feat1", .05), ("feat2", .05), ("feat3", .05)]:
    add_sfx(whoosh(.55, .10), SC[k]["start"] + off, .5, .7)
add_sfx(click(.11, 1700, .04), SC["feat1"]["start"] + .9, .4, .7)
add_sfx(pop(.12), SC["feat2"]["start"] + 1.1, .55, .8)
add_sfx(click(.1, 1900, .04), SC["feat2"]["start"] + 1.55, .6, .7)
add_sfx(pop(.14), SC["feat3"]["start"] + 1.0, .5, .8)
# delight
add_sfx(whoosh(.6, .12), SC["delight"]["start"] + .5, .45, .8)
add_sfx(click(.14, 900, .05), SC["delight"]["start"] + 1.48, .65, .9)
add_sfx(pop(.12), SC["delight"]["start"] + 1.55, .7, .7)
add_sfx(whoosh(.45, .09), SC["delight"]["start"] + 2.45, .65, .7)
# payoff
add_sfx(whoosh(.8, .07), SC["payoff"]["start"] - .1, .45, .7)
add_sfx(bell(midi(79), 2.2, .06), SC["payoff"]["start"] + .2, .5, .8)
# cta
add_sfx(bell(midi(84), 2.6, .07), SC["cta"]["start"] + .35, .4, .8)
add_sfx(bell(midi(88), 2.4, .05), SC["cta"]["start"] + .55, .6, .7)

# add a touch of reverb to sfx
sfx = sfx + reverb(sfx, .25) * .25

# section energy shaping
g = np.ones(N)
def ramp_gain(a, b, v):
    global g
    ia, ib = int(a * SR), int(b * SR)
    g[ia:ib] = v
ramp_gain(0, 21.3, 1.85)
ramp_gain(21.4, 25.6, 1.10)
ramp_gain(25.75, 45.6, 1.26)
ramp_gain(45.6, 46.28, 1.15)
ramp_gain(46.3, 49.9, 1.15)
ramp_gain(49.95, DUR, 1.02)
# smooth section edges
k = int(.25 * SR)
kernel = np.hanning(k); kernel /= kernel.sum()
g = np.convolve(g, kernel, mode="same")
music *= g[:, None]

# ----- duck music under VO -----
env = np.abs(vo)
# smooth envelope
win = int(.03 * SR)
env = signal.lfilter(np.ones(win) / win, [1], env)
# attack/release smoothing
gain = np.ones(N)
thr = 10 ** (-40 / 20)
target = np.where(env > thr, .48, 1.0)
# simple attack fast, release slow
alpha_a = math.exp(-1 / (.02 * SR)); alpha_r = math.exp(-1 / (.35 * SR))
g = 1.0
for i in range(N):
    a = alpha_a if target[i] < g else alpha_r
    g = a * g + (1 - a) * target[i]
    gain[i] = g
music *= gain[:, None]

# ----- mix -----
mix = music * .95 + vo[:, None] * 1.0 + sfx
# gentle bus compression / soft clip
peak = np.max(np.abs(mix)) + 1e-9
if peak > .98:
    mix *= .98 / peak
# fade in/out
mix[:int(.2 * SR)] *= np.linspace(0, 1, int(.2 * SR))[:, None]
fo = int(1.2 * SR)
mix[-fo:] *= np.linspace(1, 0, fo)[:, None]

wavfile.write("audio/mix_raw.wav", SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))
wavfile.write("audio/music.wav", SR, (np.clip(music, -1, 1) * 32767).astype(np.int16))
wavfile.write("audio/vo.wav", SR, (np.clip(vo, -1, 1) * 32767).astype(np.int16))
wavfile.write("audio/sfx.wav", SR, (np.clip(sfx, -1, 1) * 32767).astype(np.int16))
print("wrote mix_raw.wav", round(len(mix) / SR, 2), "s  peak", round(float(np.max(np.abs(mix))), 3))
print("music rms", round(float(20 * np.log10(np.sqrt(np.mean(music ** 2)) + 1e-9)), 1),
      "vo rms", round(float(20 * np.log10(np.sqrt(np.mean(vo ** 2)) + 1e-9)), 1))
