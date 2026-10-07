<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const tips = [
  '正在理解参考图中的版型结构…',
  'AI 大模型正在勾勒服饰轮廓…',
  '正在渲染面料质感与光影…',
  '即将为你呈现设计提案…',
];
const tipIdx = ref(0);
const elapsed = ref(0);
let tipTimer, clockTimer;

onMounted(() => {
  tipTimer = setInterval(() => { tipIdx.value = (tipIdx.value + 1) % tips.length; }, 4000);
  const start = Date.now();
  clockTimer = setInterval(() => { elapsed.value = Math.floor((Date.now() - start) / 1000); }, 1000);
});
onUnmounted(() => {
  clearInterval(tipTimer);
  clearInterval(clockTimer);
});
</script>

<template>
  <div class="generating">
    <div class="halo">
      <div class="ring r1"></div>
      <div class="ring r2"></div>
      <div class="ring r3"></div>
      <div class="core ai-pulse">
        <span class="spark">✦</span>
      </div>
    </div>
    <h2>AI 正在生成设计</h2>
    <p class="gtip">{{ tips[tipIdx] }}</p>
    <p class="elapsed">已等待 {{ elapsed }}s · 平均生成时间约 30s</p>
  </div>
</template>

<style scoped>
.generating {
  text-align: center;
  padding: 90px 20px;
}
.halo {
  position: relative;
  width: 190px; height: 190px;
  margin: 0 auto 38px;
}
.ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(138, 123, 255, 0.3);
}
.r1 { animation: ripple 2.6s ease-out infinite; }
.r2 { animation: ripple 2.6s ease-out infinite 0.85s; }
.r3 { animation: ripple 2.6s ease-out infinite 1.7s; }
.core {
  position: absolute;
  inset: 48px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgba(138, 123, 255, 0.55), rgba(108, 92, 231, 0.25) 70%, transparent);
  display: flex; align-items: center; justify-content: center;
}
.spark {
  font-size: 34px;
  color: #fff;
  text-shadow: 0 0 18px rgba(138, 123, 255, 0.9);
}
@keyframes ripple {
  0% { transform: scale(0.72); opacity: 0.9; }
  100% { transform: scale(1.25); opacity: 0; }
}
h2 { font-size: 24px; margin-bottom: 12px; }
.gtip { color: var(--text-2); font-size: 14px; margin: 0 0 8px; transition: opacity 0.3s; }
.elapsed { color: var(--text-3); font-size: 12px; margin: 0; }
</style>
