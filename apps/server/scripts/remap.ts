/**
 * 用已保存的原始数据重新映射（不重新抓取）。
 *
 * 改字段映射时用它，几十毫秒就能看到结果：
 *   pnpm --filter @planner/server remap
 *
 * 对应 bundle：data/raw/real-bundle.json（由 sync:real 保存）。
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapBundleToDb, type RawBundle } from '../src/import/nju.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

const bundle = JSON.parse(await readFile(join(dataDir, 'raw', 'real-bundle.json'), 'utf8')) as RawBundle;
const db = mapBundleToDb(bundle);
await writeFile(join(dataDir, 'db.json'), JSON.stringify(db, null, 2), 'utf8');

console.log(`已重新映射：${db.profile.major} · 课程 ${db.courses.length} · 教学班 ${db.sections.length} · 成绩 ${db.transcript.length}`);
console.log(`学期 current=${db.settings.currentTermId} planning=${db.settings.planningTermId}`);
console.log('提示：如果后端正在运行，请重启后端以加载新数据。');
