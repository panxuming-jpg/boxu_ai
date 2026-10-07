<script setup>
import { useRouter } from 'vue-router';
import { getUser, setToken, setUser } from '../api.js';
import { showToast } from '../toast.js';

const router = useRouter();
const user = getUser();

const workbenches = [
  { key: 'design', name: '设计生产工作台', desc: '服装设计 · 印花 · 面料 · 工艺单', active: true, glow: 'rgba(108,92,231,.4)' },
  { key: 'inspiration', name: '灵感决策工作台', desc: '趋势洞察 · 企划决策', active: false, glow: 'rgba(215,185,142,.25)' },
  { key: 'marketing', name: '万能营销工作台', desc: '商品图 · 营销物料一键生成', active: false, glow: 'rgba(108,92,231,.2)' },
  { key: 'styling', name: '穿搭融合工作台', desc: '智能搭配 · 风格融合', active: false, glow: 'rgba(138,123,255,.2)' },
  { key: 'video', name: '视频工作台', desc: '服饰动态展示 · 短视频生成', active: false, glow: 'rgba(215,185,142,.18)' },
  { key: 'fitting', name: 'AI 试衣工作台', desc: '虚拟试穿 · 上身效果', active: false, glow: 'rgba(108,92,231,.18)' },
];

const icons = {
  design: '✦', inspiration: '❖', marketing: '◈', styling: '❋', video: '▶', fitting: '◎',
};

const cases = [
  { prompt: 'fashion designer studio with fabric swatches and sketches on table, moody cinematic light', tag: '设计灵感' },
  { prompt: 'elegant womenswear flat lay on pure white background, beige dress e-commerce catalog', tag: '服装设计' },
  { prompt: 'seamless floral textile print pattern, fashion fabric design swatch', tag: '印花设计' },
  { prompt: 'fashion color palette with silk fabric materials, luxury brand mood board', tag: '面料企划' },
];
const img = (p) => `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(p)}&image_size=landscape_4_3`;

function enter(w) {
  if (w.active) router.push('/studio');
  else showToast('功能即将开放，敬请期待');
}

function logout() {
  setToken('');
  setUser('');
  router.push('/login');
}
</script>

<template>
  <div class="home">
    <header class="topnav">
      <div class="container nav-inner">
        <div class="logo" @click="router.push('/')">
          <span class="logo-en">帛序</span><span class="logo-ai">AI</span>
        </div>
        <nav class="nav-links">
          <a @click="showToast('帮助中心建设中')">帮助中心</a>
          <a @click="showToast('积分商城建设中')">购买积分</a>
          <a @click="showToast('请联系客服：400-000-0000')">联系我们</a>
          <span class="divider"></span>
          <span class="user-name">{{ user?.name || '' }}</span>
          <a class="logout" @click="logout">退出</a>
        </nav>
      </div>
    </header>

    <section class="hero container">
      <div class="hero-badge tag-gold tag">服饰行业垂直大模型 · AI 创意生产力</div>
      <h1 class="hero-title">帛序 AI<br />服装行业专属 AI 设计工作台</h1>
      <p class="hero-sub">上传参考图，用一句话描述创意，AI 大模型为你生成款式、印花、面料与工艺素材</p>
      <div class="search-box">
        <span class="search-icon">⌕</span>
        <input placeholder="试试输入：生成一张燕麦色泡泡袖连衣裙白底平铺图" @keyup.enter="router.push('/studio')" />
        <button class="btn btn-primary" @click="router.push('/studio')">开始创作</button>
      </div>
    </section>

    <section class="section container">
      <div class="section-head">
        <h2>全部工作台</h2>
        <span class="text-muted">选择一个工作台开启工作</span>
      </div>
      <div class="wb-grid">
        <div v-for="w in workbenches" :key="w.key" class="wb-card glass-card"
          :class="{ active: w.active }" @click="enter(w)">
          <div class="wb-glow" :style="{ background: w.glow }"></div>
          <div class="wb-top">
            <span class="wb-icon">{{ icons[w.key] }}</span>
            <span v-if="!w.active" class="soon">即将开放</span>
            <span v-else class="enter-tag">进入 →</span>
          </div>
          <h3>{{ w.name }}</h3>
          <p>{{ w.desc }}</p>
        </div>
      </div>
    </section>

    <section class="section container">
      <div class="section-head">
        <h2>案例社区</h2>
        <span class="text-muted">看看其他设计师用帛序 AI 创造了什么</span>
      </div>
      <div class="case-grid">
        <div v-for="(c, i) in cases" :key="i" class="case-card glass-card">
          <img :src="img(c.prompt)" :alt="c.tag" loading="lazy" />
          <span class="case-tag">{{ c.tag }}</span>
        </div>
      </div>
    </section>

    <footer class="footer text-muted">
      © 2026 帛序 AI · 让创意落地，让生产有序
    </footer>
  </div>
</template>

<style scoped>
.topnav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(10, 10, 15, 0.75);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.nav-inner {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.logo {
  display: flex;
  align-items: baseline;
  gap: 5px;
  cursor: pointer;
}
.logo-en { font-size: 18px; font-weight: 800; letter-spacing: 2px; color: var(--text-1); }
.logo-ai {
  font-size: 13px; font-weight: 700;
  background: linear-gradient(135deg, var(--primary-light), var(--gold));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.logo-cn { font-size: 14px; color: var(--text-3); margin-left: 8px; }
.nav-links { display: flex; align-items: center; gap: 24px; font-size: 13px; color: var(--text-3); }
.nav-links a { cursor: pointer; transition: color 0.2s; }
.nav-links a:hover { color: var(--text-1); }
.divider { width: 1px; height: 14px; background: var(--line-bright); }
.user-name { color: var(--text-2); font-size: 13px; }
.logout:hover { color: var(--danger) !important; }

.hero { text-align: center; padding: 86px 28px 70px; }
.hero-badge { margin-bottom: 26px; }
.hero-title {
  font-size: 44px;
  line-height: 1.32;
  letter-spacing: 1px;
  background: linear-gradient(180deg, #fff, #b7bcc9);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero-sub { color: var(--text-3); font-size: 15px; margin: 22px 0 40px; }
.search-box {
  max-width: 640px; margin: 0 auto;
  display: flex; align-items: center; gap: 10px;
  background: var(--surface);
  border: 1px solid var(--line-bright);
  border-radius: 999px;
  padding: 7px 7px 7px 22px;
}
.search-icon { color: var(--text-3); font-size: 18px; }
.search-box input {
  flex: 1; background: none; border: none; outline: none;
  color: var(--text-1); font-size: 14px;
}
.search-box input::placeholder { color: var(--text-3); }
.search-box .btn { height: 40px; }

.section { padding: 26px 28px; }
.section-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 22px; }
.section-head h2 { font-size: 22px; }

.wb-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.wb-card {
  position: relative;
  padding: 26px 24px;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}
.wb-card:hover { transform: translateY(-4px); border-color: var(--line-bright); }
.wb-card.active { border-color: rgba(138, 123, 255, 0.45); }
.wb-card.active:hover { box-shadow: var(--shadow-hover); }
.wb-glow {
  position: absolute;
  top: -60px; right: -50px;
  width: 180px; height: 180px;
  border-radius: 50%;
  filter: blur(50px);
  opacity: 0.7;
  pointer-events: none;
}
.wb-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.wb-icon {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  color: var(--primary-light);
}
.soon { font-size: 12px; color: var(--text-3); }
.enter-tag { font-size: 12px; color: var(--primary-light); }
.wb-card h3 { font-size: 17px; margin-bottom: 8px; }
.wb-card p { font-size: 13px; color: var(--text-3); margin: 0; }

.case-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
}
.case-card {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  aspect-ratio: 4 / 3;
}
.case-card img {
  width: 100%; height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
}
.case-card:hover img { transform: scale(1.06); }
.case-tag {
  position: absolute;
  left: 12px; bottom: 12px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(10, 10, 15, 0.7);
  border: 1px solid var(--line);
  backdrop-filter: blur(6px);
}

.footer { text-align: center; font-size: 12px; padding: 60px 0 36px; }
</style>
