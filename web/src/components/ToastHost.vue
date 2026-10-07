<script setup>
import { toasts } from '../toast.js';
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
        <span class="dot"></span>{{ t.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 13px;
  background: rgba(30, 30, 42, 0.92);
  border: 1px solid var(--line-bright);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}
.toast .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.toast.error .dot { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
.toast.success .dot { background: var(--success); box-shadow: 0 0 8px var(--success); }
.toast.error { color: #ffd5d5; }
.toast.success { color: #d6ffe4; }
.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from { opacity: 0; transform: translateY(-12px); }
.toast-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
