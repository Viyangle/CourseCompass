<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import AppIcon from '@/components/AppIcon.vue';

const router = useRouter();
const route = useRoute();
const session = useSessionStore();

type Mode = 'demo' | 'cas' | 'cookie';
const mode = ref<Mode>('demo');
const username = ref('');
const password = ref('');
const cookie = ref('');
const localError = ref('');

const redirect = computed(() => {
  const target = route.query.redirect;
  return typeof target === 'string' && target.startsWith('/') ? target : '/';
});

const modes: { key: Mode; label: string }[] = [
  { key: 'demo', label: '本地进入' },
  { key: 'cas', label: '南大统一认证' },
  { key: 'cookie', label: '粘贴 Cookie' },
];

async function submit() {
  localError.value = '';
  if (mode.value === 'demo') {
    if (await session.loginDemo()) await router.push(redirect.value);
    return;
  }
  if (mode.value === 'cas') {
    if (!username.value.trim() || !password.value) {
      localError.value = '请输入学号与密码';
      return;
    }
    if (await session.loginCas(username.value.trim(), password.value)) {
      password.value = '';
      await router.push(redirect.value);
    }
    return;
  }
  if (!cookie.value.trim()) {
    localError.value = '请粘贴浏览器中的 Cookie';
    return;
  }
  if (await session.loginCookie(cookie.value.trim())) await router.push(redirect.value);
}

const errorText = computed(() => localError.value || session.error);
</script>

<template>
  <div class="login">
    <section class="pitch">
      <div class="brand">
        <div class="mark">选</div>
        <span>选课工作台</span>
      </div>
      <h1>让学分、时间与方案，<br />出现在同一张图上。</h1>
      <p class="lede">
        把你的培养方案、已修学分、开课信息整理成一张可以反复试选的课表。正式选课仍然在学校系统完成。
      </p>
      <ul class="points">
        <li><AppIcon name="check" :size="15" /> 培养方案进度自动核算，标出真正还差的学分</li>
        <li><AppIcon name="check" :size="15" /> 拖进课程立刻看到冲突，精确到第几周、第几节</li>
        <li><AppIcon name="check" :size="15" /> 保存多套方案并排比较，随时撤销</li>
      </ul>
      <p class="note">
        本项目只读取你本人的公开课业数据，用于个人规划；不写入、不提交任何选课结果。
      </p>
    </section>

    <section class="panel">
      <div class="card">
        <div class="tabs" role="tablist">
          <button
            v-for="item in modes"
            :key="item.key"
            type="button"
            role="tab"
            :aria-selected="mode === item.key"
            class="tab"
            :class="{ active: mode === item.key }"
            @click="mode = item.key; session.error = ''"
          >
            {{ item.label }}
          </button>
        </div>

        <div v-if="mode === 'demo'" class="form">
          <h2>直接进入工作台</h2>
          <p class="hint">
            使用本机已同步的数据（可能是内置演示数据，也可能是你刚同步的 ehall 真实数据），全程不访问 ehall。
          </p>
          <button class="btn btn-primary block" type="button" :disabled="session.busy" @click="submit">
            {{ session.busy ? '正在加载…' : '进入工作台' }}
          </button>
          <p class="tiny">数据来源与更新时间见「设置 → 数据来源」。真实登录请用另外两个入口。</p>
        </div>

        <div v-else-if="mode === 'cas'" class="form">
          <h2>使用南大统一身份认证</h2>
          <p class="hint">
            密码只用于换取一次教务会话，保存在服务端内存，不落盘、不进日志。若学校要求验证码，请改用「粘贴 Cookie」。
          </p>
          <p class="note-inline">
            注：统一认证当前使用滑块验证（toSliderCaptcha）。本项目不绕过验证码，遇到时请走「粘贴 Cookie」。
          </p>
          <label class="field">
            <span>学号</span>
            <input v-model="username" class="input" autocomplete="username" placeholder="例如 2024xxxxx" />
          </label>
          <label class="field">
            <span>密码</span>
            <input v-model="password" class="input" type="password" autocomplete="current-password" placeholder="统一身份认证密码" />
          </label>
          <button class="btn btn-primary block" type="button" :disabled="session.busy" @click="submit">
            {{ session.busy ? '正在登录…' : '登录并导入' }}
          </button>
          <p class="tiny">需要能访问 authserver.nju.edu.cn；校外请先连校园 VPN。</p>
        </div>

        <div v-else class="form">
          <h2>粘贴已登录的 Cookie</h2>
          <p class="hint">
            在浏览器登录 ehall 后，打开开发者工具 → Network → 任意请求 → 复制 Request Headers 里的 Cookie，粘贴到这里。
          </p>
          <textarea
            v-model="cookie"
            class="input textarea"
            rows="5"
            placeholder="MOD_AUTH_CAS=...; JSESSIONID=..."
          />
          <button class="btn btn-primary block" type="button" :disabled="session.busy" @click="submit">
            {{ session.busy ? '正在验证…' : '导入会话' }}
          </button>
          <p class="tiny">Cookie 等同于登录凭证，请勿分享给他人；本项目只在本地保存。</p>
        </div>

        <div v-if="errorText" class="error">
          <AppIcon name="alert" :size="14" />
          <div>
            <strong>{{ errorText }}</strong>
            <span v-if="session.errorHint">{{ session.errorHint }}</span>
          </div>
        </div>
      </div>

      <p class="foot">
        仅用于课程规划，不替代学校选课系统 ·
        <span class="mono">v0.1.0</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(420px, 520px);
  background: var(--bg);
}

.pitch {
  padding: 56px 64px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 22px;
  background:
    radial-gradient(900px 500px at 10% 0%, rgba(124, 58, 237, 0.1), transparent 60%),
    radial-gradient(700px 400px at 90% 100%, rgba(15, 118, 110, 0.08), transparent 60%);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 650;
  font-size: 14px;
}
.mark {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(145deg, #7c3aed, #4c1d95);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 14px;
}
.pitch h1 {
  font-size: 34px;
  line-height: 1.32;
  font-weight: 660;
  letter-spacing: -0.02em;
}
.lede {
  max-width: 460px;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 1.7;
}
.points {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 4px;
}
.points li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-2);
}
.points svg {
  color: var(--accent);
  flex: none;
}
.note {
  margin-top: 18px;
  font-size: 11.5px;
  color: var(--faint);
  max-width: 420px;
  line-height: 1.6;
}

.panel {
  padding: 40px 40px 28px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 20px;
}
.tabs {
  display: flex;
  gap: 2px;
  background: var(--surface-3);
  padding: 3px;
  border-radius: 9px;
  margin-bottom: 18px;
}
.tab {
  flex: 1;
  height: 28px;
  border: 0;
  background: transparent;
  border-radius: 7px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.tab.active {
  background: var(--surface);
  color: var(--ink);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.form h2 {
  font-size: 16px;
}
.hint {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11.5px;
  color: var(--muted);
}
.block {
  width: 100%;
  margin-top: 6px;
}
.textarea {
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.5;
}
.tiny {
  font-size: 10.5px;
  color: var(--faint);
  line-height: 1.5;
}
.note-inline {
  font-size: 10.5px;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: 7px;
  padding: 6px 8px;
  line-height: 1.5;
}
.error {
  margin-top: 14px;
  display: flex;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 9px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}
.error div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.error strong {
  font-weight: 600;
}
.error span {
  color: color-mix(in srgb, var(--danger) 82%, black);
  font-size: 11px;
}

.foot {
  text-align: center;
  font-size: 10.5px;
  color: var(--faint);
}

@media (max-width: 900px) {
  .login {
    grid-template-columns: 1fr;
  }
  .pitch {
    display: none;
  }
  .panel {
    padding: 28px 20px;
  }
}
</style>
