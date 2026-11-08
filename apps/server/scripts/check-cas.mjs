/**
 * 统一认证可达性自检（不登录、不需要密码）。
 *
 * 用法：node scripts/check-cas.mjs
 *
 * 它会走一次「进入 ehall → 被 302 到 authserver」的链路，然后检查登录页里
 * execution / pwdEncryptSalt / captcha 是否存在。做真实接入前先跑这个，
 * 可以区分「网络不通」「页面改版」「加密字段缺失」三种情况。
 */

const PORTAL = 'https://ehall.nju.edu.cn/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function follow(url, maxHops = 6) {
  const hops = [];
  let current = url;
  for (let i = 0; i < maxHops; i += 1) {
    const started = Date.now();
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(15000),
    });
    hops.push({
      url: current,
      status: response.status,
      location: response.headers.get('location') ?? undefined,
      elapsed: Date.now() - started,
    });
    if (response.status >= 300 && response.status < 400) {
      current = new URL(response.headers.get('location'), current).toString();
      continue;
    }
    return { finalUrl: current, html: await response.text(), hops };
  }
  throw new Error('重定向次数过多');
}

function pick(html, re) {
  return re.exec(html)?.[1];
}

try {
  console.log('1) 打开网上办事大厅…');
  const entry = await follow(PORTAL);
  entry.hops.forEach((hop) => console.log(`   ${hop.status} ${hop.url}${hop.location ? ` → ${hop.location}` : ''}`));

  if (!entry.finalUrl.includes('authserver')) {
    console.log('\n⚠️  没有跳转到统一认证，可能已登录或服务异常。');
    process.exit(0);
  }

  console.log('\n2) 检查登录页字段…');
  const html = entry.html;
  const execution = pick(html, /name=["']execution["'][^>]*value=["']([^"']*)["']/i);
  const salt = pick(html, /id=["']pwdEncryptSalt["'][^>]*value=["']([^"']*)["']/i);
  const captcha = /name=["']captcha/i.test(html) || /验证码/.test(html);
  const action = pick(html, /<form[^>]*action=["']([^"']*)["']/i);

  console.log(`   execution:        ${execution ? `✅ ${execution.slice(0, 12)}…` : '❌ 未找到'}`);
  console.log(`   pwdEncryptSalt:   ${salt ? `✅ ${salt}` : '❌ 未找到（可能不需要密码加密）'}`);
  console.log(`   captcha:          ${captcha ? '⚠️ 页面出现验证码相关元素' : '✅ 未见'}`);
  console.log(`   form action:      ${action ?? '（同当前地址）'}`);
  console.log(`   service 参数:      ${new URL(entry.finalUrl).searchParams.get('service') ?? '（无）'}`);
  console.log(`   页面大小:          ${html.length} 字节`);

  const ok = Boolean(execution && salt);
  console.log(ok ? '\n✅ 可以用密码登录。' : '\n❌ 登录页结构与预期不同，需要先更新 parseCasLoginForm()。');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error('\n❌ 链路失败：', error instanceof Error ? error.message : error);
  console.error('   校外网络请先连校园 VPN；也可能是当前网络无法访问 authserver.nju.edu.cn。');
  process.exit(1);
}
