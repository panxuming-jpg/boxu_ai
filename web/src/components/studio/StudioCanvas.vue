<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, getToken } from '../../api.js';
import { useStudio } from '../../stores/studio.js';
import { showToast } from '../../toast.js';

const {
  state, canUndo, canRedo, undo, redo, selectLayer,
  removeLayer, setFunction, runFlow,
} = useStudio();

const modules = ref([]);
const functions = ref([]);
const instruction = ref('');
const showOptions = ref(false);
const showLayers = ref(false);

// 创作对话框：选中功能后弹出，集中输入提示词与图片参数
const showDialog = ref(false);
const showParams = ref(false);
const dialogPrompt = ref('');
const aspect = ref('智能'); // 智能=跟随参考图
const sizeTier = ref('1.5K');
const genCount = ref(1);
const RATIOS = ['智能', '2:3', '3:4', '4:5', '9:16', '1:1', '3:2', '4:3', '5:4', '16:9', '21:9'];
const TIERS = ['1K', '1.5K', '2K', '4K'];

// 本地工具选项
const cropRatio = ref('1:1');
const expandRatio = ref('16:9');
const expandDir = ref('四周');

onMounted(async () => {
  try {
    const r = await api('/ai/catalog');
    modules.value = r.modules;
    functions.value = r.functions;
  } catch (e) { showToast(e.message); }
});

const currentFunctions = computed(() => functions.value.filter((f) => f.module === state.activeModule));
const currentFn = computed(() => functions.value.find((f) => f.key === state.activeFn));

// 各功能的建议提示词：选中功能时自动填入，可直接确认或修改后执行
const SUGGEST_PROMPTS = {
  quick_edit: '去除背景，替换为纯白背景',
  style_partial: '把袖子改为泡泡袖，其余部分保持不变',
  print_on_garment: '在胸前位置加入精致的花朵刺绣印花',
  fabric_replace: '将面料替换为粗花呢材质，保持版型不变',
  color_change: '将服装主色改为雾霾蓝色',
  ai_tryon: '让模特自然穿着这件服装，正面全身展示',
  to_3d_flat: '转换为正面平铺图，纯白背景',
  multi_view: '保持版型与细节完全一致',
  style_derivation: '保持廓形，衍生同系列新配色版本',
  print_design: '设计一款复古几何纹样印花',
  style_transfer: '将参考图的艺术风格迁移到服装上',
  seamless_tile: '生成可无缝拼接的四方连续图案',
  fabric_apply: '将该面料自然套用到服装上',
  fabric_create: '设计一款有肌理感的针织面料纹理',
  fabric_color: '把面料颜色改为酒红色',
  sketch_to_real: '生成写实成衣效果，浅灰背景',
  real_to_sketch: '转换为清晰的设计线稿',
  vector_convert: '转换为干净的矢量风格线稿',
  tech_pack: '',
  hd_upscale: '',
  remove_bg: '',
  smart_cutout: '',
  smart_crop: '',
  ai_expand: '',
  ai_erase: '消除画面中多余的元素',
};

function applySuggest(key) {
  dialogPrompt.value = SUGGEST_PROMPTS[key] || '';
}

function chooseModule(key) {
  state.activeModule = key;
  const first = functions.value.find((f) => f.module === key);
  if (first) {
    setFunction(first.key, key);
    openDialog(first.key);
  }
  showOptions.value = false;
}
function chooseFn(f) {
  setFunction(f.key, f.module);
  openDialog(f.key);
  showOptions.value = false;
}

// 打开创作对话框（需先选择素材）
function openDialog(fnKey) {
  if (!state.assets.length) {
    showToast('请先选择素材图片');
    return;
  }
  applySuggest(fnKey);
  showParams.value = false;
  showDialog.value = true;
}

const dialogPlaceholder = computed(() => {
  const fn = currentFn.value;
  if (!fn) return '';
  return fn.needInstruction
    ? `输入你的创作需求，如：${fn.hint || '面料要求、颜色要求、质感要求等'}`
    : `可补充需求（选填），如：${fn.hint || '背景、风格、角度等'}`;
});
const dialogCredits = computed(() => {
  const fn = currentFn.value;
  if (!fn) return '';
  if (fn.local) return '即时处理 · 不耗积分';
  const total = fn.credits * genCount.value;
  return `${total} 积分 · ${fn.credits}/张`;
});

// 对话框打开时画布内容整体上移，避免被底部面板遮挡
const dialogLift = computed(() => (showDialog.value ? 130 : 0));

async function executeDialog() {
  if (state.running) return;
  showOptions.value = false;
  showDialog.value = false;
  try {
    await runFlow({
      prompt: dialogPrompt.value.trim(),
      opts: { ...buildOpts(), aspect: aspect.value, sizeTier: sizeTier.value, count: genCount.value },
      source: 'canvas',
    });
    instruction.value = '';
    showToast('生成完成');
  } catch (e) {
    showToast(e.message);
  }
}

function buildOpts() {
  if (state.activeFn === 'smart_crop') return { ratio: cropRatio.value };
  if (state.activeFn === 'ai_expand') {
    return { ratioLabel: `${expandRatio.value} ratio`, directionsLabel: expandDir.value };
  }
  return {};
}

async function execute() {
  if (state.running) return;
  showOptions.value = false;
  try {
    await runFlow({ prompt: instruction.value.trim(), opts: buildOpts(), source: 'canvas' });
    instruction.value = '';
    showToast('生成完成');
  } catch (e) {
    showToast(e.message);
  }
}

// ---------- 画布缩放 / 平移 ----------
function zoomBy(delta) {
  state.zoom = Math.min(3, Math.max(0.3, Math.round((state.zoom + delta) * 100) / 100));
}
function zoomReset() {
  state.zoom = 1;
  state.pan = { x: 0, y: 0 };
}
let dragging = false;
let dragStart = null;
function onStageDown(e) {
  if (e.target.closest('.canvas-tile')) return;
  dragging = true;
  dragStart = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
}
function onStageMove(e) {
  if (!dragging) return;
  state.pan = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y };
}
function onStageUp() { dragging = false; }

// ---------- 图层管理 ----------
function moveLayer(index, dir) {
  const arr = state.layers;
  const j = index + dir;
  if (j < 0 || j >= arr.length) return;
  const t = arr[index];
  arr[index] = arr[j];
  arr[j] = t;
}
function continueEdit(layer) {
  selectLayer(layer.id);
  showToast(`已选中「${layer.label}」，可直接输入需求继续编辑`);
}

// ---------- 下载 / 导出 ----------
async function authedFetch(path) {
  const res = await fetch(path, { headers: { authorization: 'Bearer ' + getToken() } });
  if (!res.ok) throw new Error('下载失败');
  return res;
}
async function downloadOne(layer) {
  try {
    const res = await authedFetch(`/api/download?url=${encodeURIComponent(layer.url)}&name=${encodeURIComponent(layer.label)}.png`);
    const blob = await res.blob();
    triggerBlob(blob, `${layer.label}.png`);
  } catch (e) { showToast(e.message); }
}
function triggerBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportZip(urls, name = '帛序AI-批量导出') {
  if (!urls.length) return showToast('请选择要导出的图片');
  try {
    const res = await fetch('/api/ai/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ urls, name }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || '导出失败');
    }
    triggerBlob(await res.blob(), `${name}.zip`);
    showToast('导出成功');
  } catch (e) { showToast(e.message); }
}
function exportAll() {
  exportZip(state.layers.map((l) => l.url));
}
function exportResults() {
  const urls = state.layers.filter((l) => l.kind === 'result').map((l) => l.url);
  exportZip(urls, '帛序AI-AI生成图');
}
</script>

<template>
  <div class="canvas-wrap">
    <!-- 模块与功能栏 -->
    <div class="module-bar">
      <button
        v-for="m in modules" :key="m.key"
        :class="['module-tab', { active: state.activeModule === m.key }]"
        @click="chooseModule(m.key)"
      >
        <span class="m-icon">{{ m.icon }}</span>{{ m.name }}
      </button>
    </div>
    <div class="function-bar">
      <button
        v-for="f in currentFunctions" :key="f.key"
        :class="['fn-chip', { active: state.activeFn === f.key }]"
        @click="chooseFn(f)"
      >
        {{ f.name }}
        <span class="fn-credit">{{ f.local ? '即时' : `${f.credits}积分` }}</span>
      </button>
    </div>

    <!-- 指令行 -->
    <div class="instruction-row">
      <span class="fn-hint">{{ currentFn?.hint || '' }}</span>
      <div class="instruction-box">
        <textarea
          v-model="instruction"
          rows="1"
          :placeholder="currentFn?.needInstruction ? '描述你的编辑需求，回车执行…' : '可补充需求（选填），直接点击执行即可…'"
          @keydown.enter.exact.prevent="execute"
        ></textarea>
        <button v-if="currentFn?.key === 'smart_crop' || currentFn?.key === 'ai_expand'"
          class="opts-btn" @click="showOptions = !showOptions">参数</button>
        <button class="exec-btn" :disabled="state.running || !state.assets.length" @click="execute">
          {{ state.running ? '执行中…' : '执 行' }}
        </button>
      </div>

      <!-- 本地工具参数 -->
      <div v-if="showOptions" class="opts-pop">
        <template v-if="state.activeFn === 'smart_crop'">
          <span>裁剪比例：</span>
          <button v-for="r in ['1:1','3:4','4:3','16:9']" :key="r"
            :class="{ on: cropRatio === r }" @click="cropRatio = r">{{ r }}</button>
        </template>
        <template v-else>
          <div class="opts-line"><span>目标比例：</span>
            <button v-for="r in ['4:3','16:9','9:16']" :key="r"
              :class="{ on: expandRatio === r }" @click="expandRatio = r">{{ r }}</button>
          </div>
          <div class="opts-line"><span>扩展方向：</span>
            <button v-for="d in ['四周','上方','下方','左侧','右侧']" :key="d"
              :class="{ on: expandDir === d }" @click="expandDir = d">{{ d }}</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 创作对话框：提示词 + 图片参数（底部悬浮，不遮挡画布图片） -->
    <div v-if="showDialog && currentFn" class="dlg">
        <div class="dlg-head">
          <span class="dlg-title">{{ currentFn.name }}</span>
          <span class="dlg-credit">{{ dialogCredits }}</span>
          <button class="dlg-x" @click="showDialog = false">✕</button>
        </div>

        <div class="dlg-materials">
          <div v-for="a in state.assets" :key="a.url" class="dlg-mat">
            <img :src="a.url" />
          </div>
          <span class="dlg-mat-tip">已选 {{ state.assets.length }} 张素材</span>
        </div>

        <textarea
          v-model="dialogPrompt"
          class="dlg-input"
          rows="2"
          :placeholder="dialogPlaceholder"
          @keydown.enter.exact.prevent="executeDialog"
        ></textarea>

        <!-- 本地工具参数（裁剪/扩图） -->
        <div v-if="currentFn.key === 'smart_crop'" class="dlg-line">
          <span class="dlg-line-label">裁剪比例</span>
          <button v-for="r in ['1:1','3:4','4:3','16:9']" :key="r"
            :class="['pill', { on: cropRatio === r }]" @click="cropRatio = r">{{ r }}</button>
        </div>
        <div v-else-if="currentFn.key === 'ai_expand'" class="dlg-line">
          <span class="dlg-line-label">扩图比例</span>
          <button v-for="r in ['4:3','16:9','9:16']" :key="r"
            :class="['pill', { on: expandRatio === r }]" @click="expandRatio = r">{{ r }}</button>
          <span class="dlg-line-label" style="margin-left:10px">方向</span>
          <button v-for="d in ['四周','上方','下方','左侧','右侧']" :key="d"
            :class="['pill', { on: expandDir === d }]" @click="expandDir = d">{{ d }}</button>
        </div>

        <div class="dlg-foot">
          <button class="param-bar" @click="showParams = !showParams">
            <span>🖼 {{ aspect === '智能' ? '智能' : aspect }}</span>
            <i></i>
            <span>{{ sizeTier }}</span>
            <i></i>
            <span>{{ genCount }} 张</span>
            <span class="param-caret" :class="{ up: showParams }">⌄</span>
          </button>
          <button class="dlg-exec" :disabled="state.running" @click="executeDialog">
            {{ state.running ? '生成中…' : '✦ 立即生成' }}
          </button>
        </div>

        <!-- 图片参数面板 -->
        <div v-if="showParams" class="param-panel">
          <div class="pp-row">
            <span class="pp-label">图片比例</span>
            <div class="pp-opts">
              <button v-for="r in RATIOS" :key="r"
                :class="['pill', { on: aspect === r }]" @click="aspect = r">{{ r }}</button>
            </div>
          </div>
          <div class="pp-row">
            <span class="pp-label">清晰度</span>
            <div class="pp-opts">
              <button v-for="t in TIERS" :key="t"
                :class="['pill', { on: sizeTier === t }]" @click="sizeTier = t">{{ t }}</button>
            </div>
          </div>
          <div class="pp-row">
            <span class="pp-label">生成数量</span>
            <div class="pp-opts">
              <button v-for="n in [1, 2, 3, 4]" :key="n"
                :class="['pill', { on: genCount === n }]" @click="genCount = n">{{ n }} 张</button>
            </div>
          </div>
        </div>
    </div>

    <!-- 三阶段可视化 -->
    <div v-if="state.flow" class="flow-panel">
      <div :class="['flow-stage', { done: ['plan','execute'].includes(state.flow.stage) }]">
        <span class="flow-no">1</span> 素材分析
        <span class="flow-state">{{ ['plan','execute'].includes(state.flow.stage) ? '✓' : '分析中…' }}</span>
      </div>
      <span class="flow-arrow">→</span>
      <div :class="['flow-stage', { done: state.flow.stage === 'execute' }]">
        <span class="flow-no">2</span> 生成计划
        <span class="flow-state">{{ state.flow.stage === 'plan' ? '规划中…' : state.flow.stage === 'execute' ? '✓' : '' }}</span>
      </div>
      <span class="flow-arrow">→</span>
      <div class="flow-stage active">
        <span class="flow-no">3</span> 执行播报
        <span class="flow-state">{{ state.flow.finished }}/{{ state.flow.total }}</span>
      </div>
      <div class="flow-plan">
        <span v-for="(s, i) in state.flow.planSteps" :key="i"
          :class="['plan-pill', { done: i < state.flow.finished }]">
          {{ i < state.flow.finished ? '✓ ' : '' }}{{ s.label }}
        </span>
      </div>
      <div v-if="state.flow.stage === 'execute'" class="flow-status">
        <span class="status-dot"></span>
        <template v-if="state.flow.phase === 'queued'">排队中（第 {{ state.flow.queuePos }} 位），完成后自动开始</template>
        <template v-else-if="state.flow.phase === 'preparing'">素材准备中…</template>
        <template v-else-if="state.flow.phase === 'generating'">正在生成：{{ state.flow.outputLabel || '处理中' }}</template>
        <template v-else>结果处理中…</template>
        <span class="flow-elapsed">已耗时 {{ state.flow.elapsed }}s</span>
      </div>
    </div>

    <!-- 画布视口 -->
    <div
      class="viewport"
      @mousedown="onStageDown"
      @mousemove="onStageMove"
      @mouseup="onStageUp"
      @mouseleave="onStageUp"
    >
      <div v-if="!state.layers.length" class="canvas-empty">
        <div class="empty-logo">✦</div>
        <p>智能画布已就绪</p>
        <span>从左侧上传或选择素材，选择上方功能后点击「执行」</span>
      </div>
      <div
        class="stage"
        :style="{ transform: `translate(calc(-50% + ${state.pan.x}px), calc(-50% + ${state.pan.y - dialogLift}px)) scale(${state.zoom})` }"
      >
        <div
          v-for="layer in state.layers" :key="layer.id"
          :class="['canvas-tile', { selected: state.selectedLayerId === layer.id }]"
          @click.stop="selectLayer(layer.id)"
        >
          <img :src="layer.url" draggable="false" />
          <div class="tile-bar">
            <span class="tile-label">{{ layer.label }}</span>
            <span class="tile-kind">{{ layer.kind === 'result' ? 'AI' : '素材' }}</span>
          </div>
          <div class="tile-actions">
            <button title="下载" @click.stop="downloadOne(layer)">下载</button>
            <button title="继续编辑" @click.stop="continueEdit(layer)">续编</button>
            <button title="删除" class="danger" @click.stop="removeLayer(layer.id)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部工具栏 -->
    <div class="canvas-toolbar">
      <div class="tb-group">
        <button :disabled="!canUndo.value" @click="undo" title="撤销">↶</button>
        <button :disabled="!canRedo.value" @click="redo" title="重做">↷</button>
      </div>
      <div class="tb-group">
        <button @click="zoomBy(-0.1)" title="缩小">－</button>
        <span class="zoom-val" @click="zoomReset">{{ Math.round(state.zoom * 100) }}%</span>
        <button @click="zoomBy(0.1)" title="放大">＋</button>
      </div>
      <div class="tb-spacer"></div>
      <button class="tb-text" @click="showLayers = !showLayers">图层</button>
      <button class="tb-text" @click="exportResults">导出AI图</button>
      <button class="tb-text primary" @click="exportAll">批量导出 ZIP</button>
    </div>

    <!-- 图层管理浮层 -->
    <div v-if="showLayers" class="layers-panel">
      <div class="layers-head">图层管理（{{ state.layers.length }}）<span @click="showLayers = false">✕</span></div>
      <div v-if="!state.layers.length" class="layers-empty">暂无图层</div>
      <div
        v-for="(layer, i) in [...state.layers].reverse()" :key="layer.id"
        :class="['layer-row', { on: state.selectedLayerId === layer.id }]"
        @click="selectLayer(layer.id)"
      >
        <img :src="layer.url" />
        <span class="layer-name">{{ layer.label }}</span>
        <button title="上移" @click.stop="moveLayer(state.layers.length - 1 - i, 1)">↑</button>
        <button title="下移" @click.stop="moveLayer(state.layers.length - 1 - i, -1)">↓</button>
        <button title="删除" class="danger" @click.stop="removeLayer(layer.id)">✕</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg, #14141d);
  position: relative;
}
.module-bar {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
  flex-shrink: 0;
}
.module-tab {
  background: none;
  border: 1px solid transparent;
  color: var(--text-soft, #9ca3af);
  font-size: 12.5px;
  padding: 6px 12px;
  border-radius: 9px 9px 0 0;
  cursor: pointer;
}
.module-tab .m-icon { margin-right: 5px; opacity: 0.8; }
.module-tab.active {
  color: #fff;
  background: rgba(108, 92, 231, 0.14);
  border-color: var(--line);
}
.function-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.fn-chip {
  background: #20202c;
  border: 1px solid var(--line);
  color: #d1d5db;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.fn-chip.active { border-color: var(--primary-light); background: rgba(108,92,231,0.18); color: #fff; }
.fn-credit { font-size: 10px; color: var(--gold); }
.instruction-row {
  padding: 10px 14px 0;
  flex-shrink: 0;
  position: relative;
}
.fn-hint { font-size: 11.5px; color: #6b7280; }
.instruction-box { display: flex; gap: 8px; margin-top: 6px; }
.instruction-box textarea {
  flex: 1;
  resize: none;
  background: #20202c;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: #fff;
  font-size: 13px;
  padding: 9px 12px;
  outline: none;
  font-family: inherit;
  max-height: 90px;
}
.instruction-box textarea:focus { border-color: var(--primary-light); }
.opts-btn, .exec-btn {
  border: none;
  border-radius: 10px;
  font-size: 13px;
  cursor: pointer;
  padding: 0 16px;
}
.opts-btn { background: #2c2c3c; color: var(--gold); }
.exec-btn {
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  color: #fff;
  font-weight: 600;
  padding: 0 26px;
}
.exec-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.opts-pop {
  position: absolute;
  z-index: 20;
  right: 14px;
  top: 64px;
  background: #23232f;
  border: 1px solid var(--line-bright);
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  font-size: 12px;
}
.opts-line { display: flex; align-items: center; gap: 5px; margin: 4px 0; }
.opts-pop button {
  background: #2c2c3c;
  border: 1px solid var(--line);
  color: #d1d5db;
  border-radius: 7px;
  font-size: 11px;
  padding: 4px 9px;
  cursor: pointer;
}
.opts-pop button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.flow-panel {
  margin: 10px 14px 0;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(138,123,255,0.3);
  background: linear-gradient(135deg, rgba(108,92,231,0.1), rgba(30,30,42,0.4));
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}
.flow-stage {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-soft, #9ca3af);
}
.flow-stage.active { color: #fff; }
.flow-stage.done { color: var(--success); }
.flow-no {
  display: inline-flex;
  width: 19px; height: 19px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}
.flow-state { font-size: 11px; color: var(--gold); }
.flow-arrow { color: #6b7280; font-size: 12px; }
.flow-plan { display: flex; flex-wrap: wrap; gap: 5px; width: 100%; }
.plan-pill {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 20px;
  background: rgba(255,255,255,0.06);
  color: #9ca3af;
  border: 1px solid var(--line);
}
.plan-pill.done { color: var(--success); border-color: rgba(74,222,128,0.4); }
.flow-status {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  font-size: 11.5px;
  color: #d1d5db;
}
.flow-elapsed { margin-left: auto; color: var(--gold); font-variant-numeric: tabular-nums; }
.status-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--primary-light);
  box-shadow: 0 0 0 0 rgba(138,123,255,0.6);
  animation: pulse-dot 1.4s infinite;
}
@keyframes pulse-dot {
  0% { box-shadow: 0 0 0 0 rgba(138,123,255,0.55); }
  70% { box-shadow: 0 0 0 7px rgba(138,123,255,0); }
  100% { box-shadow: 0 0 0 0 rgba(138,123,255,0); }
}

/* ---------- 创作对话框（底部悬浮，不遮挡画布） ---------- */
.dlg {
  position: absolute;
  left: 50%;
  bottom: 58px;
  transform: translateX(-50%);
  z-index: 45;
  width: 600px;
  max-width: calc(100% - 32px);
  border-radius: 16px;
  border: 1px solid var(--line);
  background: rgba(30, 30, 42, 0.97);
  box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.5);
  padding: 14px 18px 16px;
  backdrop-filter: blur(10px);
}
.dlg-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.dlg-title { font-size: 16px; font-weight: 700; }
.dlg-credit { font-size: 12px; color: var(--gold); margin-right: auto; }
.dlg-x {
  background: none;
  border: none;
  color: var(--text-soft, #9ca3af);
  font-size: 15px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}
.dlg-x:hover { color: #fff; background: var(--line); }
.dlg-materials {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.dlg-mat {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #f6f6f8;
}
.dlg-mat img { width: 100%; height: 100%; object-fit: contain; display: block; }
.dlg-mat-tip { font-size: 12px; color: var(--text-soft, #9ca3af); }
.dlg-input {
  width: 100%;
  box-sizing: border-box;
  background: #17171f;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: #fff;
  font-size: 13px;
  line-height: 1.6;
  padding: 10px 12px;
  outline: none;
  resize: none;
}
.dlg-input:focus { border-color: var(--primary-light); }
.dlg-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.dlg-line-label { font-size: 12px; color: var(--text-soft, #9ca3af); }
.dlg-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.param-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #17171f;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: #d1d5db;
  font-size: 12px;
  padding: 9px 12px;
  cursor: pointer;
}
.param-bar:hover { border-color: var(--primary-light); }
.param-bar i { width: 1px; height: 12px; background: var(--line); }
.param-caret { color: #6b7280; transition: transform 0.15s; }
.param-caret.up { transform: rotate(180deg); }
.dlg-exec {
  margin-left: auto;
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  border: none;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  padding: 10px 20px;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(108, 92, 231, 0.35);
}
.dlg-exec:disabled { opacity: 0.55; cursor: wait; }
.param-panel {
  margin-top: 12px;
  border-top: 1px dashed var(--line);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pp-row { display: flex; align-items: flex-start; gap: 10px; }
.pp-label {
  flex-shrink: 0;
  width: 56px;
  font-size: 12px;
  color: var(--text-soft, #9ca3af);
  line-height: 28px;
}
.pp-opts { display: flex; flex-wrap: wrap; gap: 6px; }
.pill {
  background: #17171f;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: #9ca3af;
  font-size: 12px;
  padding: 5px 11px;
  cursor: pointer;
  transition: all 0.12s;
}
.pill:hover { color: #fff; border-color: var(--line-bright, #4a4a5e); }
.pill.on {
  color: #fff;
  border-color: var(--primary-light);
  background: rgba(108, 92, 231, 0.22);
}
.viewport {
  flex: 1;
  overflow: hidden;
  position: relative;
  cursor: grab;
  margin: 10px 14px 0;
  border: 1px solid var(--line);
  border-radius: 16px;
  background:
    radial-gradient(circle at 50% 40%, rgba(108,92,231,0.05), transparent 70%),
    #181822;
}
.viewport:active { cursor: grabbing; }
.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  pointer-events: none;
}
.empty-logo {
  font-size: 38px;
  color: var(--primary-light);
  opacity: 0.5;
  margin-bottom: 10px;
}
.canvas-empty p { font-size: 15px; color: #9ca3af; margin: 0 0 6px; }
.canvas-empty span { font-size: 12px; }
.stage {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding: 30px;
  justify-content: center;
  align-items: flex-start;
  transform-origin: center center;
  width: max-content;
  max-width: 100%;
}
.canvas-tile {
  position: relative;
  width: 260px;
  border-radius: 14px;
  overflow: hidden;
  border: 2px solid transparent;
  background: #23232f;
  box-shadow: 0 8px 30px rgba(0,0,0,0.4);
  cursor: pointer;
  transition: border-color 0.15s;
}
.canvas-tile.selected { border-color: var(--primary-light); box-shadow: 0 0 0 3px rgba(138,123,255,0.25), 0 8px 30px rgba(0,0,0,0.4); }
.canvas-tile img {
  width: 100%;
  height: auto;
  max-height: 420px;
  object-fit: contain;
  background: #f6f6f8;
  display: block;
  pointer-events: none;
}
.tile-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
}
.tile-label { font-size: 12px; }
.tile-kind {
  font-size: 10px;
  background: rgba(108,92,231,0.2);
  color: var(--primary-light);
  padding: 1px 7px;
  border-radius: 6px;
}
.tile-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transition: opacity 0.15s;
}
.canvas-tile:hover .tile-actions { opacity: 1; }
.tile-actions button {
  font-size: 11px;
  background: rgba(0,0,0,0.65);
  border: none;
  color: #fff;
  padding: 4px 9px;
  border-radius: 7px;
  cursor: pointer;
}
.tile-actions button.danger { background: rgba(255,107,107,0.85); }
.canvas-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
}
.tb-group { display: flex; align-items: center; gap: 2px; background: #20202c; border-radius: 10px; padding: 3px; }
.tb-group button {
  background: none;
  border: none;
  color: #d1d5db;
  font-size: 14px;
  width: 30px; height: 26px;
  border-radius: 7px;
  cursor: pointer;
}
.tb-group button:hover:not(:disabled) { background: var(--line); }
.tb-group button:disabled { opacity: 0.35; cursor: default; }
.zoom-val { font-size: 11.5px; min-width: 42px; text-align: center; color: var(--text-soft); cursor: pointer; }
.tb-spacer { flex: 1; }
.tb-text {
  background: #20202c;
  border: 1px solid var(--line);
  color: #d1d5db;
  font-size: 12px;
  padding: 7px 14px;
  border-radius: 10px;
  cursor: pointer;
}
.tb-text.primary {
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}
.layers-panel {
  position: absolute;
  right: 14px;
  bottom: 58px;
  width: 280px;
  max-height: 320px;
  overflow-y: auto;
  background: #23232f;
  border: 1px solid var(--line-bright);
  border-radius: 14px;
  box-shadow: 0 16px 50px rgba(0,0,0,0.55);
  z-index: 15;
  padding: 6px;
}
.layers-head {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  padding: 6px 8px;
  color: var(--text-soft);
}
.layers-head span { cursor: pointer; }
.layers-empty { font-size: 12px; color: #6b7280; text-align: center; padding: 14px 0; }
.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  border-radius: 9px;
  cursor: pointer;
}
.layer-row:hover { background: var(--line); }
.layer-row.on { background: rgba(108,92,231,0.18); }
.layer-row img { width: 34px; height: 34px; object-fit: cover; border-radius: 7px; }
.layer-name {
  flex: 1;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.layer-row button {
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 12px;
  cursor: pointer;
  width: 22px;
}
.layer-row button.danger { color: var(--danger); }
</style>
