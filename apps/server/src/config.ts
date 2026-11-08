/**
 * 服务端配置。全部可用环境变量覆盖，方便在不同机器/演示环境切换。
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',

  /** 数据目录：JSON 存储与原始快照都放在这里，已被 .gitignore 排除 */
  dataDir: process.env.DATA_DIR ?? join(appRoot, 'data'),

  /** 允许的前端来源（开发时 Vite 默认 5173） */
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',

  /** 演示模式：不连接 ehall，只用内置脱敏数据 */
  demoMode: bool(process.env.DEMO_MODE, true),

  /** 开发工具（探针、原始快照导出）是否开启 */
  devTools: bool(process.env.DEV_TOOLS, true),

  /** 会话有效期（秒）。教务会话本身通常 30 分钟无操作过期。 */
  sessionTtl: Number(process.env.SESSION_TTL ?? 1800),

  /** 学期学分上限 */
  creditCap: Number(process.env.CREDIT_CAP ?? 30),

  ehall: {
    casBase: 'https://authserver.nju.edu.cn',
    portalBase: 'https://ehall.nju.edu.cn',
    appBase: 'https://ehallapp.nju.edu.cn',
    /** 只允许访问这些域，防止被当成通用代理（SSRF） */
    allowedHosts: ['ehall.nju.edu.cn', 'ehallapp.nju.edu.cn', 'authserver.nju.edu.cn'],
  },
} as const;

export type AppConfig = typeof config;
