import { chromium } from 'playwright-core';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edge, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERR', m.text()); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

if (await page.getByText('进入演示模式').count()) {
  await page.getByText('进入演示模式').click();
  await page.waitForURL('http://127.0.0.1:5173/', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
}
await page.evaluate(() => document.fonts.ready);
console.log('URL', page.url());

const shots = [
  ['overview', '/'],
  ['program', '/program'],
  ['planner', '/planner'],
  ['courses', '/courses'],
  ['compare', '/compare'],
];
for (const [name, path] of shots) {
  await page.goto('http://127.0.0.1:5173' + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `shots/${name}.png` });
  console.log('shot', name);
}
await browser.close();
