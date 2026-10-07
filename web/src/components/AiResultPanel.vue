<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api, track } from '../api.js';
import { showToast } from '../toast.js';
import Modal from './Modal.vue';

const props = defineProps({
  results: { type: Array, default: () => [] },
  taskDbId: { type: [Number, String], required: true },
});
const emit = defineEmits(['retry']);
const router = useRouter();

const selected = ref(new Set(props.results.map((r) => r.lookNo)));
const saving = ref(false);
const saveModalOpen = ref(false);
const projectName = ref('');
const savedProjectId = ref(0);

const allSelected = computed(() => selected.value.size === props.results.length);

function toggle(lookNo) {
  const s = new Set(selected.value);
  if (s.has(lookNo)) s.delete(lookNo);
  else s.add(lookNo);
  selected.value = s;
}

function toggleAll() {
  if (allSelected.value) selected.value = new Set();
  else selected.value = new Set(props.results.map((r) => r.lookNo));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function downloadOne(item) {
  track('download_image', { look_no: item.lookNo });
  const name = `Look_${pad(item.lookNo)}.png`;
  window.open(`/api/download?url=${encodeURIComponent(item.url)}&name=${encodeURIComponent(name)}`, '_blank');
}

async function batchDownload() {
  if (selected.value.size === 0) return showToast('请先勾选要下载的图片');
  track('download_image', { batch: true, count: selected.value.size });
  const picked = props.results.filter((r) => selected.value.has(r.lookNo));
  picked.forEach((item, i) => {
    setTimeout(() => downloadOne(item), i * 700);
  });
}

function openSave() {
  if (selected.value.size === 0) return showToast('请先勾选要保存的图片');
  projectName.value = '';
  saveModalOpen.value = true;
}

async function confirmSave() {
  if (!projectName.value.trim()) return showToast('请输入新项目名称');
  saving.value = true;
  try {
    const r = await api(`/ai/tasks/${props.taskDbId}/save`, 'POST', {
      lookNos: [...selected.value],
      projectName: projectName.value.trim(),
    });
    track('save_result_to_project', { project_id: r.projectId, count: selected.value.size });
    savedProjectId.value = r.projectId;
    saveModalOpen.value = false;
  } catch (e) {
    showToast(e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="savedProjectId" class="save-done glass-card">
    <div class="done-icon">✓</div>
    <h2>已保存到项目</h2>
    <p>素材已安全存入你的项目画廊，可随时继续深化</p>
    <div class="done-actions">
      <button class="btn btn-primary" @click="router.push(`/project/${savedProjectId}`)">查看项目</button>
      <button class="btn btn-ghost" @click="router.push('/workbench')">返回工作台</button>
    </div>
  </div>

  <div v-else class="result-panel">
    <div class="looks-grid">
      <div v-for="(item, i) in results" :key="item.lookNo" class="look-card glass-card fade-up"
        :class="{ picked: selected.has(item.lookNo) }"
        :style="{ animationDelay: `${i * 0.12}s` }"
        @click="toggle(item.lookNo)">
        <div class="check">{{ selected.has(item.lookNo) ? '✓' : '' }}</div>
        <img :src="item.url" :alt="`Look ${pad(item.lookNo)}`" loading="lazy" />
        <div class="look-foot">
          <span class="look-no">Look {{ pad(item.lookNo) }}</span>
          <button class="look-dl" title="下载" @click.stop="downloadOne(item)">⤓</button>
        </div>
      </div>
    </div>

    <div class="action-bar glass-card">
      <label class="select-all" @click="toggleAll">
        <span class="mini-check">{{ allSelected ? '✓' : '' }}</span>全选
      </label>
      <span class="sel-count">已选 <b>{{ selected.size }}</b> 张</span>
      <div class="bar-spacer"></div>
      <button class="btn btn-ghost" @click="emit('retry')">调整重生成</button>
      <button class="btn btn-ghost" @click="batchDownload">批量下载</button>
      <button class="btn btn-primary" @click="openSave">保存为新项目</button>
    </div>

    <Modal :open="saveModalOpen" title="保存为新项目"
      @close="saveModalOpen = false">
      <p class="modal-desc">勾选的 {{ selected.size }} 张图片将保存到新项目</p>
      <input v-model="projectName" class="field" maxlength="50" placeholder="请输入项目名称，如：2026 春夏连衣裙系列"
        @keyup.enter="confirmSave" />
      <template #footer>
        <button class="btn btn-ghost" @click="saveModalOpen = false">取消</button>
        <button class="btn btn-primary" :disabled="saving" @click="confirmSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.looks-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 22px;
  margin-bottom: 26px;
}
.look-card {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.25s ease, border-color 0.25s, box-shadow 0.25s;
}
.look-card:hover { transform: translateY(-4px); border-color: var(--line-bright); }
.look-card.picked { border-color: rgba(138, 123, 255, 0.6); box-shadow: 0 0 0 1px rgba(138, 123, 255, 0.4), var(--shadow-hover); }
.look-card img {
  width: 100%;
  aspect-ratio: 4 / 3.2;
  object-fit: cover;
  display: block;
  background: var(--card-2);
}
.check {
  position: absolute;
  top: 14px; left: 14px;
  width: 28px; height: 28px;
  border-radius: 50%;
  background: rgba(10, 10, 15, 0.55);
  border: 1px solid var(--line-bright);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px;
  color: #fff;
  z-index: 2;
  transition: all 0.2s;
}
.look-card.picked .check {
  background: linear-gradient(135deg, var(--primary), var(--primary-light));
  border-color: transparent;
  box-shadow: 0 0 14px rgba(138, 123, 255, 0.6);
}
.look-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
}
.look-no { font-size: 13px; font-weight: 600; color: var(--text-1); letter-spacing: 1px; }
.look-dl {
  color: var(--text-3);
  font-size: 15px;
  width: 28px; height: 28px;
  border-radius: 50%;
  transition: all 0.15s;
}
.look-dl:hover { background: rgba(138, 123, 255, 0.18); color: var(--primary-light); }

.action-bar {
  position: sticky;
  bottom: 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
}
.select-all { display: flex; align-items: center; gap: 7px; font-size: 13px; cursor: pointer; }
.mini-check {
  width: 18px; height: 18px;
  border-radius: 5px;
  border: 1px solid var(--line-bright);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px;
}
.select-all:hover .mini-check { border-color: var(--primary-light); }
.sel-count { font-size: 13px; color: var(--text-3); }
.sel-count b { color: var(--primary-light); }
.bar-spacer { flex: 1; }
.modal-desc { color: var(--text-3); font-size: 13px; margin: 0 0 12px; }

.save-done {
  text-align: center;
  padding: 80px 30px;
  max-width: 480px;
  margin: 60px auto;
}
.done-icon {
  width: 64px; height: 64px;
  margin: 0 auto 24px;
  border-radius: 50%;
  background: rgba(74, 222, 128, 0.15);
  border: 1px solid rgba(74, 222, 128, 0.4);
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; color: var(--success);
}
.save-done h2 { margin-bottom: 10px; }
.save-done p { color: var(--text-3); font-size: 14px; margin: 0 0 28px; }
.done-actions { display: flex; gap: 12px; justify-content: center; }
</style>
