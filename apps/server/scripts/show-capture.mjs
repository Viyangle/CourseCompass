/**
 * 查看 CDP 抓包结果：打印每个请求的地址、请求体、行数与样例行。
 *
 *   node scripts/show-capture.mjs data/raw/capture-wdkb.json [样例行数]
 *   node scripts/show-capture.mjs data/raw/capture-wdkb.json --filter cxxskclb
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(resolve(here, '..'), 'data', 'raw');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

let file = argv[0];
if (!file || file.startsWith('--')) {
  const files = (await readdir(rawDir).catch(() => [])).filter((name) => name.startsWith('capture-')).sort();
  console.log('现有抓包文件：');
  for (const name of files.slice(-20)) console.log('  data/raw/' + name);
  process.exit(0);
}
if (!file.includes('/') && !file.includes('\\')) file = join('data/raw', file);

const limit = Number(arg('--rows', '2'));
const filter = arg('--filter', '');

const parsed = JSON.parse(await readFile(file, 'utf8'));
const requests = (parsed.requests ?? []).filter((item) => !filter || item.url.includes(filter));

function truncate(value, max = 120) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}…` : String(text);
}

for (const request of requests) {
  console.log('\n============================================================');
  console.log(`${request.method} ${request.url.replace('https://ehallapp.nju.edu.cn', '')}`);
  if (request.postData) console.log(`body: ${String(request.postData).slice(0, 400)}`);
  console.log(`${request.status} ${request.bytes} bytes`);

  let json;
  try {
    json = JSON.parse(request.body ?? '');
  } catch {
    console.log('(非 JSON)');
    continue;
  }
  console.log(`顶层字段: ${Object.keys(json ?? {}).join(', ')}`);

  let rows = [];
  const walk = (node, depth = 0) => {
    if (depth > 4 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length > 0 && typeof node[0] === 'object') {
        rows = node;
        return;
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        console.log(`  数组 ${key}: ${value.length} 条`);
        if (rows.length === 0) rows = value;
      } else if (value && typeof value === 'object') {
        walk(value, depth + 1);
      }
    }
  };
  walk(json);

  if (rows.length) {
    console.log(`行字段: ${Object.keys(rows[0]).join(', ')}`);
    for (let i = 0; i < Math.min(limit, rows.length); i += 1) {
      console.log(`\n--- row[${i}] ---`);
      for (const [key, value] of Object.entries(rows[i])) {
        if (value === null || value === '') continue;
        console.log(`  ${key}: ${truncate(value)}`);
      }
    }
  }
}
