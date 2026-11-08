/**
 * ehall 真实接口探针（命令行版）。
 *
 * 前置：用户在受控 Edge 里登录 ehall，然后
 *   node scripts/edge-cookies.mjs --domain nju.edu.cn --out data/cookies.json
 *
 * 常用命令：
 *   node scripts/ehall-probe.mjs --discover                # 从应用前端 JS 里挖 module/method
 *   node scripts/ehall-probe.mjs --call kcbcx xskbcx queryXskbcx
 *   node scripts/ehall-probe.mjs --get "https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do"
 *
 * 成功的响应会写入 data/raw/，后续字段映射直接对着快照做，不必重复请求。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const dataDir = join(appRoot, 'data');
const rawDir = join(dataDir, 'raw');
const cookiesFile = join(dataDir, 'cookies.json');

const APPS = [
  { key: 'timetable', appId: 'kcbcx', url: 'https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do' },
  { key: 'program', appId: 'qxfacx', url: 'https://ehallapp.nju.edu.cn/jwapp/sys/qxfacx/*default/index.do' },
  { key: 'warning', appId: 'xyyj', url: 'https://ehallapp.nju.edu.cn/jwapp/sys/xyyj/*default/index.do' },
  { key: 'transcript', appId: 'cjcx', url: 'https://ehallapp.nju.edu.cn/jwapp/sys/cjcx/*default/index.do' },
  { key: 'catalog', appId: 'kckcx', url: 'https://ehallapp.nju.edu.cn/jwapp/sys/kckcx/*default/index.do' },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const has = (name) => process.argv.includes(name);

async function loadCookieHeader() {
  try {
    const parsed = JSON.parse(await readFile(cookiesFile, 'utf8'));
    const nju = parsed.cookies.filter((cookie) => cookie.domain.includes('nju.edu.cn'));
    if (nju.length === 0) throw new Error('cookies.json 中没有 nju.edu.cn 的 cookie');
    return nju.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  } catch (error) {
    console.error(`❌ 读取 ${cookiesFile} 失败：${error.message}`);
    console.error('   先运行：node scripts/edge-cookies.mjs --domain nju.edu.cn --out data/cookies.json');
    process.exit(1);
  }
}

async function request(url, options = {}) {
  const cookie = await loadCookieHeader();
  const response = await fetch(url, {
    ...options,
    redirect: options.redirect ?? 'follow',
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Cookie: cookie,
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  return { response, text, url };
}

function saveRaw(kind, payload, url) {
  const file = join(rawDir, `probe-${Date.now()}-${kind}.json`);
  return mkdir(rawDir, { recursive: true })
    .then(() => writeFile(file, JSON.stringify({ capturedAt: new Date().toISOString(), url, payload }, null, 2), 'utf8'))
    .then(() => file);
}

function extractRows(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const key of ['rows', 'list', 'items', 'records', 'datas', 'data', 'result']) {
    if (key in json) {
      const rows = extractRows(json[key]);
      if (rows.length) return rows;
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */

async function discover() {
  for (const app of APPS) {
    console.log(`\n=== ${app.appId} (${app.url})`);
    let page;
    try {
      page = await request(app.url);
    } catch (error) {
      console.log(`  ❌ 打开失败：${error.message}`);
      continue;
    }
    console.log(`  page: ${page.response.status} ${page.url.slice(0, 120)} len=${page.text.length}`);
    if (page.text.includes('统一身份认证') || page.url.includes('authserver')) {
      console.log('  ⚠️ 会话失效，需要重新登录');
      continue;
    }

    const scripts = [...page.text.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
    const inline = [...page.text.matchAll(/modules\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\.do/gi)].map(
      (m) => `${m[1]}/${m[2]}`,
    );
    console.log(`  scripts: ${scripts.length}, inline endpoints: ${[...new Set(inline)].join(', ') || '无'}`);

    const found = new Set(inline);
    for (const src of scripts.slice(0, 12)) {
      const absolute = new URL(src, app.url).toString();
      try {
        const js = await request(absolute);
        const matches = [...js.text.matchAll(/modules\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\.do/gi)];
        for (const match of matches) found.add(`${match[1]}/${match[2]}`);
        const methods = [...js.text.matchAll(/(?:query|get|load|list)[A-Z][A-Za-z0-9_]{2,30}/g)].map((m) => m[0]);
        if (methods.length > 0) {
          console.log(`  ${src.slice(0, 80)}: methods≈${[...new Set(methods)].slice(0, 25).join(', ')}`);
        }
      } catch {
        /* 单个脚本失败不影响整体 */
      }
    }
    if (found.size > 0) {
      console.log(`  ✅ 发现接口：${[...found].join(', ')}`);
      await saveRaw(`${app.appId}-discover`, { endpoints: [...found], scripts }, app.url);
    }
  }
}

async function call() {
  const base = process.argv.indexOf('--call') + 1;
  const appId = process.argv[base];
  const moduleName = process.argv[base + 1];
  const method = process.argv[base + 2];
  if (!appId || !moduleName || !method) {
    console.error('用法：node scripts/ehall-probe.mjs --call <appId> <module> <method> [--param json]');
    process.exit(1);
  }
  const url = `https://ehallapp.nju.edu.cn/jwapp/sys/${appId}/modules/${moduleName}/${method}.do`;
  const param = arg('--param');
  const form = new URLSearchParams(arg('--form', '') ?? '');
  if (param) form.set('param', param);
  if (!form.has('pageSize')) form.set('pageSize', String(arg('--pageSize', '200')));
  if (!form.has('pageNumber')) form.set('pageNumber', '1');

  const result = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: form.toString(),
  });

  console.log(`POST ${url}`);
  console.log(`status: ${result.response.status}  len=${result.text.length}`);
  if (result.text.includes('统一身份认证') || result.url.includes('authserver')) {
    console.log('⚠️ 会话失效');
    return;
  }
  let json;
  try {
    json = JSON.parse(result.text);
  } catch {
    console.log('⚠️ 不是 JSON，前 300 字：', result.text.slice(0, 300));
    return;
  }
  const rows = extractRows(json);
  console.log(`rows: ${rows.length}`);
  console.log(`top keys: ${Object.keys(json).join(', ')}`);
  if (rows[0]) console.log(`row keys: ${Object.keys(rows[0]).join(', ')}`);
  if (rows[0]) console.log('row[0]:', JSON.stringify(rows[0]).slice(0, 700));
  const file = await saveRaw(`${appId}-${moduleName}-${method}`, json, url);
  console.log(`saved: ${file}`);
}

async function get() {
  const url = process.argv[2];
  if (!url) {
    console.error('用法：node scripts/ehall-probe.mjs --get <url>');
    process.exit(1);
  }
  const result = await request(url);
  console.log(`status: ${result.response.status} len=${result.text.length}`);
  console.log(result.text.slice(0, 1200));
}

const mode = has('--discover') ? discover : has('--call') ? call : has('--get') ? get : null;
if (!mode) {
  console.log('用法：--discover | --call <appId> <module> <method> | --get <url>');
  process.exit(0);
}
await mode();
