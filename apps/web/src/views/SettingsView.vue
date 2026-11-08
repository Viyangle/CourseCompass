<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatDateTime, formatRelativeTime, type SourceRecord } from '@planner/shared';
import { api } from '@/api/client';
import { useDataStore } from '@/stores/data';
import AppIcon from '@/components/AppIcon.vue';
import { toast } from '@/composables/toast';

const data = useDataStore();

const syncing = ref<string | null>(null);
const probeApp = ref('kcbcx');
const probeModule = ref('xskbcx');
const probeMethod = ref('queryXskbcx');
const probeResult = ref<string>('');
const probing = ref(false);

const modeLabel: Record<SourceRecord['mode'], string> = {
  ehall: 'ehall 接口',
  manual: '手动导入',
  mock: '演示数据',
};

async function syncAll() {
  syncing.value = 'all';
  try {
    const result = await api.sync();
    await data.load();
    toast(result.message ?? '同步完成', 'ok');
  } catch (error) {
    toast(error instanceof Error ? error.message : '同步失败', 'error');
  } finally {
    syncing.value = null;
  }
}

async function runProbe() {
  probing.value = true;
  probeResult.value = '';
  try {
    const result = await api.probe({ appId: probeApp.value, module: probeModule.value, method: probeMethod.value });
    probeResult.value = JSON.stringify(result, null, 2);
    if (result.ok && result.rowCount > 0) toast(`探针成功：${result.rowCount} 行`, 'ok');
    else toast(result.ok ? '接口有响应，但没有解析到行数据' : '探针失败，见下方详情', 'error');
  } catch (error) {
    probeResult.value = error instanceof Error ? error.message : '探针失败';
  } finally {
    probing.value = false;
  }
}

const periods = computed(() => data.periods);

/** 数据模式看来源而不是看登录方式：本地会话也可能读的是真实数据。 */
const demo = computed(
  () => data.sources.length === 0 || data.sources.every((source) => source.mode === 'mock'),
);
</script>

<template>
  <div class="settings">
    <header class="head">
      <div>
        <h1>设置</h1>
        <p class="sub">数据来源、作息口径与隐私边界。这里没有花哨的功能，只有需要被解释清楚的东西。</p>
      </div>
    </header>

    <section class="card block">
      <div class="block-head">
        <h2>数据来源</h2>
        <div class="row" style="gap: 8px">
          <span class="chip" :class="demo ? 'chip-warn' : 'chip-ok'">{{ demo ? '本地演示数据' : '真实数据 · ehall' }}</span>
          <button class="btn btn-sm btn-primary" type="button" :disabled="syncing !== null" @click="syncAll">
            <AppIcon name="refresh" :size="13" :class="{ spin: syncing !== null }" />
            {{ syncing !== null ? '同步中…' : '同步全部' }}
          </button>
        </div>
      </div>
      <ul class="sources">
        <li v-for="source in data.sources" :key="source.kind">
          <div class="source-main">
            <div class="source-title">
              <strong>{{ source.label }}</strong>
              <span class="chip">{{ modeLabel[source.mode] }}</span>
              <span class="chip" :class="source.status === 'ok' ? 'chip-ok' : 'chip-warn'">
                {{ source.status === 'ok' ? '正常' : source.status === 'pending' ? '待确认接口' : '需更新' }}
              </span>
            </div>
            <p class="source-detail">
              {{ source.detail ?? '—' }}
              <template v-if="source.url"> · <span class="mono">{{ source.url }}</span></template>
            </p>
            <p class="source-time">最近更新：{{ formatRelativeTime(source.fetchedAt) }}（{{ formatDateTime(source.fetchedAt) }}）</p>
          </div>
        </li>
      </ul>
      <p class="note">
        本地会话只刷新时间戳，不会访问 ehall；用「统一认证 / 粘贴 Cookie」登录后，「同步全部」会真实抓取培养方案、成绩、课表、开课与预警，
        并重建本地库（约 30–60 秒）。用户自建的方案会保留。
      </p>
    </section>

    <section class="card block">
      <div class="block-head">
        <h2>作息与学期</h2>
        <span class="faint">作息错误会让"最早/最晚/空档"全部算错，请优先核对</span>
      </div>
      <div class="two-col">
        <div class="periods">
          <div class="period-row head">
            <span>节次</span><span>开始</span><span>结束</span><span>所属</span>
          </div>
          <div v-for="period in periods" :key="period.period" class="period-row">
            <span class="num">{{ period.period }}</span>
            <span class="num">{{ period.start }}</span>
            <span class="num">{{ period.end }}</span>
            <span class="faint">{{ period.period <= 4 ? '上午' : period.period <= 8 ? '下午' : '晚上' }}</span>
          </div>
        </div>
        <div class="terms">
          <div v-for="term in data.terms" :key="term.id" class="term" :class="{ current: term.isCurrent, planning: term.isPlanning }">
            <div class="term-name">
              {{ term.name }}
              <span v-if="term.isCurrent" class="chip chip-accent">当前</span>
              <span v-if="term.isPlanning" class="chip chip-ok">规划中</span>
            </div>
            <div class="term-meta">
              第 1 周起始 {{ term.startDate }} · 共 {{ term.weekCount }} 周
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card block">
      <div class="block-head">
        <h2>数据接口探针</h2>
        <span class="faint">仅在开发模式开启；只使用你自己的会话</span>
      </div>
      <p class="note">
        ehall 的页面路由名 ≠ 数据接口名。真实登录后，用这里逐个尝试候选 module/method；
        成功的响应会自动保存为原始快照，后续字段映射可以离线调试，不必反复登录。
      </p>
      <div class="probe-form">
        <label>
          <span>appId</span>
          <input v-model="probeApp" class="input" placeholder="kcbcx" />
        </label>
        <label>
          <span>module</span>
          <input v-model="probeModule" class="input" placeholder="xskbcx" />
        </label>
        <label>
          <span>method</span>
          <input v-model="probeMethod" class="input" placeholder="queryXskbcx" />
        </label>
        <button class="btn btn-primary" type="button" :disabled="probing" @click="runProbe">
          {{ probing ? '请求中…' : '运行探针' }}
        </button>
      </div>
      <pre v-if="probeResult" class="probe-result">{{ probeResult }}</pre>
    </section>

    <section class="card block">
      <div class="block-head">
        <h2>边界与隐私</h2>
      </div>
      <ul class="rules">
        <li><b>只读。</b>不写入、不提交任何选课结果，正式选课仍在学校系统完成。</li>
        <li><b>只用你本人的数据。</b>不抓取他人、不提供共享账号、不做批量采集。</li>
        <li><b>密码不留存。</b>密码只在内存中用于换取一次会话；会话 Cookie 加密存放，服务重启即失效。</li>
        <li><b>不破解验证码。</b>遇到验证码时停止，改用「浏览器登录后粘贴 Cookie」。</li>
        <li><b>本地优先。</b>数据默认只写在 <span class="mono">apps/server/data/</span>，可随时删除。</li>
        <li><b>标注来源。</b>课程信息带来源、学期与更新时间，避免把三年前的印象当成今年的安排。</li>
      </ul>
      <p class="note">
        本项目是 HCI 课程作业与个人规划工具，不代表学校教务系统的口径；培养方案核算结果仅供参考。
      </p>
    </section>

    <footer class="foot">
      <span>学业规划与选课决策辅助系统 · v0.1.0</span>
      <span class="mono">Vue 3 · TypeScript · Fastify · 本地 JSON 存储</span>
    </footer>
  </div>
</template>

<style scoped>
.settings {
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head h1 {
  font-size: 22px;
}
.sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--muted);
}
.block {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.block-head h2 {
  font-size: 14.5px;
}
.faint {
  font-size: 11px;
  color: var(--faint);
}
.note {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.65;
  background: var(--surface-2);
  border-radius: 8px;
  padding: 9px 11px;
}

.sources {
  display: flex;
  flex-direction: column;
}
.sources li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--line);
}
.sources li:last-child {
  border-bottom: 0;
}
.source-main {
  flex: 1;
  min-width: 0;
}
.source-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.source-title strong {
  font-size: 12.5px;
}
.source-detail {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-time {
  font-size: 10.5px;
  color: var(--faint);
  margin-top: 2px;
}

.two-col {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 18px;
}
.periods {
  font-size: 11.5px;
}
.period-row {
  display: grid;
  grid-template-columns: 40px 1fr 1fr 50px;
  padding: 4px 6px;
  border-bottom: 1px dashed var(--line);
}
.period-row.head {
  font-weight: 600;
  color: var(--muted);
  font-size: 10.5px;
  border-bottom: 1px solid var(--line);
}
.terms {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.term {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
}
.term.current {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.term.planning {
  border-color: color-mix(in srgb, var(--ok) 30%, white);
  background: var(--ok-soft);
}
.term-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 550;
}
.term-meta {
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 2px;
}

.probe-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: end;
}
.probe-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  color: var(--muted);
}
.probe-result {
  background: #1b1d22;
  color: #d7dae0;
  border-radius: 9px;
  padding: 12px;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.55;
  max-height: 260px;
  overflow: auto;
  margin: 0;
}

.rules {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.rules li {
  font-size: 12px;
  color: var(--ink-2);
  padding-left: 14px;
  position: relative;
  line-height: 1.6;
}
.rules li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
}
.rules b {
  font-weight: 600;
  color: var(--ink);
}

.foot {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--faint);
  padding: 6px 2px 20px;
}

@media (max-width: 900px) {
  .two-col {
    grid-template-columns: minmax(0, 1fr);
  }
  .probe-form {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
