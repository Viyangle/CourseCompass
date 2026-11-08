import { chromium } from 'playwright-core';
import fs from 'node:fs';

fs.mkdirSync('frames', { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8010/index.html', { waitUntil: 'networkidle' });
await page.evaluate(() => window.__ready);
const times = process.argv.slice(2).map(Number);
const list = times.length ? times : [2.6, 6.8, 10.8, 15.6, 19.6, 22.2, 23.6, 28.6, 34.2, 37.2, 40.6, 44.8, 48.2, 52.4];
for (const t of list) {
  await page.evaluate(t => window.applyFrame(t), t);
  await page.waitForTimeout(60);
  await page.screenshot({ path: `frames/preview_${t.toFixed(1)}.png` });
  console.log('frame', t);
}
console.log('duration', await page.evaluate(() => window.TL.duration));
await browser.close();
