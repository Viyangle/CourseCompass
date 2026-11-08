/* 选课工作台 · 55s motion-graphics ad — deterministic timeline renderer */
(() => {
  const TL = window.TL;
  const SC = Object.fromEntries(TL.scenes.map(s => [s.key, s]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const P = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
  const EO3 = x => 1 - Math.pow(1 - x, 3);
  const EO5 = x => 1 - Math.pow(1 - x, 5);
  const EIO = x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const EOUT = x => 1 - Math.pow(1 - x, 2);
  const EBACK = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const mix = (a, b, x) => a + (b - a) * x;
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixC = (a, b, x) => { const A = hex(a), B = hex(b); return `rgb(${Math.round(mix(A[0], B[0], x))},${Math.round(mix(A[1], B[1], x))},${Math.round(mix(A[2], B[2], x))})`; };

  /* ---------------- text splitting ---------------- */
  function splitChars(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      if (!text || !text.trim()) continue;
      const frag = document.createDocumentFragment();
      for (const ch of Array.from(text)) {
        if (ch === ' ' || ch === '\n' || ch === '\u00a0') { frag.appendChild(document.createTextNode(ch)); continue; }
        const sp = document.createElement('span');
        sp.className = 'ch';
        sp.textContent = ch;
        frag.appendChild(sp);
      }
      node.parentNode.replaceChild(frag, node);
    }
  }

  const splitTargets = [
    '#hookTitle',
    '#turnCopy h2',
    '#sc-reveal h1',
    '#paycopy h2',
    '#ctaTag',
  ];
  splitTargets.forEach(sel => $(sel) && splitChars($(sel)));

  const charsIn = (root, lt, t0, opt = {}) => {
    const stagger = opt.stagger ?? .03, dur = opt.dur ?? .55;
    const y = opt.y ?? .95, rot = opt.rot ?? 6;
    const chars = $$('.ch', root);
    chars.forEach((ch, i) => {
      const st = t0 + i * stagger;
      const p = P(lt, st, st + dur);
      const e = EO5(p);
      ch.style.opacity = p <= 0 ? 0 : Math.min(1, p * 3);
      ch.style.transform = `translateY(${(1 - e) * y}em) rotate(${(1 - e) * rot}deg)`;
    });
  };

  const maskIn = (line, lt, t0, dur = .75, dist = 112) => {
    const inner = line.querySelector(':scope > span') || line.firstElementChild;
    if (!inner) return;
    const e = EO5(P(lt, t0, t0 + dur));
    inner.style.transform = `translateY(${(1 - e) * dist}%)`;
  };

  const fadeIn = (el, lt, t0, dur = .55, dy = 22) => {
    if (!el) return;
    const p = P(lt, t0, t0 + dur), e = EO3(p);
    el.style.opacity = p;
    el.style.transform = `translateY(${(1 - e) * dy}px)`;
  };

  /* ---------------- hook cards ---------------- */
  const hookCards = [];
  const hookData = [
    { n: '编译原理', c: 'CS304 · 张伟', m: '4 学分 · 周一 3–4 节', b: '与分布式系统冲突', x: 1288, y: 118, r: -4, warn: true },
    { n: '分布式系统', c: 'CS322 · 王浩', m: '3 学分 · 周一 3–4 节', b: '与编译原理冲突', x: 1538, y: 356, r: 3, warn: true },
    { n: '模式识别', c: 'CS323 · 许晴', m: '2 学分 · 周四 3–4 节', b: '可补缺口', x: 1362, y: 792, r: -2 },
    { n: '云计算', c: 'CS336 · 唐宁', m: '2 学分 · 周一 7–8 节', b: '可补缺口', x: 1004, y: 62, r: 1 },
    { n: '科技与社会', c: 'GEN2001 · 刘云', m: '2 学分 · 周二 9–10 节', b: '已在方案', x: 1632, y: 594, r: -3 },
    { n: '数据挖掘', c: 'CS332 · 钱多', m: '3 学分 · 周三 5–6 节', b: '备选', x: 1512, y: 894, r: 2 },
  ];
  const hookCardsWrap = $('#hookCards');
  hookData.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'fcard';
    el.innerHTML = `<div class="fc-top"><span>${d.c}</span><span>0${i + 1}</span></div>
      <div class="fc-name">${d.n}</div><div class="fc-meta">${d.m}</div>
      <span class="badge${d.warn ? '' : ' ok'}">${d.b}</span>`;
    el.style.left = d.x + 'px';
    el.style.top = d.y + 'px';
    el.style.transform = `rotate(${d.r}deg)`;
    el.style.filter = i === 6 || i === 5 ? 'blur(1.2px)' : 'none';
    hookCardsWrap.appendChild(el);
    hookCards.push({ el, ...d });
  });

  /* ---------------- pain 2 comment base ---------------- */
  const cmts = $$('#cmts .cmt').map((el, i) => {
    const m = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || '');
    return { el, rot: m ? parseFloat(m[1]) : 0, i };
  });

  /* ---------------- pain 3 refs ---------------- */
  const painGrid = $('#painGrid');
  const blk1 = $('#blk1'), blk2 = $('#blk2'), stamp = $('#stamp'), cline = $('#conflictline');

  /* ---------------- delight new slot ---------------- */
  const mockGrid = $('#mockGrid');
  const newSlot = document.createElement('div');
  newSlot.className = 'mslot';
  newSlot.id = 'newSlot';
  newSlot.style.left = '430px';
  newSlot.style.top = '250px';
  newSlot.style.zIndex = '3';
  newSlot.style.width = '140px';
  newSlot.style.opacity = '0';
  newSlot.innerHTML = '模式识别<div class="t">周四 3–4 节 · 1–16 周</div>';
  mockGrid.appendChild(newSlot);

  /* ---------------- scene activation ---------------- */
  const allScenes = $$('.scene');
  let activeKey = null;
  function activate(key) {
    if (activeKey === key) return;
    activeKey = key;
    allScenes.forEach(s => s.classList.toggle('on', s.id === 'sc-' + key));
  }

  const stageBg = $('#stage-bg'), dots = $('#dots'), vignette = $('#vignette');
  const brand = $('#brand'), flash = $('#flash'), sweep = $('#sweep'), fade = $('#global-fade');
  brand.style.transition = 'none';

  const darkScenes = new Set(['hook', 'pain1', 'pain2', 'pain3', 'pain4', 'payoff']);

  function setLook(key) {
    const dark = darkScenes.has(key);
    stageBg.style.background = key === 'cta' ? '#250c56' : (dark ? '#121116' : '#f5f4f0');
    dots.style.display = (!dark && key !== 'cta') ? 'block' : 'none';
    dots.style.opacity = key === 'turn' ? .18 : .32;
    vignette.style.opacity = dark ? .5 : (key === 'cta' ? .55 : .18);
    const showBrand = key === 'reveal' || key === 'feat1' || key === 'feat2' || key === 'feat3' || key === 'delight';
    brand.style.opacity = showBrand ? '1' : '0';
    brand.style.color = '#17161a';
    brand.querySelector('.bs').style.color = '#767b85';
  }

  /* ---------------- global fx ---------------- */
  const flashEvents = [
    { t: SC.turn.start + .01, c: '#ffffff', s: .8, d: .18 },
    { t: SC.pain3.start + 1.26, c: '#ff3b2f', s: .32, d: .22 },
  ];
  const sweepEvents = [SC.feat1.start, SC.feat2.start, SC.feat3.start, SC.delight.start];

  function globalFx(t) {
    let fo = 0, fc = '#fff';
    for (const e of flashEvents) {
      const d = t - e.t;
      if (d >= 0 && d < e.d) {
        const v = (1 - d / e.d) * e.s;
        if (v > fo) { fo = v; fc = e.c; }
      }
    }
    flash.style.background = fc;
    flash.style.opacity = fo;

    let so = 0, sx = -400;
    for (const st of sweepEvents) {
      const p = P(t, st + .02, st + .8);
      if (t >= st && t <= st + .82 && p > 0 && p < 1) {
        sx = mix(-360, 1960, EIO(p));
        so = Math.sin(Math.PI * p) * .55;
      }
    }
    sweep.style.transform = `translateX(${sx}px)`;
    sweep.style.opacity = so;
    fade.style.opacity = P(t, TL.duration - .65, TL.duration) * .9;
  }

  /* ================= SCENES ================= */
  const el = {
    hookLines: $$('#hookTitle .line'),
    hookEm: $('#hookTitle em'),
    hookQ: $('#hookTitle .qmark'),
    hookSub: $('#hookSub'),
    p1Docs: $$('#docs .doc'),
    p1Q: [$('#q1'), $('#q2')],
    tallies: $$('.tally'),
    p1sub: $('#p1sub'),
    p2sub: $('#p2sub'),
    p3sub: $('#p3sub'),
    clockghost: $('.clockghost'),
    tarotA: $('#tarotA'), tarotB: $('#tarotB'), coin: $('#coin'), p4sub: $('#p4sub'),
    stopbig: $('#stopbig'), stopring: $('#stopring'), turnCopy: $('#turnCopy'),
    strike: $('#strike'), turnChips: $$('.tchip'),
    revealLines: $$('#sc-reveal h1 .line'), rsub: $('.rsub'), rdesc: $('.rdesc'),
    revealChips: $$('.rchip'), revealFrame: $('#revealFrame'), revealZoom: $('#revealZoom'),
    revealBadge: $('#revealBadge'), src: [$('#src1'), $('#src2'), $('#src3')],
    f1Frame: $('#f1Frame'), f1Zoom: $('#f1Zoom'), f1hl: $('#f1hl'), creditNum: $('#creditNum'),
    creditBar: $('#creditBar'), f2Frame: $('#f2Frame'), f2Zoom: $('#f2Zoom'), f2hl: $('#f2hl'),
    f2scan: $('#f2scan'), f2detail: $('#f2detail'), f2chips: $$('#f2chips .fchip'),
    f3Frame: $('#f3Frame'), f3Zoom: $('#f3Zoom'), vsbadge: $('#vsbadge'),
    metrics: [$('#m1'), $('#m2'), $('#m3')],
    mock: $('.mock'), dragcard: $('#dragcard'), drop: $('#drop'), toast: $('#toast'),
    toastText: $('#toastText'), undoChip: $('#undoChip'), newSlot,
    dawn: $('#dawn'), moon: $('#moon'), orb: $('#orb'), clockbig: $('#clockbig'), paycopy: $('.paycopy'),
    payLines: $$('#paycopy h2 .line'), paySub: $('#paySub'), desk: $('.desk'),
    ctaLogo: $('#ctaLogo'), ctaName: $('#ctaName'), ctaTag: $('#ctaTag'), ctaLine: $('#ctaLine'),
    ctaDesc: $('#ctaDesc'), ctaChips: $$('.cta-chip'), ctaFoot: $('#ctaFoot'),
  };

  /* ---------- 1 hook ---------- */
  function animHook(lt) {
    charsIn(el.hookLines[0], lt, .10, { stagger: .018, dur: .42, y: .9, rot: 4 });
    charsIn(el.hookLines[1], lt, .32, { stagger: .042, dur: .62, y: 1.0, rot: 7 });
    charsIn(el.hookLines[2], lt, .88, { stagger: .036, dur: .55, y: .92, rot: 5 });
    el.hookEm.style.backgroundSize = `${P(lt, 1.18, 1.62) * 100}% .09em`;
    el.hookQ.style.opacity = P(lt, 1.42, 1.75);
    el.hookQ.style.transform = `scale(${1 + Math.sin(lt * 7.5) * .09}) rotate(${Math.sin(lt * 5) * 4}deg)`;
    const sp = EO3(P(lt, 2.0, 2.6));
    el.hookSub.style.opacity = sp;
    el.hookSub.style.transform = `translateY(${(1 - sp) * 16}px)`;
    hookCards.forEach((c, i) => {
      const p = P(lt, .22 + i * .07, .85 + i * .07);
      const drift = Math.sin(lt * .55 + i * 1.7) * 9;
      const driftY = Math.cos(lt * .42 + i * 1.1) * 7;
      c.el.style.opacity = p * .46 * (1 - P(lt, 3.45, 4.0) * .7);
      c.el.style.transform = `translate(${drift}px,${driftY}px) rotate(${c.r + Math.sin(lt * .4 + i) * .7}deg)`;
    });
    const ghost = $('.ghost');
    ghost.style.transform = `scale(${1 + lt * .008}) rotate(${-6 + lt * .15}deg)`;
  }

  /* ---------- 2 pain1 ---------- */
  function animPain1(lt) {
    el.p1Docs.forEach((d, i) => {
      const p = EO5(P(lt, .18 + i * .11, 1.05 + i * .11));
      const off = [[-210, -50, -18], [140, 70, 14], [-70, 130, -16]][i];
      const baseR = [-6, 3.5, 8][i];
      const floatX = i === 0 ? Math.sin(lt * .7) * 5 : 0;
      const floatY = i === 2 ? Math.cos(lt * .6) * 4 : 0;
      d.style.opacity = p;
      d.style.transform = `translate(${mix(off[0], floatX, p)}px,${mix(off[1], floatY, p)}px) rotate(${mix(baseR + off[2], baseR, p)}deg)`;
    });
    el.p1Q.forEach((q, i) => {
      const p = EBACK(P(lt, 1.6 + i * .35, 2.0 + i * .35));
      q.style.opacity = P(lt, 1.55 + i * .35, 1.8 + i * .35);
      q.style.transform = `scale(${mix(2.1, 1, p)}) rotate(${i ? 8 : -12}deg)`;
    });
    el.tallies.forEach((tt, i) => {
      const p = EO3(P(lt, 1.25 + i * .13, 1.55 + i * .13));
      tt.style.opacity = p;
      tt.style.transform = `scaleY(${p})`;
    });
    el.p1sub.style.opacity = P(lt, 1.5, 2.0);
    el.p1sub.style.transform = `translateY(${(1 - EO3(P(lt, 1.5, 2.0))) * 16}px)`;
    $('.bigword').style.transform = `translateX(${-lt * 8}px)`;
  }

  /* ---------- 3 pain2 ---------- */
  function animPain2(lt) {
    const dim = 1 - .38 * P(lt, 2.7, 3.5);
    cmts.forEach((c, i) => {
      const p = EO3(P(lt, .18 + i * .11, .75 + i * .11));
      const driftX = Math.sin(lt * .55 + i * 1.9) * 7;
      const driftY = Math.cos(lt * .45 + i * 1.3) * 6;
      c.el.style.opacity = p * dim;
      c.el.style.transform = `translate(${driftX}px,${(1 - p) * 46 + driftY}px) rotate(${c.rot + Math.sin(lt * .35 + i) * .8}deg) scale(${mix(.92, 1, p)})`;
    });
    el.clockghost.style.opacity = .05 + Math.sin(lt * 9) * .008;
    el.p2sub.style.opacity = P(lt, 1.55, 2.05);
    el.p2sub.style.transform = `translateY(${(1 - EO3(P(lt, 1.55, 2.05))) * 18}px)`;
    el.p2sub.style.filter = `blur(${(1 - P(lt, 1.55, 2.3)) * 6}px)`;
  }

  /* ---------- 4 pain3 ---------- */
  function animPain3(lt) {
    const ge = EO3(P(lt, .08, .75));
    painGrid.style.opacity = ge;
    const e1 = EO5(P(lt, .22, .9));
    blk1.style.opacity = e1;
    blk1.style.transform = `translateX(${(1 - e1) * -330}px)`;
    const e2 = EBACK(P(lt, .42, 1.18));
    blk2.style.opacity = P(lt, .4, .65);
    blk2.style.transform = `translateX(${mix(330, -220, clamp(e2, 0, 1.08))}px)`;
    const ip = P(lt, 1.26, 1.7);
    const amp = (1 - ip) * 15;
    painGrid.style.transform = `translate(${Math.sin(lt * 62) * amp}px,${Math.cos(lt * 51) * amp * .6}px)`;
    if (ip > 0) {
      blk2.style.boxShadow = `0 0 0 ${2 + Math.sin(lt * 18) * 1.5}px rgba(255,90,78,.55),0 0 50px rgba(255,90,78,.35)`;
    } else blk2.style.boxShadow = 'none';
    const sp = EBACK(P(lt, 1.28, 1.62));
    stamp.style.opacity = P(lt, 1.28, 1.4);
    stamp.style.transform = `scale(${mix(2.0, 1, sp)}) rotate(-9deg)`;
    cline.style.opacity = P(lt, 1.3, 1.5) * (.65 + .35 * Math.sin(lt * 14));
    el.p3sub.style.opacity = P(lt, 2.25, 2.7);
    el.p3sub.style.transform = `translateY(${(1 - EO3(P(lt, 2.25, 2.7))) * 16}px)`;
  }

  /* ---------- 5 pain4 ---------- */
  function animPain4(lt) {
    const ea = EO5(P(lt, .25, 1.05));
    const eb = EO5(P(lt, .45, 1.25));
    const wob = lt > 1.4 ? Math.sin(lt * 1.7) * 1.1 : 0;
    el.tarotA.style.opacity = ea;
    el.tarotA.style.transform = `translateY(${(1 - ea) * 280}px) rotate(${mix(-19, -8 + wob, ea)}deg)`;
    el.tarotB.style.opacity = eb;
    el.tarotB.style.transform = `translateY(${(1 - eb) * 300}px) rotate(${mix(18, 7 - wob, eb)}deg)`;
    const pc = P(lt, .85, 2.25);
    const cy = mix(-130, 0, EO3(pc));
    el.coin.style.opacity = P(lt, .8, 1.0);
    el.coin.style.transform = `translateY(${cy}px) rotateY(${pc * 1080}deg) scale(${1 + Math.sin(pc * Math.PI) * .06})`;
    el.p4sub.style.opacity = P(lt, 2.55, 3.0);
    el.p4sub.style.transform = `translateY(${(1 - EO3(P(lt, 2.55, 3.0))) * 16}px) rotate(${Math.sin(lt * 3) * .6}deg)`;
  }

  /* ---------- 6 turn ---------- */
  function animTurn(lt) {
    const mv = EIO(P(lt, .45, .9));
    el.stopbig.style.left = `${mix(50, 80, mv)}%`;
    el.stopbig.style.top = `${mix(46, 20, mv)}%`;
    el.stopbig.style.transform = `translate(-50%,-50%) scale(${mix(1, .30, mv) * (1 + Math.sin(lt * 2.4) * .006)})`;
    el.stopbig.style.opacity = 1;
    const rp = EO3(P(lt, 0, .62));
    el.stopring.style.opacity = (1 - P(lt, .28, .64)) * .9;
    el.stopring.style.transform = `translate(-50%,-50%) scale(${mix(.68, 1.18, rp)})`;
    maskIn(el.turnCopy.querySelectorAll('.line')[0], lt, .4, .6);
    maskIn(el.turnCopy.querySelectorAll('.line')[1], lt, .55, .6);
    el.turnCopy.querySelector('.kicker').style.opacity = P(lt, .32, .62);
    el.strike.style.setProperty('--sx', EO3(P(lt, 1.2, 1.6)));
    el.turnChips.forEach((c, i) => {
      const p = EO3(P(lt, 1.4 + i * .14, 1.7 + i * .14));
      c.style.opacity = p;
      c.style.transform = `translateX(${(1 - p) * 26}px)`;
    });
  }

  /* ---------- 7 reveal ---------- */
  function animReveal(lt) {
    el.revealLines.forEach((l, i) => maskIn(l, lt, .18 + i * .2, .8));
    const rk = $('.rk');
    rk.style.opacity = P(lt, .05, .3);
    const sp = EO3(P(lt, .8, 1.3));
    el.rsub.style.opacity = sp;
    el.rsub.style.transform = `translateY(${(1 - sp) * 22}px)`;
    const dp = EO3(P(lt, 1.3, 1.85));
    el.rdesc.style.opacity = dp * .9;
    el.rdesc.style.transform = `translateY(${(1 - dp) * 16}px)`;
    el.revealChips.forEach((c, i) => {
      const p = EO3(P(lt, 2.0 + i * .1, 2.3 + i * .1));
      c.style.opacity = p;
      c.style.transform = `translateY(${(1 - p) * 12}px)`;
    });

    const entrance = [
      { from: [-340, -70, -10], until: 1.15 },
      { from: [320, -90, 10], until: 1.3 },
      { from: [300, 140, 7], until: 1.45 },
    ];
    el.src.forEach((c, i) => {
      const p = EO5(P(lt, .28 + i * .13, entrance[i].until));
      const merge = EIO(P(lt, 1.15 + i * .05, 1.78 + i * .05));
      const to = [[510, 400], [-450, 400], [-360, -380]][i];
      const x = mix(entrance[i].from[0], 0, p) + to[0] * merge;
      const y = mix(entrance[i].from[1], 0, p) + to[1] * merge;
      const r = mix(entrance[i].from[2], 0, p) + (i - 1) * 4 * merge;
      const sc = mix(.94, 1, p) * (1 - .12 * merge);
      c.style.opacity = p * (1 - merge);
      c.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${sc})`;
      c.style.zIndex = 3 - i;
    });

    const fp = P(lt, 1.2, 1.98), fe = EO5(fp);
    const fy = Math.sin((lt - 2.6) * 1.05) * 4;
    el.revealFrame.style.opacity = fp;
    el.revealFrame.style.transform = `perspective(1700px) rotateX(${mix(11, 0, fe)}deg) rotateY(${mix(-8, 0, fe)}deg) translateY(${mix(60, 0, fe) + fy}px) scale(${mix(.93, 1, fe)})`;
    el.revealZoom.style.transform = `scale(${mix(1.02, 1.09, P(lt, 2.1, 6.4))})`;
    el.revealBadge.style.opacity = P(lt, 2.0, 2.4);
    el.revealBadge.style.transform = `translateY(${(1 - EO3(P(lt, 2.0, 2.4))) * 10}px)`;
  }

  /* ---------- 8 feat1 ---------- */
  function animFeat1(lt) {
    $('.f-idx', $('#sc-feat1')).style.opacity = P(lt, .05, .3);
    maskIn($('#sc-feat1 .f-copy h2 .line:nth-child(1)'), lt, .12, .7);
    maskIn($('#sc-feat1 .f-copy h2 .line:nth-child(2)'), lt, .34, .7);
    const sub = $('#sc-feat1 .fsub'); const sp = EO3(P(lt, .75, 1.25));
    sub.style.opacity = sp; sub.style.transform = `translateY(${(1 - sp) * 18}px)`;

    const p = EO5(P(lt, .18, .95));
    el.f1Frame.style.opacity = p;
    el.f1Frame.style.transform = `translateX(${(1 - p) * 90}px) rotate(${(1 - p) * 2.2}deg) scale(${mix(.96, 1, p)})`;
    el.f1Zoom.style.transform = `scale(${mix(1.06, 1.21, P(lt, .6, 3.1))})`;

    const np = P(lt, .45, 1.65);
    el.creditNum.textContent = Math.round(103 * EO3(np));
    el.creditNum.style.opacity = P(lt, .35, .6);
    el.creditBar.style.width = `${84 * EO3(P(lt, .9, 2.0))}%`;
    el.f1hl.style.opacity = P(lt, 1.25, 1.6) * (.66 + .34 * Math.sin(lt * 3.2));
  }

  /* ---------- 9 feat2 ---------- */
  function animFeat2(lt) {
    $('.f-idx', $('#sc-feat2')).style.opacity = P(lt, .05, .3);
    maskIn($('#sc-feat2 .f-copy h2 .line:nth-child(1)'), lt, .1, .7);
    maskIn($('#sc-feat2 .f-copy h2 .line:nth-child(2)'), lt, .32, .7);
    const sub = $('#sc-feat2 .fsub'); const sp = EO3(P(lt, .7, 1.2));
    sub.style.opacity = sp; sub.style.transform = `translateY(${(1 - sp) * 18}px)`;

    const p = EO5(P(lt, .15, .92));
    el.f2Frame.style.opacity = p;
    el.f2Frame.style.transform = `translateX(${(1 - p) * -90}px) rotate(${(1 - p) * -2}deg) scale(${mix(.96, 1, p)})`;
    el.f2Zoom.style.transform = `scale(1.0)`;

    const hp = P(lt, 1.0, 1.3);
    el.f2hl.style.opacity = hp * (.7 + .3 * Math.sin(lt * 4.2));
    el.f2scan.style.top = `${mix(21, 31, P(lt, 1.2, 2.3))}%`;
    el.f2scan.style.opacity = P(lt, 1.05, 1.2) * (1 - P(lt, 2.25, 2.45)) * .9;

    const dp = EBACK(P(lt, 1.1, 1.55));
    el.f2detail.style.opacity = P(lt, 1.1, 1.4);
    el.f2detail.style.transform = `translateY(${mix(34, 0, dp)}px) scale(${mix(.94, 1, dp)}) rotate(${(1 - dp) * -1.5}deg)`;

    const cp = EBACK(P(lt, 1.25, 1.65));
    const pill = $('.confpill');
    pill.style.opacity = P(lt, 1.15, 1.4);
    pill.style.transform = `scale(${mix(.85, 1, cp)})`;
    el.f2chips.forEach((c, i) => {
      const q = EBACK(P(lt, 1.55 + i * .11, 1.85 + i * .11));
      c.style.opacity = P(lt, 1.5 + i * .11, 1.72 + i * .11);
      c.style.transform = `translateY(${mix(14, 0, q)}px)`;
    });
  }

  /* ---------- 10 feat3 ---------- */
  function animFeat3(lt) {
    maskIn($('#sc-feat3 .f3head h2 .line:nth-child(1)'), lt, .08, .7);
    maskIn($('#sc-feat3 .f3head h2 .line:nth-child(2)'), lt, .3, .7);
    const sub = $('#sc-feat3 .fsub'); const sp = EO3(P(lt, .55, 1.0));
    sub.style.opacity = sp; sub.style.transform = `translateY(${(1 - sp) * 14}px)`;
    $('.f-idx', $('#sc-feat3')).style.opacity = P(lt, .02, .25);

    const p = EO5(P(lt, .22, 1.0));
    el.f3Frame.style.opacity = p;
    el.f3Frame.style.transform = `perspective(1900px) translateY(${mix(110, 0, p)}px) rotateX(${mix(6, 0, p)}deg) scale(${mix(.96, 1, p)})`;
    el.f3Zoom.style.transform = `scale(${mix(1.0, 1.045, P(lt, .8, 3.6))})`;
    el.vsbadge.style.opacity = P(lt, 1.0, 1.25);
    el.vsbadge.style.transform = `translate(-50%,-50%) scale(${mix(.6, 1, EBACK(P(lt, 1.0, 1.4)))}) rotate(${Math.sin(lt * 2) * 2}deg)`;
    el.metrics.forEach((m, i) => {
      const q = EBACK(P(lt, 1.25 + i * .17, 1.62 + i * .17));
      m.style.opacity = P(lt, 1.2 + i * .17, 1.42 + i * .17);
      m.style.transform = `translateY(${mix(24, 0, q)}px)`;
    });
  }

  /* ---------- 11 delight ---------- */
  let delightState = '';
  function animDelight(lt) {
    $('.f-idx', $('#sc-delight')).style.opacity = P(lt, .02, .25);
    maskIn($('#sc-delight .f-copy h2 .line:nth-child(1)'), lt, .1, .7);
    maskIn($('#sc-delight .f-copy h2 .line:nth-child(2)'), lt, .3, .7);
    const sub = $('#sc-delight .fsub'); const sp = EO3(P(lt, .65, 1.1));
    sub.style.opacity = sp; sub.style.transform = `translateY(${(1 - sp) * 14}px)`;

    const mp = EO5(P(lt, .12, .9));
    el.mock.style.opacity = mp;
    el.mock.style.transform = `translateX(${(1 - mp) * 80}px) scale(${mix(.97, 1, mp)})`;

    const dp = P(lt, .35, .8) * (1 - P(lt, 1.56, 1.82));
    el.drop.style.opacity = dp;
    el.drop.style.transform = `scale(${mix(.9, 1 + Math.sin(lt * 5) * .015, dp)})`;

    const move = EIO(P(lt, .55, 1.42));
    const dx = mix(0, 440, move);
    const dy = mix(0, 104, move);
    el.dragcard.style.opacity = P(lt, .15, .35) * (1 - P(lt, 1.42, 1.5)) + P(lt, 2.55, 2.8) * .0;
    el.dragcard.style.transform = `translate(${dx}px,${dy}px) scale(${mix(1, .72, move)}) rotate(${mix(-2, 2.5, move)}deg)`;
    el.dragcard.style.boxShadow = `0 ${mix(20, 44, move)}px ${mix(40, 80, move)}px rgba(45,28,95,${mix(.18, .32, move)})`;

    const ns = EBACK(P(lt, 1.46, 1.78));
    el.newSlot.style.opacity = P(lt, 1.44, 1.55) * (1 - P(lt, 2.42, 2.56));
    el.newSlot.style.transform = `scale(${mix(.6, 1, ns)})`;

    const tp = P(lt, 1.58, 1.85);
    el.toast.style.opacity = tp;
    el.toast.style.transform = `translateY(${(1 - EO3(tp)) * 16}px)`;
    const state = lt > 2.5 ? 'undo' : 'add';
    if (state !== delightState) {
      delightState = state;
      if (state === 'add') {
        el.toastText.textContent = '已加入方案 A';
        el.toast.querySelector('.ok').textContent = '✓';
        el.toast.querySelector('.ok').style.background = '#14795a';
      } else {
        el.toastText.textContent = '已撤销 · 恢复原方案';
        el.toast.querySelector('.ok').textContent = '↺';
        el.toast.querySelector('.ok').style.background = '#9a5b06';
      }
    }
    el.undoChip.style.opacity = P(lt, 2.45, 2.7);
    el.undoChip.textContent = lt > 2.5 ? 'UNDO STACK · 1 / ∞  ·  刚刚撤销' : 'UNDO STACK · 0 / ∞';
  }

  /* ---------- 12 payoff ---------- */
  let clockState = '';
  function animPayoff(lt) {
    const dawn = EIO(P(lt, .7, 2.05));
    el.dawn.style.opacity = dawn;
    el.moon.style.opacity = 1 - P(lt, .55, 1.25);
    el.moon.style.transform = `translateY(${-P(lt, .55, 1.5) * 40}px)`;
    const op = P(lt, .8, 2.0);
    el.orb.style.opacity = op * .95;
    el.orb.style.transform = `translateY(${(1 - EO3(op)) * 110}px) scale(${mix(.85, 1, EO3(op))})`;
    el.clockbig.style.opacity = 1 - P(lt, 1.45, 2.0);
    clockState = lt > 1.9 ? 'done' : 'night';
    if (clockState === 'done' && !el.clockbig.dataset.done) {
      el.clockbig.innerHTML = '23:00<small>已排完 · 去睡觉</small>';
      el.clockbig.dataset.done = '1';
    } else if (clockState === 'night' && el.clockbig.dataset.done) {
      el.clockbig.innerHTML = '01:47<small>还在排课</small>';
      delete el.clockbig.dataset.done;
    }
    const warm = P(lt, .8, 1.75);
    el.paycopy.querySelectorAll('h2, .ps').forEach(n => { n.style.color = mixC('#f8f3e9', '#17161a', warm); });
    el.paycopy.querySelector('.warm').style.color = mixC('#f3c98b', '#b45309', warm);
    el.payLines.forEach((l, i) => maskIn(l, lt, .12 + i * .55, .8));
    const ps = EO3(P(lt, 2.15, 2.7));
    el.paySub.style.opacity = ps * .9;
    el.paySub.style.transform = `translateY(${(1 - ps) * 16}px)`;
    if (el.desk) el.desk.style.opacity = (1 - P(lt, 1.8, 2.8)) * .9;
    el.paycopy.querySelector('.pk').style.opacity = P(lt, .05, .35) * .65;
    const payLab = $('#sc-payoff .stage-label');
    payLab.style.color = mixC('#f5f4f0', '#17161a', warm);
    payLab.style.opacity = '.55';
  }

  /* ---------- 13 cta ---------- */
  function animCta(lt) {
    const lp = EBACK(P(lt, .04, .5));
    el.ctaLogo.style.opacity = P(lt, .02, .16);
    el.ctaLogo.style.transform = `scale(${mix(.5, 1, lp)}) rotate(${mix(-12, 0, lp)}deg)`;
    maskIn(el.ctaName, lt, .25, .65);
    fadeIn(el.ctaTag, lt, .26, .5, 22);
    el.ctaLine.style.width = `${EO3(P(lt, 1.2, 1.8)) * 520}px`;
    const dp = EO3(P(lt, 1.3, 1.8));
    el.ctaDesc.style.opacity = dp;
    el.ctaDesc.style.transform = `translateY(${(1 - dp) * 14}px)`;
    el.ctaChips.forEach((c, i) => {
      const p = EO3(P(lt, 1.55 + i * .09, 1.85 + i * .09));
      c.style.opacity = p;
      c.style.transform = `translateY(${(1 - p) * 12}px)`;
    });
    el.ctaFoot.style.opacity = P(lt, 2.0, 2.5) * .9;
    el.ctaTag.style.transform = `translateY(${-P(lt, 3.2, 4.8) * 4}px)`;
    $('.cta-grid').style.opacity = .2 + .08 * Math.sin(lt * 1.2);
  }

  /* ---------------- master ---------------- */
  function applyFrame(t) {
    t = clamp(t, 0, TL.duration);
    const scene = TL.scenes.find(s => t >= s.start && t < s.end)
      || (t < TL.scenes[0].start ? TL.scenes[0] : TL.scenes[TL.scenes.length - 1]);
    activate(scene.key);
    setLook(scene.key);
    const lt = t - scene.start;
    switch (scene.key) {
      case 'hook': animHook(lt); break;
      case 'pain1': animPain1(lt); break;
      case 'pain2': animPain2(lt); break;
      case 'pain3': animPain3(lt); break;
      case 'pain4': animPain4(lt); break;
      case 'turn': animTurn(lt); break;
      case 'reveal': animReveal(lt); break;
      case 'feat1': animFeat1(lt); break;
      case 'feat2': animFeat2(lt); break;
      case 'feat3': animFeat3(lt); break;
      case 'delight': animDelight(lt); break;
      case 'payoff': animPayoff(lt); break;
      case 'cta': animCta(lt); break;
    }
    globalFx(t);
  }

  window.applyFrame = applyFrame;

  const imgs = $$('img').map(im => im.complete ? Promise.resolve() : new Promise(r => { im.onload = im.onerror = r; }));
  window.__ready = (async () => {
    await document.fonts.ready;
    await Promise.all(imgs);
    applyFrame(0.3);
  })();

  if (new URLSearchParams(location.search).has('play')) {
    window.__ready.then(() => {
      const t0 = performance.now();
      const loop = now => {
        const t = ((now - t0) / 1000) % TL.duration;
        applyFrame(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }
})();
