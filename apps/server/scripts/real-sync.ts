/**
 * 真实数据同步（命令行版）。
 *
 * 前置：受控 Edge 已登录 ehall，且已导出 Cookie：
 *   node scripts/edge-cookies.mjs --domain nju.edu.cn --out data/cookies.json
 *
 * 运行：
 *   pnpm --filter @planner/server sync:real
 *   pnpm --filter @planner/server sync:real -- 2026-2027-2   # 指定规划学期
 *
 * 行为：
 * - 抓取五类数据 → 映射为本地库 → 覆盖 apps/server/data/db.json
 * - 首次覆盖前会把原库备份为 db.demo.json
 * - 原始数据保存为 data/raw/real-bundle.json，便于复盘与重放
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNjuBundle, mapBundleToDb } from '../src/import/nju.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const dbFile = join(dataDir, 'db.json');
const rawDir = join(dataDir, 'raw');

const requestedTerm = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : undefined;

const cookieFile = join(dataDir, 'cookies.json');
if (!existsSync(cookieFile)) {
  console.error('❌ 缺少 data/cookies.json。先在受控 Edge 登录 ehall，然后运行：');
  console.error('   node scripts/edge-cookies.mjs --domain nju.edu.cn --out data/cookies.json');
  process.exit(1);
}

const parsed = JSON.parse(await readFile(cookieFile, 'utf8'));
const cookie = parsed.cookies
  .filter((item: { domain: string }) => item.domain.includes('nju.edu.cn'))
  .map((item: { name: string; value: string }) => `${item.name}=${item.value}`)
  .join('; ');

if (!cookie.includes('JSESSIONID') && !cookie.includes('MOD_AUTH_CAS')) {
  console.error('❌ Cookie 中看不到会话字段，可能登录已失效，请重新登录后再导出。');
  process.exit(1);
}

console.log('1/3 抓取数据…');
const started = Date.now();
const bundle = await fetchNjuBundle(cookie, requestedTerm);

console.log('2/3 映射为本地模型…');
const db = mapBundleToDb(bundle);

await mkdir(rawDir, { recursive: true });
await writeFile(join(rawDir, 'real-bundle.json'), JSON.stringify(bundle, null, 2), 'utf8');

if (existsSync(dbFile)) {
  await copyFile(dbFile, join(dataDir, 'db.demo.json'));
}
await writeFile(dbFile, JSON.stringify(db, null, 2), 'utf8');

console.log('3/3 完成');
console.log('---');
const masked = db.profile.studentId ? `${db.profile.studentId.slice(0, 4)}****` : '(未知)';
console.log(`学生：${db.profile.name} (${masked}) · ${db.profile.college} · ${db.profile.major} ${db.profile.gradeYear}级`);
console.log(`培养方案：${db.program.name}（${db.program.totalCredits} 学分）`);
for (const module of db.program.modules) console.log(`  - ${module.name}: ${module.requiredCredits} 学分`);
console.log(`成绩记录：${db.transcript.filter((r) => r.status === 'passed').length} 门通过 / ${db.transcript.length} 条`);
console.log(`课程：${db.courses.length} 门；教学班：${db.sections.length} 个`);
console.log(`课表：${db.sources.find((s) => s.kind === 'timetable')?.detail}`);
console.log(`学期：current=${db.settings.currentTermId} planning=${db.settings.planningTermId}`);
if (bundle.errors.length > 0) {
  console.log('⚠️ 部分数据抓取失败：');
  for (const error of bundle.errors) console.log('  -', error);
}
console.log(`耗时 ${((Date.now() - started) / 1000).toFixed(1)}s，已写入 ${dbFile}`);
console.log('提示：如果后端正在运行，它内存里仍是旧数据，请重启后端（或改用界面上的「同步全部」）。');
