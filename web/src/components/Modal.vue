<script setup>
defineProps({
  title: { type: String, default: '' },
  open: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);
</script>

<template>
  <Teleport to="body">
    <template v-if="open">
      <div class="modal-mask fade-in" @click.self="emit('close')">
        <div class="modal-box glass-card fade-up">
          <div class="modal-head">
            <h3>{{ title }}</h3>
            <button class="close" @click="emit('close')">✕</button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="modal-foot">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(5, 5, 10, 0.65);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-box {
  width: 440px;
  max-width: calc(100vw - 48px);
  padding: 24px 26px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.modal-head h3 {
  font-size: 18px;
}
.close {
  color: var(--text-3);
  font-size: 14px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  transition: all 0.2s;
}
.close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-1);
}
.modal-body {
  font-size: 14px;
}
.modal-foot {
  margin-top: 22px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
