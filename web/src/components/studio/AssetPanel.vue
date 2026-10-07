<script setup>
import { ref, onMounted, defineComponent, h } from 'vue';
import { api, getToken } from '../../api.js';
import { useStudio } from '../../stores/studio.js';
import { showToast } from '../../toast.js';

const { state, addAssets, removeAsset } = useStudio();

const tabs = [
  { key: 'select', name: '选择素材' },
  { key: 'history', name: '历史上传' },
  { key: 'generated', name: '生成记录' },
  { key: 'personal', name: '个人资产' },
  { key: 'team', name: '团队资产' },
  { key: 'platform', name: '平台资产' },
];
const activeTab = ref('select');
const list = ref([]);
const groups = ref([]);
const keyword = ref('');
const uploading = ref(false);
const fileInput = ref(null);

onMounted(() => loadTab('select'));

async function loadTab(key) {
  activeTab.value = key;
  if (key === 'team' || key === 'platform') return;
  if (key === 'select') return;
  try {
    const q = key === 'personal' && keyword.value.trim() ? `&q=${encodeURIComponent(keyword.value.trim())}` : '';
    const r = await api(`/assets?tab=${key === 'history' ? 'upload' : key === 'generated' ? 'generated' : 'all'}${q}`);
    list.value = r.list;
    groups.value = r.groups;
  } catch (e) {
    showToast(e.message);
  }
}

function isSelected(url) {
  return state.assets.some((a) => a.url === url);
}

function clickItem(item) {
  if (isSelected(item.url)) {
    removeAsset(item.url);
    showToast('已移出画布');
  } else {
    const n = addAssets([{ url: item.url, fileName: item.file_name, width: item.width, height: item.height }]);
    if (n) showToast('已加入画布');
  }
}

function triggerUpload() {
  fileInput.value?.click();
}

async function onFiles(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  uploading.value = true;
  try {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + getToken() },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    addAssets(data.list);
    showToast(`已上传 ${data.list.length} 张并加入画布`);
    if (activeTab.value !== 'select') loadTab(activeTab.value);
  } catch (err) {
    showToast(err.message);
  } finally {
    uploading.value = false;
  }
}

// ---------- 个人资产操作 ----------
async function renameItem(item) {
  const name = window.prompt('重命名素材', item.file_name || '');
  if (name === null) return;
  try {
    await api(`/assets/${item.id}/rename`, 'POST', { fileName: name.trim() });
    showToast('已重命名');
    loadTab('personal');
  } catch (e) { showToast(e.message); }
}
async function moveGroup(item) {
  const g = window.prompt('移动到分组（输入分组名）', item.group_name || '默认分组');
  if (g === null) return;
  try {
    await api(`/assets/${item.id}/group`, 'POST', { group: g.trim() });
    showToast('已移动分组');
    loadTab('personal');
  } catch (e) { showToast(e.message); }
}
async function deleteItem(item) {
  if (!window.confirm('确定从个人资产中移除该素材？（源文件保留）')) return;
  try {
    await api(`/assets/${item.id}`, 'DELETE');
    showToast('已移除');
    loadTab('personal');
  } catch (e) { showToast(e.message); }
}

// 最近上传快速选择（局部内联组件）
const RecentPick = defineComponent({
  name: 'RecentPick',
  props: { isSelected: Function },
  emits: ['pick'],
  setup(props, { emit }) {
    const items = ref([]);
    onMounted(async () => {
      try {
        const r = await api('/assets?tab=upload');
        items.value = r.list.slice(0, 8);
      } catch { /* ignore */ }
    });
    return () =>
      items.value.length
        ? h('div', { class: 'recent-grid' }, items.value.map((it) =>
            h('img', {
              key: it.id,
              src: it.url,
              class: props.isSelected?.(it.url) ? 'picked' : '',
              title: it.file_name,
              onClick: () => emit('pick', it),
            })
          ))
        : h('div', { class: 'empty-tip small' }, '暂无历史上传');
  },
});
</script>

<template>
  <div class="asset-panel">
    <div class="panel-head">
      <span>素材资产</span>
      <button class="upload-btn" :disabled="uploading" @click="triggerUpload">
        {{ uploading ? '上传中…' : '＋ 上传' }}
      </button>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png" multiple hidden @change="onFiles" />
    </div>

    <div class="panel-tabs">
      <button
        v-for="t in tabs" :key="t.key"
        :class="['tab', { active: activeTab === t.key }]"
        @click="loadTab(t.key)"
      >{{ t.name }}</button>
    </div>

    <!-- 选择素材：画布当前素材 -->
    <div v-if="activeTab === 'select'" class="panel-content">
      <div class="mini-title">画布素材（{{ state.assets.length }}）</div>
      <div v-if="!state.assets.length" class="empty-tip">
        暂无素材<br />点击右上角「上传」<br />或从其他标签选择
      </div>
      <div v-for="a in state.assets" :key="a.url" class="asset-card selected" @click="removeAsset(a.url)">
        <img :src="a.url" loading="lazy" />
        <span class="card-name">{{ a.fileName || '未命名素材' }}</span>
        <span class="card-badge">已选 · 点击移除</span>
      </div>

      <div class="mini-title" style="margin-top:14px">最近上传（快速加入）</div>
      <RecentPick @pick="clickItem" :isSelected="isSelected" />
    </div>

    <!-- 预留 Tab -->
    <div v-else-if="activeTab === 'team' || activeTab === 'platform'" class="panel-content">
      <div class="empty-tip reserved">
        {{ activeTab === 'team' ? '团队资产库' : '平台资产库' }}<br />
        <span class="reserved-tag">即将开放 · V1.3</span>
      </div>
    </div>

    <!-- 资产列表 -->
    <div v-else class="panel-content">
      <div v-if="activeTab === 'personal'" class="search-row">
        <input v-model="keyword" placeholder="搜索文件名…" @keyup.enter="loadTab('personal')" />
        <button @click="loadTab('personal')">搜索</button>
      </div>
      <div v-if="!list.length" class="empty-tip">暂无素材</div>
      <div
        v-for="item in list" :key="item.id"
        :class="['asset-card', { selected: isSelected(item.url) }]"
        @click="clickItem(item)"
      >
        <img :src="item.url" loading="lazy" />
        <span class="card-name">{{ item.file_name || '未命名' }}</span>
        <span class="card-meta">
          {{ item.source === 'upload' ? '上传' : 'AI 生成' }} · {{ item.group_name }}
        </span>
        <span v-if="isSelected(item.url)" class="card-badge">已选</span>
        <div v-if="activeTab === 'personal'" class="card-actions" @click.stop>
          <button title="重命名" @click="renameItem(item)">改名</button>
          <button title="分组" @click="moveGroup(item)">分组</button>
          <button title="删除" class="danger" @click="deleteItem(item)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.asset-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(30, 30, 42, 0.4);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 8px;
  font-size: 14px;
  font-weight: 600;
}
.upload-btn {
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  border: none;
  color: #fff;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.upload-btn:disabled { opacity: 0.6; cursor: wait; }
.panel-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
}
.tab {
  background: none;
  border: none;
  color: var(--text-soft, #9ca3af);
  font-size: 12px;
  padding: 7px 8px;
  border-radius: 7px 7px 0 0;
  cursor: pointer;
}
.tab.active {
  color: #fff;
  background: rgba(108, 92, 231, 0.18);
  box-shadow: inset 0 -2px 0 var(--primary-light);
}
.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.mini-title {
  font-size: 12px;
  color: var(--text-soft, #9ca3af);
  margin-bottom: 8px;
}
.empty-tip {
  color: #6b7280;
  font-size: 12px;
  line-height: 2;
  text-align: center;
  padding: 24px 0;
}
.empty-tip.small { padding: 8px 0; }
.reserved { font-size: 14px; color: var(--gold); }
.reserved-tag { font-size: 12px; color: #6b7280; }
.asset-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 10px;
  border: 1px solid var(--line);
  cursor: pointer;
  background: #23232f;
  transition: border-color 0.2s, transform 0.15s;
}
.asset-card:hover { border-color: var(--line-bright); transform: translateY(-1px); }
.asset-card.selected { border-color: var(--primary-light); box-shadow: 0 0 0 1px rgba(138,123,255,0.4); }
.asset-card img {
  width: 100%;
  height: 110px;
  object-fit: cover;
  display: block;
}
.card-name {
  display: block;
  font-size: 12px;
  padding: 6px 8px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-meta {
  display: block;
  font-size: 11px;
  color: #6b7280;
  padding: 2px 8px 8px;
}
.card-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(108, 92, 231, 0.9);
  color: #fff;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 6px;
}
.card-actions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 4px;
  padding: 6px;
  background: linear-gradient(transparent, rgba(0,0,0,0.75));
  opacity: 0;
  transition: opacity 0.15s;
}
.asset-card:hover .card-actions { opacity: 1; }
.card-actions button {
  flex: 1;
  font-size: 11px;
  background: rgba(255,255,255,0.12);
  border: none;
  color: #fff;
  padding: 4px 0;
  border-radius: 6px;
  cursor: pointer;
}
.card-actions button.danger { background: rgba(255,107,107,0.7); }
.search-row { display: flex; gap: 6px; margin-bottom: 12px; }
.search-row input {
  flex: 1;
  background: #23232f;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: #fff;
  font-size: 12px;
  padding: 6px 10px;
  outline: none;
}
.search-row button {
  background: var(--primary);
  border: none;
  color: #fff;
  font-size: 12px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: pointer;
}
</style>

<!-- RecentPick 为 h() 渲染的子组件，scoped 样式无法到达其内部，需使用非作用域样式 -->
<style>
.recent-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.recent-grid img {
  width: 100%;
  height: 56px;
  object-fit: contain;
  background: #f6f6f8;
  border-radius: 8px;
  border: 1px solid var(--line, #2e2e3d);
  cursor: pointer;
}
.recent-grid img.picked { border-color: #8a7bff; box-shadow: 0 0 0 1px #8a7bff; }
</style>
