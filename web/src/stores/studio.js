import { reactive, computed } from 'vue';
import { api } from '../api.js';

// ============ 全局共享状态（三栏联动） ============
const state = reactive({
  // 左栏 → 画布：当前选中的素材
  assets: [], // { url, fileName, width, height }
  // 画布图层（生成结果 / 加入画布的素材）
  layers: [], // { id, url, label, kind: 'material'|'result', hidden }
  selectedLayerId: 0,
  // 右侧助理消息
  messages: [],
  // 当前功能
  activeFn: 'quick_edit',
  activeModule: 'quick',
  // 运行状态
  running: false,
  flow: null, // 三阶段可视化 { stage:'analysis'|'plan'|'execute', done:[] , outputs:[], finished:0 }
  // 画布
  zoom: 1,
  pan: { x: 0, y: 0 },
  // 撤销/重做
  history: [],
  future: [],
});

let layerSeq = 1;
let msgSeq = 1;

// ============ 素材操作 ============
function addAssets(items) {
  let added = 0;
  for (const it of items) {
    if (state.assets.some((a) => a.url === it.url)) continue;
    state.assets.push({ url: it.url, fileName: it.fileName || it.file_name || '', width: it.width || 0, height: it.height || 0 });
    pushLayer({ url: it.url, label: it.fileName || it.file_name || '素材', kind: 'material' });
    added++;
  }
  return added;
}
function removeAsset(url) {
  const i = state.assets.findIndex((a) => a.url === url);
  if (i >= 0) state.assets.splice(i, 1);
  const li = state.layers.findIndex((l) => l.url === url && l.kind === 'material');
  if (li >= 0) state.layers.splice(li, 1);
}
function clearAssets() {
  state.assets.splice(0);
  state.layers = state.layers.filter((l) => l.kind === 'result');
}

// ============ 图层操作（带撤销快照） ============
function snapshot() {
  state.history.push(JSON.stringify(state.layers));
  if (state.history.length > 30) state.history.shift();
  state.future = [];
}
function pushLayer(layer) {
  snapshot();
  const id = layerSeq++;
  state.layers.push({ id, hidden: false, ...layer });
  state.selectedLayerId = id;
  return id;
}
function removeLayer(id) {
  const i = state.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  snapshot();
  const layer = state.layers[i];
  state.layers.splice(i, 1);
  if (layer.kind === 'material') removeAsset(layer.url);
  if (state.selectedLayerId === id) {
    state.selectedLayerId = state.layers[state.layers.length - 1]?.id || 0;
  }
}
function undo() {
  const prev = state.history.pop();
  if (!prev) return;
  state.future.push(JSON.stringify(state.layers));
  restoreLayers(prev);
}
function redo() {
  const next = state.future.pop();
  if (!next) return;
  state.history.push(JSON.stringify(state.layers));
  restoreLayers(next);
}
function restoreLayers(json) {
  const arr = JSON.parse(json);
  state.layers.splice(0, state.layers.length, ...arr);
  if (!state.layers.some((l) => l.id === state.selectedLayerId)) {
    state.selectedLayerId = state.layers[state.layers.length - 1]?.id || 0;
  }
}
const canUndo = computed(() => state.history.length > 0);
const canRedo = computed(() => state.future.length > 0);

function selectLayer(id) {
  state.selectedLayerId = id;
}

// ============ 助理消息 ============
function pushMessage(msg) {
  state.messages.push({ id: msgSeq++, ts: Date.now(), ...msg });
  return state.messages[state.messages.length - 1];
}

// ============ 功能切换 ============
function setFunction(key, moduleKey) {
  state.activeFn = key;
  if (moduleKey) state.activeModule = moduleKey;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============ 核心执行流（三阶段可视化） ============
// 供中画布「执行」与右栏助理共用
async function runFlow({ prompt = '', opts = {}, source = 'canvas' } = {}) {
  if (state.running) throw new Error('正在执行中，请稍候');
  if (state.assets.length === 0) throw new Error('请先从左侧选择素材');
  const images = state.assets.map((a) => a.url);
  const fn = state.activeFn;

  state.running = true;
  state.flow = reactive({ stage: 'analysis', planSteps: [], finished: 0, total: 1, outputs: [], broadcasts: [], phase: '', queuePos: 0, outputLabel: '', elapsed: 0 });

  if (source === 'chat') {
    pushMessage({ role: 'user', type: 'text', content: prompt || '（未输入指令，直接执行当前功能）' });
  }

  try {
    // 阶段 1：素材分析
    if (source === 'chat') pushMessage({ role: 'assistant', type: 'phase', phase: 'analysis', state: 'running' });
    const [analysis, plan] = await Promise.all([
      api('/ai/analyze', 'POST', { images }).catch(() => null),
      api('/ai/plan', 'POST', { fn, prompt, images, opts }).catch(() => null),
    ]);
    await sleep(700);
    if (analysis && source === 'chat') {
      const last = state.messages[state.messages.length - 1];
      if (last?.type === 'phase') last.state = 'done';
      pushMessage({ role: 'assistant', type: 'analysis', content: analysis.summary, items: analysis.items });
    }
    if (!plan) throw new Error('生成计划失败，请稍后重试');

    // 阶段 2：生成计划
    state.flow.stage = 'plan';
    state.flow.planSteps = plan.plan.steps;
    state.flow.total = plan.plan.steps.length;
    if (source === 'chat') {
      pushMessage({ role: 'assistant', type: 'phase', phase: 'plan', state: 'running' });
      await sleep(700);
      const last = state.messages[state.messages.length - 1];
      if (last?.type === 'phase') last.state = 'done';
      pushMessage({ role: 'assistant', type: 'plan', steps: plan.plan.steps, credits: plan.credits });
      await sleep(500);
    } else {
      await sleep(900);
    }

    // 阶段 3：执行
    state.flow.stage = 'execute';
    const created = await api('/ai/tasks', 'POST', { scene: fn, prompt, images, opts });
    let finalResults = [];
    let errorMsg = '';
    let queuedNotified = false;
    for (;;) {
      await sleep(2000);
      const r = await api(`/ai/tasks/${created.taskDbId}`);
      state.flow.finished = (r.partial || r.results || []).length;
      state.flow.outputs = r.partial || [];
      state.flow.phase = r.phase || '';
      state.flow.queuePos = r.queuePos || 0;
      state.flow.outputLabel = r.outputLabel || '';
      state.flow.elapsed = r.elapsed || 0;
      if (r.total) state.flow.total = r.total;
      // 排队状态仅通知一次
      if (source === 'chat' && r.phase === 'queued' && r.queuePos > 0 && !queuedNotified) {
        queuedNotified = true;
        pushMessage({ role: 'assistant', type: 'text', content: `前方有任务正在生成，已进入排队（第 ${r.queuePos} 位），完成后将自动开始，请稍候。` });
      }
      if (r.status === 'success') {
        finalResults = r.results;
        break;
      }
      if (r.status === 'failed') {
        errorMsg = r.error || '生成失败，请稍后重试';
        break;
      }
    }

    if (errorMsg) throw new Error(errorMsg);

    for (const r of finalResults) {
      pushLayer({ url: r.url, label: r.label, kind: 'result' });
    }
    // 新结果复位到画布中央展示
    state.pan = { x: 0, y: 0 };
    state.flow.outputs = finalResults;
    state.flow.finished = finalResults.length;
    if (source === 'chat') {
      pushMessage({ role: 'assistant', type: 'result', results: finalResults });
      pushMessage({ role: 'assistant', type: 'text', content: `已完成 ${finalResults.length} 张产出，并自动存入「个人资产 · AI 生成」。可继续对结果追加编辑，或批量导出。` });
    }
    state.flow = null;
    state.running = false;
    return finalResults;
  } catch (e) {
    state.flow = null;
    state.running = false;
    if (source === 'chat') pushMessage({ role: 'assistant', type: 'text', error: true, content: `⚠ ${e.message}` });
    throw e;
  }
}

// 助理对话：未指定功能时，按自由编辑执行
async function chatSend(text, opts = {}) {
  return runFlow({ prompt: text, opts, source: 'chat' });
}

export function useStudio() {
  return {
    state,
    canUndo,
    canRedo,
    addAssets,
    removeAsset,
    clearAssets,
    pushLayer,
    removeLayer,
    undo,
    redo,
    selectLayer,
    pushMessage,
    setFunction,
    runFlow,
    chatSend,
  };
}
