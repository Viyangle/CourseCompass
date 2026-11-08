/**
 * ehall 应用登记表。
 *
 * 用户给的三个入口对应三个「应用」：
 *   qxfacx  本科人才培养方案查询   #/pyfacx
 *   kcbcx   本科课表查询           #/qxkcb
 *   xyyj    学业预警               #/xsxyyjjg
 *
 * ⚠️ 关键事实：ehall 的页面地址（index.do#/route）与数据接口（modules/xx/yy.do）是两套东西。
 * 页面路由名不代表接口名，模块名与参数必须登录后从浏览器 Network 面板确认。
 * 因此这里把「应用」与「候选接口」分开：应用信息是确定的，接口信息标记 verified=false，
 * 由「探针」在真实会话下逐个尝试，成功的结果回写到 data/endpoints.json。
 *
 * 这样做的好处：产品代码不依赖猜测的接口；换学期/改版时只需要重跑探针。
 */

import type { SourceKind } from '@planner/shared';

export interface EhallEndpointCandidate {
  module: string;
  method: string;
  /** 该候选的来历，例如"来自 2024 级学生的 Network 抓包" */
  origin?: string;
}

export interface EhallAppDef {
  key: SourceKind;
  appId: string;
  label: string;
  /** ehall 页面入口（用户可以在浏览器里打开核对） */
  pageUrl: string;
  /** 一类应用可能有多个数据接口（例如培养方案要分「方案列表」和「要求明细」两次请求） */
  endpoints: EhallEndpointCandidate[];
  verified: boolean;
  /** 需要按学期过滤的接口，参数名 */
  termParam?: string;
}

export const EHALL_APPS: EhallAppDef[] = [
  {
    key: 'program',
    appId: 'qxfacx',
    label: '本科人才培养方案查询',
    pageUrl:
      'https://ehallapp.nju.edu.cn/jwapp/sys/qxfacx/*default/index.do?EMAP_LANG=zh&THEME=magenta#/pyfacx',
    endpoints: [
      { module: 'pyfacx', method: 'queryPyfacx', origin: '待探针确认' },
      { module: 'pyfacx', method: 'queryStudentPyfa', origin: '待探针确认' },
    ],
    verified: false,
  },
  {
    key: 'timetable',
    appId: 'kcbcx',
    label: '本科课表查询',
    pageUrl:
      'https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do?EMAP_LANG=zh&THEME=magenta#/qxkcb',
    endpoints: [
      { module: 'xskbcx', method: 'queryXskbcx', origin: '待探针确认' },
      { module: 'kbcx', method: 'queryKbcx', origin: '待探针确认' },
    ],
    verified: false,
    termParam: 'XNXQDM',
  },
  {
    key: 'warning',
    appId: 'xyyj',
    label: '学业预警',
    pageUrl:
      'https://ehallapp.nju.edu.cn/jwapp/sys/xyyj/*default/index.do?EMAP_LANG=zh&THEME=magenta#/xsxyyjjg',
    endpoints: [{ module: 'xsxyyjjg', method: 'queryXsxyyjjg', origin: '待探针确认' }],
    verified: false,
  },
  {
    key: 'transcript',
    appId: 'cjcx',
    label: '成绩查询',
    pageUrl: 'https://ehallapp.nju.edu.cn/jwapp/sys/cjcx/*default/index.do#/xscjcx',
    endpoints: [
      { module: 'xscjcx', method: 'queryXscjcx', origin: '待探针确认' },
      { module: 'cjcx', method: 'queryCjcx', origin: '待探针确认' },
    ],
    verified: false,
  },
  {
    key: 'catalog',
    appId: 'kckcx',
    label: '课程库 / 开课查询',
    pageUrl: 'https://ehallapp.nju.edu.cn/jwapp/sys/kckcx/*default/index.do#/kckcx',
    endpoints: [
      { module: 'kckcx', method: 'queryKckcx', origin: '待探针确认' },
      { module: 'kkcx', method: 'queryKkcx', origin: '待探针确认' },
    ],
    verified: false,
    termParam: 'XNXQDM',
  },
];

export function findApp(key: SourceKind): EhallAppDef | undefined {
  return EHALL_APPS.find((app) => app.key === key);
}

/** 页面里用到的说明文案，直接展示在「数据来源」设置页。 */
export const PROBE_GUIDE = [
  '在浏览器里登录 ehall，打开对应应用页面。',
  '按 F12 打开 Network，筛 Fetch/XHR，操作一次页面（如切换学期、点查询）。',
  '找到返回 JSON 的请求，右键 → Copy as cURL，粘贴到「设置 → 数据来源 → 添加接口」。',
  '系统会保存原始响应快照，并据此生成字段映射，不需要重复登录。',
].join('\n');
