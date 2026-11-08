/**
 * 从受控 Edge（CDP :9333）里导出 Cookie，供本地探针脚本使用。
 *
 * 为什么需要它：统一认证现在带滑块验证码，本项目不做验证码绕过；
 * 让用户在浏览器里正常登录一次，再把浏览器已有的会话 cookie 交给采集脚本，
 * 是一条既尊重边界、又不需要人工复制粘贴的路径。
 *
 * 用法：
 *   node scripts/edge-cookies.mjs --list                 # 只列出域名与 cookie 名
 *   node scripts/edge-cookies.mjs --domain nju.edu.cn --out data/cookies.json
 *
 * 导出的文件包含会话凭证，默认写入 apps/server/data/（已 gitignore）。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PORT = process.env.DSH_EDGE_PORT ?? '9333';
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const flags = new Set(args.filter((arg) => arg.startsWith('--')));

async function targets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!response.ok) throw new Error(`无法连接 Edge 调试端口 ${PORT}`);
  return response.json();
}

async function getAllCookies(wsUrl) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('读取 cookie 超时'));
    }, 10000);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else resolvePromise(message.result.cookies ?? []);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket 连接失败'));
    });
  });
}

try {
  const list = await targets();
  const page = list.find((item) => item.type === 'page') ?? list[0];
  if (!page) throw new Error('没有可用的标签页');

  const cookies = await getAllCookies(page.webSocketDebuggerUrl);
  const domain = getArg('--domain');
  const selected = domain ? cookies.filter((cookie) => cookie.domain.includes(domain)) : cookies;

  if (flags.has('--list') || !getArg('--out')) {
    const byDomain = new Map();
    for (const cookie of selected) {
      const names = byDomain.get(cookie.domain) ?? [];
      names.push(cookie.name);
      byDomain.set(cookie.domain, names);
    }
    for (const [host, names] of byDomain) console.log(`${host}: ${names.join(', ')}`);
    console.log(`\n共 ${selected.length} 个 cookie（当前标签页：${page.url}）`);
    process.exit(0);
  }

  const out = resolve(getArg('--out'));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ capturedAt: new Date().toISOString(), cookies: selected }, null, 2), 'utf8');
  console.log(`已写入 ${out}（${selected.length} 个 cookie）`);
} catch (error) {
  console.error('❌ ' + (error instanceof Error ? error.message : error));
  process.exit(1);
}
