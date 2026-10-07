<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, track } from '../api.js';
import { showToast } from '../toast.js';
import Modal from '../components/Modal.vue';
import ImageUploader from '../components/ImageUploader.vue';
import AiGenerating from '../components/AiGenerating.vue';
import AiResultPanel from '../components/AiResultPanel.vue';
import { MAX_PROMPT } from '../components/limits.js';

const router = useRouter();

// ---------- 视图状态 ----------
const view = ref('work'); // work / generating / result
const tab = ref('project');
let pollTimer = null;

// ---------- 项目模式 ----------
const projects = ref([]);
const createOpen = ref(false);
const newName = ref('');
const newScene = ref('');
const deleteTarget = ref(null);

const modules = [
  { key: 'fashion_design', name: '服装设计', hint: '上传线稿 / 款式图，生成新款效果图', icon: '✦' },
  { key: 'print_design', name: '印花设计', hint: '上传图案参考，生成服饰可用印花', icon: '❖' },
  { key: 'fabric_apply', name: '面料应用', hint: '上传服装图 + 面料图，套版出实物效果', icon: '◈' },
  { key: 'tech_pack', name: '生成工艺单', hint: '上传款式图，一键生成工艺素材包', icon: '❋' },
];

// ---------- 对话模式 ----------
const dialogImages = ref([]);
const prompt = ref('');
const appliedKey = ref('');
const templates = ref([]);
const taskDbId = ref(0);
const results = ref([]);

onMounted(async () => {
  track('enter_design_workbench');
  loadProjects();
  try {
    const r = await api('/ai/templates');
    templates.value = r.list;
  } catch {}
});

onUnmounted(() => stopPolling());

async function loadProjects() {
  try {
    const r = await api('/projects');
    projects.value = r.list;
  } catch (e) {
    showToast(e.message);
  }
}

function switchTab(t) {
  if (tab.value === t) return;
  tab.value = t;
  track('tab_switch_project_dialog', { tab: t });
}

// ---------- 项目创建 / 删除 ----------
function openCreate(scene = '') {
  newScene.value = scene;
  newName.value = '';
  createOpen.value = true;
}

async function confirmCreate() {
  if (!newName.value.trim()) return showToast('请输入项目名称');
  try {
    const r = await api('/projects', 'POST', { name: newName.value.trim(), scene: newScene.value });
    track('create_new_project', { scene: newScene.value, project_id: r.id });
    createOpen.value = false;
    router.push(`/project/${r.id}`);
  } catch (e) {
    showToast(e.message);
  }
}

function askDelete(p) {
  deleteTarget.value = p;
}

async function confirmDelete() {
  const p = deleteTarget.value;
  try {
    await api(`/projects/${p.id}`, 'DELETE');
    showToast('项目已删除', 'success');
    await loadProjects();
  } catch (e) {
    showToast(e.message);
  } finally {
    deleteTarget.value = null;
  }
}

// ---------- 模板 ----------
function applyTemplate(t) {
  prompt.value = t.prompt;
  appliedKey.value = t.key;
  track('click_scene_template', { scene: t.key });
}

// ---------- 提交生成 ----------
async function submitDialog() {
  if (dialogImages.value.length === 0) return showToast('请先上传参考图片');
  if (dialogImages.value.some((x) => x.uploading)) return showToast('图片仍在上传，请稍候');
  if (!prompt.value.trim()) return showToast('请输入设计提示词');
  try {
    const r = await api('/ai/tasks', 'POST', {
      scene: appliedKey.value || 'fashion_design',
      prompt: prompt.value.trim(),
      images: dialogImages.value.map((x) => ({ url: x.url, fileName: x.fileName })),
      projectId: 0,
    });
    track('submit_ai_task', { scene: appliedKey.value || 'fashion_design' });
    taskDbId.value = r.taskDbId;
    view.value = 'generating';
    startPolling(r.taskDbId);
  } catch (e) {
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
        results.value = r.results;
        view.value = 'result';
        track('ai_task_success');
      } else if (r.status === 'failed') {
        stopPolling();
        view.value = 'work';
        track('ai_task_fail', { reason: r.errorCode });
        showToast(r.error || '生成失败，请重试');
      }
    } catch (e) {
      stopPolling();
      view.value = 'work';
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

function retryEdit() {
  view.value = 'work';
  tab.value = 'dialog';
}
</script>

<template>
  <div class="wb-page">
    <header class="wb-topnav">
      <div class="container nav-inner">
        <span class="back" @click="router.push('/')">← 帛序 AI 首页</span>
        <span class="top-logo">帛序 <b>AI</b></span>
      </div>
    </header>

    <!-- 工作视图 -->
    <template v-if="view === 'work'">
      <div class="container hero">
        <h1>欢迎使用设计生产工作台</h1>
        <p>让创意落地，让生产有序</p>
      </div>

      <div class="container">
        <div class="tab-switch">
          <button :class="{ on: tab === 'project' }" @click="switchTab('project')">从项目开始</button>
          <button :class="{ on: tab === 'dialog' }" @click="switchTab('dialog')">从对话开始</button>
        </div>

        <!-- Tab 1：从项目开始 -->
        <div v-if="tab === 'project'" class="tab-pane fade-in">
          <div class="module-grid">
            <div v-for="m in modules" :key="m.key" class="module-card glass-card" @click="openCreate(m.key)">
              <span class="m-icon">{{ m.icon }}</span>
              <h3>{{ m.name }}</h3>
              <p>{{ m.hint }}</p>
              <span class="m-go">开始 →</span>
            </div>
          </div>

          <div class="proj-head">
            <h2>我的项目</h2>
            <div style="display:flex;gap:10px">
              <button class="btn btn-primary" @click="router.push('/studio')">✨ 新版专业工作台</button>
              <button class="btn btn-ghost" @click="openCreate()">＋ 新建项目</button>
            </div>
          </div>

          <div v-if="projects.length === 0" class="empty-state">
            <div class="empty-icon">◇</div>
            <p class="empty-main">暂无项目，从一个灵感开始</p>
            <p class="empty-sub">上传线稿、款式图、图案或面料图，快速生成第一款设计</p>
          </div>

          <div v-else class="project-grid">
            <div v-for="p in projects" :key="p.id" class="project-card glass-card" @click="router.push(`/project/${p.id}`)">
              <div class="pc-cover">
                <img v-if="p.cover" :src="p.cover" alt="" />
                <span v-else class="pc-placeholder">◈</span>
              </div>
              <div class="pc-info">
                <div class="pc-name">{{ p.name }}</div>
                <div class="pc-meta">
                  <span v-if="p.scene_name" class="tag">{{ p.scene_name }}</span>
                  <span class="pc-date">{{ p.created_label }}</span>
                </div>
              </div>
              <button class="pc-del" title="删除项目" @click.stop="askDelete(p)">✕</button>
            </div>
          </div>
        </div>

        <!-- Tab 2：从对话开始 -->
        <div v-else class="tab-pane fade-in">
          <div class="dialog-card glass-card">
            <ImageUploader v-model="dialogImages" />

            <div v-if="appliedKey" class="applied-tag">
              <span class="tag">已应用模板：{{ templates.find((t) => t.key === appliedKey)?.name }}</span>
              <button @click="appliedKey = ''">✕</button>
            </div>

            <div class="prompt-area">
              <textarea v-model="prompt" class="field prompt-input" maxlength="4000"
                placeholder="描述你的设计想法，例如：基于线稿生成燕麦色长款风衣，保留原版型，面料为羊绒质感…"></textarea>
              <div class="prompt-foot">
                <span :class="{ over: prompt.length >= MAX_PROMPT }">{{ prompt.length }} / {{ MAX_PROMPT }}</span>
                <button class="btn btn-primary" @click="submitDialog">✦ 生成设计</button>
              </div>
            </div>
          </div>

          <div class="tpl-head">
            <h3>从下方选择一个设计场景试试</h3>
          </div>
          <div class="tpl-row">
            <div v-for="t in templates" :key="t.key" class="tpl-card glass-card"
              :class="{ active: appliedKey === t.key }" @click="applyTemplate(t)">
              <h4>{{ t.name }}</h4>
              <p>{{ t.desc }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 生成中 -->
    <div v-else-if="view === 'generating'" class="container">
      <AiGenerating />
    </div>

    <!-- 结果页 -->
    <div v-else class="container result-view">
      <div class="result-head">
        <h1>AI 生成结果</h1>
        <p>选择你喜欢的方向，保存到项目继续深化</p>
      </div>
      <AiResultPanel :results="results" :task-db-id="taskDbId" @retry="retryEdit" />
    </div>

    <!-- 新建项目弹窗 -->
    <Modal :open="createOpen" :title="newScene ? `新建 · ${modules.find((m) => m.key === newScene)?.name || ''}项目` : '新建项目'"
      @close="createOpen = false">
      <p class="modal-tip">为你的灵感项目起个名字，创建后即可上传参考图开始设计</p>
      <input v-model="newName" class="field" maxlength="50" autofocus
        placeholder="例如：2026 春夏女装系列" @keyup.enter="confirmCreate" />
      <template #footer>
        <button class="btn btn-ghost" @click="createOpen = false">取消</button>
        <button class="btn btn-primary" @click="confirmCreate">创建并开始</button>
      </template>
    </Modal>

    <!-- 删除确认 -->
    <Modal :open="!!deleteTarget" title="确认删除" @close="deleteTarget = null">
      <p class="confirm-text">确认删除该项目？<b>删除后项目内所有图片将无法恢复。</b></p>
      <template #footer>
        <button class="btn btn-ghost" @click="deleteTarget = null">取消</button>
        <button class="btn btn-danger" @click="confirmDelete">确认删除</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.wb-topnav {
  background: rgba(10, 10, 15, 0.75);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.nav-inner {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.back { font-size: 13px; color: var(--text-3); cursor: pointer; transition: color 0.2s; }
.back:hover { color: var(--text-1); }
.top-logo { font-size: 14px; letter-spacing: 2px; color: var(--text-3); }
.top-logo b { color: var(--primary-light); }

.hero { padding: 54px 28px 26px; text-align: center; }
.hero h1 { font-size: 32px; margin-bottom: 10px; letter-spacing: 1px; }
.hero p { color: var(--text-3); font-size: 15px; margin: 0; letter-spacing: 3px; }

.tab-switch {
  display: inline-flex;
  gap: 4px;
  padding: 5px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  margin: 14px auto 30px;
  position: relative;
  left: 50%;
  transform: translateX(-50%);
}
.tab-switch button {
  padding: 9px 28px;
  border-radius: 999px;
  font-size: 14px;
  color: var(--text-3);
  transition: all 0.25s;
}
.tab-switch button.on {
  background: linear-gradient(135deg, var(--primary), var(--primary-light));
  color: #fff;
  box-shadow: 0 0 16px rgba(108, 92, 231, 0.4);
}

/* 功能卡 */
.module-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
  margin-bottom: 46px;
}
.module-card {
  position: relative;
  padding: 24px 22px;
  cursor: pointer;
  transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s;
  overflow: hidden;
}
.module-card:hover { transform: translateY(-4px); border-color: rgba(138, 123, 255, 0.4); box-shadow: var(--shadow-hover); }
.module-card::after {
  content: '';
  position: absolute;
  top: -50px; right: -40px;
  width: 130px; height: 130px;
  background: radial-gradient(circle, rgba(108, 92, 231, 0.25), transparent 70%);
  border-radius: 50%;
}
.m-icon {
  font-size: 22px;
  color: var(--primary-light);
  display: block;
  margin-bottom: 14px;
}
.module-card h3 { font-size: 16px; margin-bottom: 8px; }
.module-card p { font-size: 12.5px; color: var(--text-3); margin: 0 0 14px; min-height: 38px; }
.m-go { font-size: 12px; color: var(--primary-light); }

/* 项目区 */
.proj-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.proj-head h2 { font-size: 20px; }

.empty-state { text-align: center; padding: 70px 20px; border: 1px dashed var(--line); border-radius: var(--radius-card); }
.empty-icon { font-size: 42px; color: var(--primary); opacity: 0.6; margin-bottom: 16px; }
.empty-main { font-size: 16px; color: var(--text-1); margin: 0 0 8px; font-weight: 600; }
.empty-sub { font-size: 13px; color: var(--text-3); margin: 0; }

.project-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
  padding-bottom: 50px;
}
.project-card {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s;
}
.project-card:hover { transform: translateY(-4px); border-color: var(--line-bright); box-shadow: var(--shadow-hover); }
.pc-cover { aspect-ratio: 4 / 3; overflow: hidden; background: var(--card-2); }
.pc-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s; }
.project-card:hover .pc-cover img { transform: scale(1.05); }
.pc-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 34px; color: var(--text-3); opacity: 0.4;
}
.pc-info { padding: 13px 15px 15px; }
.pc-name { font-size: 14px; font-weight: 600; color: var(--text-1); margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-meta { display: flex; align-items: center; gap: 8px; }
.pc-date { font-size: 11.5px; color: var(--text-3); }
.pc-del {
  position: absolute;
  top: 10px; right: 10px;
  width: 26px; height: 26px;
  border-radius: 50%;
  background: rgba(10, 10, 15, 0.55);
  color: var(--text-3);
  font-size: 11px;
  opacity: 0;
  transition: all 0.2s;
}
.project-card:hover .pc-del { opacity: 1; }
.pc-del:hover { background: rgba(255, 107, 107, 0.85); color: #fff; }

/* 对话卡 */
.dialog-card { padding: 26px; }
.applied-tag { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.applied-tag button { color: var(--text-3); font-size: 12px; }
.applied-tag button:hover { color: var(--danger); }

.prompt-area { margin-top: 16px; }
.prompt-input { resize: vertical; min-height: 120px; line-height: 1.7; }
.prompt-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.prompt-foot span { font-size: 12px; color: var(--text-3); }
.prompt-foot span.over { color: var(--danger); }

.tpl-head { margin: 38px 0 16px; }
.tpl-head h3 { font-size: 15px; color: var(--text-2); font-weight: 600; }
.tpl-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; padding-bottom: 60px; }
.tpl-card { padding: 18px 16px; cursor: pointer; transition: all 0.25s; }
.tpl-card:hover { transform: translateY(-4px); border-color: rgba(138, 123, 255, 0.4); }
.tpl-card.active { border-color: rgba(138, 123, 255, 0.6); box-shadow: 0 0 0 1px rgba(138, 123, 255, 0.35); }
.tpl-card h4 { font-size: 14px; margin-bottom: 6px; color: var(--text-1); }
.tpl-card p { font-size: 12px; color: var(--text-3); margin: 0; }

.modal-tip { color: var(--text-3); font-size: 13px; margin: 0 0 14px; }
.confirm-text { margin: 4px 0; }
.confirm-text b { color: var(--danger); }

.result-view { padding-bottom: 50px; }
.result-head { text-align: center; padding: 50px 0 34px; }
.result-head h1 { font-size: 30px; margin-bottom: 10px; }
.result-head p { color: var(--text-3); margin: 0; }
</style>
