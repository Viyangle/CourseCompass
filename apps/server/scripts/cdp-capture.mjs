/**
 * 用 CDP 抓取 ehall 页面加载时的真实请求与响应（含 POST body）。
 *
 * 用途：ehall 的接口名和参数藏在前端 JS 与运行时里，靠猜不可靠。
 * 打开页面时把 Network 流量录下来，就能直接得到：
 *   POST /jwapp/sys/kcbcx/modules/qxkcb.do
 *   body: querySetting=[...]&...
 *   response: { code:"0", datas:{ rows:[...] } }
 *
 * 用法：
 *   node scripts/cdp-capture.mjs --url "https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do" \
 *        --seconds 8 --out data/raw/capture-kcbcx.json
 *
 * 前置：受控 Edge 已登录（端口 9333）。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PORT = process.env.DSH_EDGE_PORT ?? '9333';
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const targetUrl = arg('--url');
const seconds = Number(arg('--seconds', '8'));
const out = arg('--out');
const filter = arg('--filter', '/jwapp/');
const clickText = arg('--click-text');
const evaluate = arg('--eval');

if (!targetUrl) {
  console.error('用法：node scripts/cdp-capture.mjs --url <页面地址> [--seconds 8] [--out file]');
  process.exit(1);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve: res, reject: rej } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) rej(new Error(message.error.message));
        else res(message.result);
        return;
      }
      for (const handler of this.handlers) handler(message);
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(handler) {
    this.handlers.push(handler);
  }
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((item) => item.type === 'page');
if (!page) {
  console.error('没有可用的标签页');
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', () => res());
  ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')));
});
const cdp = new Cdp(ws);

const requests = new Map();
const captured = [];
const bodies = new Map();

cdp.on((message) => {
  if (message.method === 'Network.requestWillBeSent') {
    const { requestId, request, type, initiator } = message.params;
    requests.set(requestId, { url: request.url, method: request.method, postData: request.postData, type });
    void initiator;
  }
  if (message.method === 'Network.responseReceived') {
    const { requestId, response } = message.params;
    const entry = requests.get(requestId);
    if (entry) {
      entry.status = response.status;
      entry.mimeType = response.mimeType;
    }
  }
  if (message.method === 'Network.loadingFinished') {
    const { requestId } = message.params;
    const entry = requests.get(requestId);
    if (!entry) return;
    const isJson =
      (entry.mimeType ?? '').includes('json') || (entry.url ?? '').includes('.do');
    if (!isJson || entry.method === 'OPTIONS') return;
    cdp
      .send('Network.getResponseBody', { requestId })
      .then((result) => {
        if (result && typeof result.body === 'string') {
          bodies.set(requestId, result.body);
          captured.push({
            url: entry.url,
            method: entry.method,
            status: entry.status,
            postData: entry.postData,
            contentType: entry.mimeType,
            bytes: result.body.length,
            body: result.body.length > 400_000 ? result.body.slice(0, 400_000) : result.body,
          });
        }
      })
      .catch(() => undefined);
  }
});

await cdp.send('Network.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url: targetUrl });
await new Promise((res) => setTimeout(res, 3500));

if (clickText) {
  const script = `(() => {
    const nodes = [...document.querySelectorAll('button,a,span,div,input[type=button]')];
    const target = nodes.find((node) => (node.textContent || node.value || '').trim() === ${JSON.stringify(clickText)});
    if (!target) return 'not-found';
    target.click();
    return 'clicked';
  })()`;
  const result = await cdp.send('Runtime.evaluate', { expression: script, returnByValue: true });
  console.log(`click "${clickText}": ${result.result?.value}`);
}
if (evaluate) {
  const result = await cdp.send('Runtime.evaluate', { expression: evaluate, returnByValue: true, awaitPromise: true });
  console.log('eval:', JSON.stringify(result.result?.value).slice(0, 500));
}

await new Promise((res) => setTimeout(res, Math.max(1500, seconds * 1000 - 3500)));

const interesting = captured.filter((item) => item.url.includes(filter) || item.url.includes('/modules/'));
console.log(`共捕获 ${captured.length} 个 JSON 响应，其中 jwapp 相关 ${interesting.length} 个：\n`);
for (const item of interesting) {
  console.log(`● ${item.method} ${item.url.replace('https://ehallapp.nju.edu.cn', '')}`);
  if (item.postData) console.log(`  body: ${String(item.postData).slice(0, 300)}`);
  console.log(`  ${item.status} ${item.bytes} bytes`);
  const body = item.body ?? '';
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (parsed) {
    console.log(`  keys: ${Object.keys(parsed).join(', ')}`);
    const rows = JSON.stringify(parsed).match(/"rows":\[(.{0,200})/)?.[1];
    if (rows) console.log(`  rows: ${rows}…`);
  }
  console.log('');
}

if (out) {
  const file = resolve(out);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ capturedAt: new Date().toISOString(), page: targetUrl, requests: interesting }, null, 2),
    'utf8',
  );
  console.log(`已保存：${file}`);
}
ws.close();
