<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api, setToken, setUser } from '../api.js';
import { showToast } from '../toast.js';

const router = useRouter();
const phone = ref('');
const code = ref('');
const sending = ref(false);
const loading = ref(false);
const countdown = ref(0);

const phoneValid = computed(() => /^1\d{10}$/.test(phone.value));

async function sendCode() {
  if (!phoneValid.value) return showToast('请输入正确的手机号');
  sending.value = true;
  try {
    const r = await api('/auth/send-code', 'POST', { phone: phone.value });
    showToast(`验证码已发送（演示码：${r.code}）`, 'success');
    countdown.value = 60;
    const timer = setInterval(() => {
      countdown.value--;
      if (countdown.value <= 0) clearInterval(timer);
    }, 1000);
  } catch (e) {
    showToast(e.message);
  } finally {
    sending.value = false;
  }
}

async function submit() {
  if (!phoneValid.value) return showToast('请输入正确的手机号');
  if (!code.value) return showToast('请输入验证码');
  loading.value = true;
  try {
    const r = await api('/auth/login', 'POST', { phone: phone.value, code: code.value });
    setToken(r.token);
    setUser(r.user);
    router.push('/');
  } catch (e) {
    showToast(e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-bg"></div>
    <div class="login-wrap">
      <div class="brand-side">
        <div class="logo-mark">
          <span class="logo-en">帛序</span>
          <span class="logo-ai">AI</span>
        </div>
        <h1 class="brand-title">服装行业专属<br />AI 设计工作台</h1>
        <p class="brand-sub">让创意落地 · 让生产有序</p>
        <div class="brand-dots">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>

      <div class="login-card glass-card">
        <h2>登录帛序 AI</h2>
        <p class="login-tip">验证码登录，开启你的 AI 创意工坊</p>

        <div class="form-group">
          <label>手机号</label>
          <input v-model="phone" class="field" type="tel" maxlength="11" placeholder="请输入手机号" />
        </div>

        <div class="form-group">
          <label>验证码</label>
          <div class="code-row">
            <input v-model="code" class="field" type="tel" maxlength="6" placeholder="请输入验证码"
              @keyup.enter="submit" />
            <button class="btn btn-ghost code-btn" :disabled="countdown > 0 || sending" @click="sendCode">
              {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </button>
          </div>
        </div>

        <button class="btn btn-primary submit-btn" :disabled="loading" @click="submit">
          {{ loading ? '登录中…' : '登 录' }}
        </button>
        <p class="demo-tip">演示万能码：<b>123456</b>，未注册手机号将自动创建账号</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.login-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(700px 420px at 75% 30%, rgba(108, 92, 231, 0.22), transparent 60%),
    radial-gradient(600px 400px at 20% 75%, rgba(138, 123, 255, 0.12), transparent 60%);
}
.login-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 90px;
  padding: 40px;
}
.brand-side {
  max-width: 460px;
}
.logo-mark {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 36px;
}
.logo-en {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 3px;
  color: var(--text-1);
}
.logo-ai {
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--primary-light), var(--gold));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.brand-title {
  font-size: 40px;
  line-height: 1.3;
  letter-spacing: 1px;
  margin-bottom: 20px;
}
.brand-sub {
  font-size: 16px;
  color: var(--text-3);
  letter-spacing: 4px;
}
.brand-dots {
  display: flex;
  gap: 8px;
  margin-top: 40px;
}
.brand-dots span {
  width: 26px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
}
.brand-dots span:first-child {
  background: linear-gradient(90deg, var(--primary), var(--primary-light));
}
.login-card {
  width: 400px;
  padding: 38px 36px;
}
.login-card h2 {
  font-size: 22px;
  margin-bottom: 6px;
}
.login-tip {
  color: var(--text-3);
  font-size: 13px;
  margin: 0 0 28px;
}
.form-group {
  margin-bottom: 18px;
}
.form-group label {
  display: block;
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 8px;
}
.code-row {
  display: flex;
  gap: 10px;
}
.code-btn {
  height: 42px;
  padding: 0 16px;
  flex-shrink: 0;
}
.submit-btn {
  width: 100%;
  height: 46px;
  margin-top: 10px;
  font-size: 15px;
  letter-spacing: 4px;
}
.demo-tip {
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
  margin: 18px 0 0;
}
.demo-tip b {
  color: var(--gold);
}
</style>
