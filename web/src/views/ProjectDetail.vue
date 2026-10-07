<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, track } from '../api.js';
import { showToast } from '../toast.js';
import Modal from '../components/Modal.vue';
import ImageUploader from '../components/ImageUploader.vue';
import { MAX_PROMPT } from '../components/limits.js';

const route = useRoute();
const router = useRouter();

const project = ref(null);
const assets = ref([]);
const deleteOpen = ref(false);
const uploaderRef = ref(null);

// 继续生成
const genScene = ref('fashion_design');
const genPrompt = ref('');
const genLoading = ref(false);
let pollTimer = null;

const sceneOptions = [
  { key: 'fashion_design', name: '服装设计' },
  { key: 'print_design', name: '印花设计' },
  { key: 'fabric_apply', name: '面料应用' },
  { key: 'tech_pack', name: '生成工艺单' },
];

const refs4 = [
  { name: '服装线稿', prompt: 'black and white fashion technical flat sketch of dress, clean outline drawing, white background' },
  { name: '服装款式图', prompt: 'fashion garment flat lay on pure white background, e-commerce catalog photo' },
  { name: '印花图案', prompt: 'fashion textile print pattern design swatch, artistic pattern' },
  { name: '面料图片', prompt: 'fabric material swatch close up, silk and cotton texture, elegant colors' },
];
const img = (p, size = 'square_hd') =>
  `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(p)}&image_size=${size}`;

const uploads = computed(() => assets.value.filter((a) => a.kind === 'upload'));
const generated = computed(() => assets.value.filter((a) => a.kind === 'generated'));
const isEmpty = computed(() => assets.value.length === 0);

onMounted(load);
onUnmounted(() => stopPolling());

async function load() {
  try {
    const r = await api(`/projects/${route.params.id}`);
    project.value = r.project;
    assets.value = r.assets;
    if (r.project.scene) genScene.value = r.project.scene;
  } catch (e) {
    showToast(e.message);
    if (/不存在/.test(e.message)) router.push('/workbench');
  }
}

function onUploaded() {
  load();
}

function triggerUpload() {
  uploaderRef.value?.pick();
}

// ---------- 继续生成 ----------
async function submitGen() {
  if (uploads.value.length === 0) return showToast('请先上传参考图片');
  if (uploads.value.some((x) => x.uploading)) return showToast('图片仍在上传，请稍候');
  if (!genPrompt.value.trim()) return showToast('请输入设计提示词');
  genLoading.value = true;
  try {
    const r = await api('/ai/tasks', 'POST', {
      scene: genScene.value,
      prompt: genPrompt.value.trim(),
      images: uploads.value.map((x) => ({ url: x.url, fileName: x.file_name })),
      projectId: project.value.id,
    });
    track('submit_ai_task', { scene: genScene.value, project_id: project.value.id });
    startPolling(r.taskDbId);
  } catch (e) {
    genLoading.value = false;
    showToast(e.message);
  }
}

function startPolling(id) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const r = await api(`/ai/tasks/${id}`);
      if (r.status === 'success') {
        stopPolling();
        // 项目内生成：自动保存全部结果到当前项目
        await api(`/ai/tasks/${id}/save`, 'POST', { projectId: project.value.id });
        track('save_result_to_project', { project_id: project.value.id });
        genLoading.value = false;
        genPrompt.value = '';
        showToast('新设计已生成并保存到项目', 'success');
        await load();
      } else if (r.status === 'failed') {
        stopPolling();
        genLoading.value = false;
        track('ai_task_fail', { reason: r.errorCode });
        showToast(r.error || '生成失败，请重试');
      }
    } catch (e) {
      stopPolling();
      genLoading.value = false;
      showToast(e.message);
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---------- 下载 ----------
function pad(n) {
  return String(n).padStart(2, '0');
}

function downloadAsset(a) {
  track('download_image');
  const name = a.kind === 'generated'
    ? `${(project.value?.name || 'look').replace(/[\\/:*?"<>|]/g, '_')}_Look_${pad(a.look_no)}.png`
    : a.file_name || 'reference.png';
  window.open(`/api/download?url=${encodeURIComponent(a.url)}&name=${encodeURIComponent(name)}`, '_blank');
}

function batchDownload() {
  if (generated.value.length === 0) return showToast('暂无可下载的生成图');
  generated.value.forEach((a, i) => setTimeout(() => downloadAsset(a), i * 700));
}

// ---------- 删除 ----------
async function confirmDelete() {
  try {
    await api(`/projects/${project.value.id}`, 'DELETE');
    showToast('项目已删除', 'success');
    router.push('/workbench');
  } catch (e) {
    showToast(e.message);
  } finally {
    deleteOpen.value = false;
  }
}

function sceneName(key) {
  return sceneOptions.find((s) => s.key === key)?.name || '';
}
</script>

<template>
  <div class="pd-page" v-if="project">
    <header class="pd-topnav">
      <div class="container nav-inner">
        <span class="back" @click="router.push('/workbench')">← 我的项目</span>
        <span class="top-logo">帛序 <b>AI</b></span>
      </div>
    </header>

    <!-- 项目信息 -->
    <div class="container">
      <div class="info-card glass-card">
        <div class="info-left">
          <h1>{{ project.name }}</h1>
          <div class="info-meta">
            <span v-if="project.scene_name" class="tag">{{ project.scene_name }}</span>
            <span class="status-dot"></span>进行中
            <span class="info-time">创建于 {{ project.created_label }}</span>
          </div>
        </div>
        <div class="info-actions">
          <button class="btn btn-ghost" @click="batchDownload">批量下载</button>
          <button class="btn btn-danger" @click="deleteOpen = true">删除项目</button>
        </div>
      </div>

      <!-- 空项目启动页 -->
      <div v-if="isEmpty" class="hello fade-up">
        <h2>Hello✨ 设计从这里开始</h2>
        <p>请先点击下方参考示意图，上传线稿图 / 款式图 / 图案 / 面料图</p>
        <div class="ref-row">
          <div v-for="r in refs4" :key="r.name" class="ref-card glass-card" @click="triggerUpload">
            <img :src="img(r.prompt)" :alt="r.name" loading="lazy" />
            <span>{{ r.name }}</span>
          </div>
        </div>
      </div>

      <!-- 创作区 -->
      <div class="create-card glass-card">
        <div class="cc-head">
          <h3>{{ isEmpty ? '上传后输入指令，生成第一款设计' : '继续生成' }}</h3>
        </div>

        <ImageUploader ref="uploaderRef" :project-id="project.id" @uploaded="onUploaded" />

        <div class="gen-divider"></div>

        <div class="gen-form">
          <div class="scene-chips">
            <button v-for="s in sceneOptions" :key="s.key" class="chip"
              :class="{ on: genScene === s.key }" @click="genScene = s.key">{{ s.name }}</button>
          </div>
          <textarea v-model="genPrompt" class="field" maxlength="4000" :disabled="genLoading"
            placeholder="描述你想要的设计，如：保留原版型，改为燕麦色，泡泡袖，羊绒面料质感，生成白底平铺图"></textarea>
          <div class="gen-foot">
            <span class="text-muted">将以项目中 {{ uploads.length }} 张参考图作为生成依据</span>
            <span class="counter" :class="{ over: genPrompt.length >= MAX_PROMPT }">{{ genPrompt.length }} / {{ MAX_PROMPT }}</span>
            <button class="btn btn-primary" :disabled="genLoading" @click="submitGen">
              <span v-if="genLoading" class="mini-spinner"></span>
              {{ genLoading ? 'AI 生成中…' : '✦ 生成设计' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 素材画廊：生成图 -->
      <div v-if="generated.length" class="gallery">
        <div class="gallery-head">
          <h3>AI 生成图 <span class="count-badge">{{ generated.length }}</span></h3>
        </div>
        <div class="gallery-grid">
          <div v-for="a in generated" :key="a.id" class="asset-card glass-card fade-up">
            <img :src="a.url" :alt="''" loading="lazy" />
            <div class="asset-foot">
              <span class="look-label">
                {{ sceneName(a.scene) }} · Look {{ pad(a.look_no) }}
              </span>
              <button class="asset-dl" @click="downloadAsset(a)">⤓</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 素材画廊：原图 -->
      <div v-if="uploads.length" class="gallery">
        <div class="gallery-head">
          <h3>上传原图 <span class="count-badge">{{ uploads.length }}</span></h3>
        </div>
        <div class="gallery-grid">
          <div v-for="a in uploads" :key="a.id" class="asset-card glass-card fade-up">
            <img :src="a.url" :alt="''" loading="lazy" />
            <div class="asset-foot">
              <span class="look-label" :title="a.file_name">{{ a.file_name || '参考图' }}</span>
              <button class="asset-dl" @click="downloadAsset(a)">⤓</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <Modal :open="deleteOpen" title="确认删除" @close="deleteOpen = false">
      <p class="confirm-text">确认删除该项目？<b>删除后项目内所有图片将无法恢复。</b></p>
      <template #footer>
        <button class="btn btn-ghost" @click="deleteOpen = false">取消</button>
        <button class="btn btn-danger" @click="confirmDelete">确认删除</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.pd-topnav {
  background: rgba(10, 10, 15, 0.75);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.nav-inner { height: 60px; display: flex; align-items: center; justify-content: space-between; }
.back { font-size: 13px; color: var(--text-3); cursor: pointer; }
.back:hover { color: var(--text-1); }
.top-logo { font-size: 14px; letter-spacing: 2px; color: var(--text-3); }
.top-logo b { color: var(--primary-light); }

.container { padding-bottom: 60px; }

.info-card {
  margin-top: 28px;
  padding: 24px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.info-left h1 { font-size: 24px; margin-bottom: 10px; }
.info-meta { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-3); }
.status-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--success); box-shadow: 0 0 8px var(--success);
}
.info-actions { display: flex; gap: 10px; }

/* Hello 启动页 */
.hello { text-align: center; padding: 54px 0 40px; }
.hello h2 { font-size: 26px; margin-bottom: 10px; }
.hello p { color: var(--text-3); font-size: 14px; margin: 0 0 34px; }
.ref-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.ref-card {
  overflow: hidden; cursor: pointer;
  transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s;
}
.ref-card:hover { transform: translateY(-4px); border-color: rgba(138, 123, 255, 0.45); box-shadow: var(--shadow-hover); }
.ref-card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.ref-card span { display: block; padding: 11px; font-size: 13px; color: var(--text-2); }

/* 创作卡 */
.create-card { margin-top: 26px; padding: 26px; }
.cc-head h3 { font-size: 16px; margin-bottom: 16px; }
.gen-divider { height: 1px; background: var(--line); margin: 22px 0; }
.scene-chips { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.chip {
  padding: 7px 18px; border-radius: 999px; font-size: 13px;
  background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); color: var(--text-3);
  transition: all 0.2s;
}
.chip:hover { color: var(--text-1); }
.chip.on {
  background: rgba(108, 92, 231, 0.18); border-color: rgba(138, 123, 255, 0.5); color: var(--primary-light);
}
.create-card textarea { resize: vertical; min-height: 96px; }
.gen-foot { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
.counter { font-size: 12px; color: var(--text-3); margin-left: auto; }
.counter.over { color: var(--danger); }
.mini-spinner {
  width: 13px; height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spinSlow .8s linear infinite;
}

/* 画廊 */
.gallery { margin-top: 36px; }
.gallery-head { margin-bottom: 16px; }
.gallery-head h3 { font-size: 17px; display: flex; align-items: center; gap: 10px; }
.count-badge {
  font-size: 12px; font-weight: 500;
  min-width: 22px; height: 20px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  background: rgba(138, 123, 255, 0.16); color: var(--primary-light);
}
.gallery-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.asset-card {
  overflow: hidden;
  transition: transform 0.25s, border-color 0.25s;
}
.asset-card:hover { transform: translateY(-4px); border-color: var(--line-bright); }
.asset-card img { width: 100%; aspect-ratio: 4 / 4.4; object-fit: cover; display: block; background: var(--card-2); }
.asset-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 13px;
}
.look-label { font-size: 12px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-dl {
  color: var(--text-3); font-size: 15px;
  width: 26px; height: 26px; border-radius: 50%;
  transition: all 0.15s; flex-shrink: 0;
}
.asset-dl:hover { background: rgba(138, 123, 255, 0.18); color: var(--primary-light); }

.confirm-text { margin: 4px 0; }
.confirm-text b { color: var(--danger); }
</style>
