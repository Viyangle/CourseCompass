import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const fps = 30;
const outDir = path.resolve('frames/render');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) console.log('CONSOLE', m.text()); });
await page.goto('http://127.0.0.1:8010/index.html', { waitUntil: 'networkidle' });
await page.evaluate(() => window.__ready);

const duration = await page.evaluate(() => window.TL.duration);
const total = Math.ceil(duration * fps);
console.log('duration', duration, 'frames', total);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const t = i / fps;
  await page.evaluate(t => window.applyFrame(t), t);
  await page.screenshot({
    path: path.join(outDir, `f_${String(i).padStart(5, '0')}.jpg`),
    type: 'jpeg',
    quality: 95,
  });
  if (i % 150 === 0) {
    const el = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`frame ${i}/${total}  t=${t.toFixed(2)}  ${el}s`);
  }
}
console.log('done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await browser.close();
