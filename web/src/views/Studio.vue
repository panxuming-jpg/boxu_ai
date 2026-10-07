<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import AssetPanel from '../components/studio/AssetPanel.vue';
import StudioCanvas from '../components/studio/StudioCanvas.vue';
import AssistantChat from '../components/studio/AssistantChat.vue';
import { useStudio } from '../stores/studio.js';
import { track } from '../api.js';

const router = useRouter();
const { state } = useStudio();
// 素材资产面板默认隐藏，以悬浮按钮触发
const showAssets = ref(false);

onMounted(() => track('enter_studio'));
</script>

<template>
  <div class="studio-page">
    <header class="studio-topbar">
      <div class="studio-brand" @click="router.push('/')">
        <span class="brand-dot"></span>
        <span class="brand-text">帛序 AI</span>
        <span class="brand-sub">设计生产工作台</span>
      </div>
      <div class="topbar-right">
        <button class="topbar-link" @click="router.push('/workbench')">项目管理</button>
        <button class="topbar-link" @click="router.push('/')">返回首页</button>
      </div>
    </header>
    <div class="studio-body">
      <main class="studio-center">
        <StudioCanvas />
      </main>
      <aside class="studio-right">
        <AssistantChat />
      </aside>

      <!-- 素材资产：悬浮按钮 + 抽屉面板 -->
      <button
        class="assets-fab"
        :class="{ on: showAssets }"
        :title="showAssets ? '收起素材资产' : '展开素材资产'"
        @click="showAssets = !showAssets"
      >
        <span class="fab-icon">🗂</span>
        <span class="fab-text">素材</span>
        <span v-if="state.assets.length" class="fab-badge">{{ state.assets.length }}</span>
      </button>
      <transition name="drawer">
        <aside v-if="showAssets" class="studio-left drawer">
          <div class="drawer-close" @click="showAssets = false">✕ 收起</div>
          <AssetPanel />
        </aside>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.studio-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg, #14141d);
}
.studio-topbar {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: rgba(30, 30, 42, 0.7);
  backdrop-filter: blur(12px);
}
.studio-brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  cursor: pointer;
}
.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  box-shadow: 0 0 10px rgba(138, 123, 255, 0.6);
  align-self: center;
}
.brand-text {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 1px;
}
.brand-sub {
  font-size: 12px;
  color: var(--gold);
  letter-spacing: 2px;
}
.topbar-right {
  display: flex;
  gap: 4px;
}
.topbar-link {
  background: none;
  border: none;
  color: var(--text-soft, #9ca3af);
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.topbar-link:hover {
  color: #fff;
  background: var(--line);
}
.studio-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}
.studio-center {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.studio-right {
  width: 20%;
  min-width: 260px;
  max-width: 360px;
  border-left: 1px solid var(--line);
  min-height: 0;
}
@media (max-width: 1100px) {
  .studio-right { min-width: 220px; }
}

/* 素材资产悬浮按钮 */
.assets-fab {
  position: absolute;
  left: 16px;
  bottom: 76px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(30, 30, 42, 0.92);
  color: var(--text-soft, #9ca3af);
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  transition: border-color 0.15s, color 0.15s;
}
.assets-fab:hover { color: #fff; border-color: var(--primary-light); }
.assets-fab.on { color: #fff; border-color: var(--primary-light); background: rgba(108, 92, 231, 0.35); }
.fab-icon { font-size: 18px; line-height: 1; }
.fab-text { font-size: 11px; }
.fab-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--primary);
  color: #fff;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

/* 素材资产抽屉 */
.studio-left.drawer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 300px;
  z-index: 25;
  border-right: 1px solid var(--line);
  background: rgba(24, 24, 34, 0.98);
  box-shadow: 12px 0 36px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
}
.drawer-close {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-soft, #9ca3af);
  text-align: right;
  cursor: pointer;
  flex-shrink: 0;
}
.drawer-close:hover { color: #fff; }
.studio-left.drawer :deep(.asset-panel) { height: auto; flex: 1; min-height: 0; }
.drawer-enter-active, .drawer-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(-24px); opacity: 0; }
</style>
