/**
 * 查看原始快照：只打印结构，不糊屏。
 *
 *   node scripts/show-raw.mjs data/raw/probe-xxx.json [行数]
 *
 * 输出：顶层字段、行数、行字段名、前 N 行（长字符串截断到 160 字）。
 * 用于写字段映射时快速确认命名与取值形态。
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(resolve(here, '..'), 'data', 'raw');

function truncate(value, max = 160) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['rows', 'list', 'items', 'records', 'datas', 'data', 'result', 'endpoints']) {
    if (key in payload) {
      const rows = extractRows(payload[key]);
      if (rows.length > 0) return rows;
    }
  }
  return [];
}

let file = process.argv[2];
if (!file) {
  const files = (await readdir(rawDir).catch(() => [])).filter((name) => name.endsWith('.json')).sort();
  console.log('未指定文件。现有快照：');
  for (const name of files.slice(-20)) console.log('  data/raw/' + name);
  process.exit(0);
}
if (!file.startsWith('data/') && !file.includes('/') && !file.includes('\\')) file = join('data/raw', file);

const parsed = JSON.parse(await readFile(file, 'utf8'));
const rows = extractRows(parsed.payload ?? parsed);
const count = Number(process.argv[3] ?? 3);

console.log(`文件: ${file}`);
console.log(`抓取时间: ${parsed.capturedAt ?? '—'}`);
console.log(`来源: ${parsed.url ?? parsed.meta?.url ?? '—'}`);
console.log(`顶层字段: ${Object.keys(parsed.payload ?? parsed).join(', ')}`);
console.log(`解析到行数: ${rows.length}`);
if (rows[0]) {
  console.log(`行字段: ${Object.keys(rows[0]).join(', ')}`);
  for (let i = 0; i < Math.min(count, rows.length); i += 1) {
    console.log(`\n--- row[${i}] ---`);
    for (const [key, value] of Object.entries(rows[i])) {
      console.log(`  ${key}: ${truncate(value)}`);
    }
  }
}
