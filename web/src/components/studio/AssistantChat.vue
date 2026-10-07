<script setup>
import { ref, nextTick, watch, onMounted } from 'vue';
import { useStudio } from '../../stores/studio.js';
import { showToast } from '../../toast.js';

const { state, pushMessage, chatSend, setFunction } = useStudio();

const input = ref('');
const bodyRef = ref(null);

const suggestions = [
  { text: '分析当前素材', fn: 'quick_edit' },
  { text: '把这个款式裂变 3 款', fn: 'style_derivation' },
  { text: '生成工艺单全套素材', fn: 'tech_pack' },
  { text: '一键去底，输出白底图', fn: 'remove_bg' },
];

onMounted(() => {
  if (!state.messages.length) {
    pushMessage({
      role: 'assistant',
      type: 'text',
      content: '你好，我是「帛序设计助理」。我可以帮你分析素材、拆解设计需求、制定生成计划并实时播报进度。先从左侧上传素材，或试试下方推荐：',
    });
  }
});

watch(
  () => state.messages.length,
  async () => {
    await nextTick();
    const el = bodyRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  }
);

async function send() {
  const text = input.value.trim();
  if (!text || state.running) {
    if (state.running) showToast('正在执行中，请稍候');
    return;
  }
  input.value = '';
  try {
    await chatSend(text);
  } catch { /* 错误消息已入对话流 */ }
}

async function tapSuggestion(s) {
  if (state.running) return showToast('正在执行中，请稍候');
  setFunction(s.fn);
  try {
    await chatSend(s.text);
  } catch { /* ignore */ }
}
</script>

<template>
  <div class="assistant">
    <div class="assistant-head">
      <span class="assistant-ava">帛</span>
      <div class="assistant-meta">
        <span class="assistant-name">帛序设计助理</span>
        <span class="assistant-state"><i></i>在线 · 全流程陪伴</span>
      </div>
    </div>

    <div ref="bodyRef" class="assistant-body">
      <template v-for="m in state.messages" :key="m.id">
        <!-- 用户消息 -->
        <div v-if="m.role === 'user'" class="msg user">
          <div class="bubble user-bubble">{{ m.content }}</div>
        </div>

        <!-- 助理消息 -->
        <div v-else class="msg assistant">
          <span class="msg-ava">帛</span>
          <div class="bubble">
            <p v-if="m.type === 'text'" :class="{ error: m.error }">{{ m.content }}</p>

            <div v-else-if="m.type === 'phase'" class="phase-line">
              {{ m.phase === 'analysis' ? '① 素材分析' : '② 生成计划' }}
              <span :class="m.state">{{ m.state === 'running' ? '进行中…' : '已完成 ✓' }}</span>
            </div>

            <template v-else-if="m.type === 'analysis'">
              <p class="a-title">① 素材分析完成</p>
              <p class="a-summary">{{ m.content }}</p>
              <div v-for="(it, i) in m.items" :key="i" class="a-item">
                <img :src="it.url" />
                <div class="a-item-info">
                  <span class="a-item-name">{{ it.fileName || '素材 ' + (i + 1) }}</span>
                  <span class="a-item-tags">
                    <i v-for="t in it.tags" :key="t">{{ t }}</i>
                    <em v-if="!it.tags.length">未识别标签</em>
                  </span>
                  <span class="a-item-size">{{ it.width }}×{{ it.height }} · {{ it.sizeKb }}KB</span>
                </div>
              </div>
            </template>

            <template v-else-if="m.type === 'plan'">
              <p class="a-title">② 生成计划（预计消耗 {{ m.credits }} 积分）</p>
              <div v-for="(s, i) in m.steps" :key="i" class="plan-step">
                <span class="step-no">{{ i + 1 }}</span>
                <div><b>{{ s.label }}</b><em>{{ s.desc }}</em></div>
              </div>
            </template>

            <template v-else-if="m.type === 'result'">
              <p class="a-title">③ 执行完成</p>
              <div class="result-grid">
                <div v-for="r in m.results" :key="r.url" class="result-cell">
                  <img :src="r.url" />
                  <span>{{ r.label }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- 运行中无消息提示时的进度条 -->
      <div v-if="state.running" class="typing">
        <span class="msg-ava">帛</span>
        <span class="typing-dots"><i></i><i></i><i></i></span>
      </div>
    </div>

    <div class="suggestions">
      <button v-for="s in suggestions" :key="s.text" @click="tapSuggestion(s)">{{ s.text }}</button>
    </div>

    <div class="chat-input">
      <textarea
        v-model="input"
        rows="1"
        placeholder="输入需求，如：改成香槟金色…"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button :disabled="state.running" @click="send">发送</button>
    </div>
  </div>
</template>

<style scoped>
.assistant {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(30,30,42,0.4);
}
.assistant-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}
.assistant-ava {
  width: 34px; height: 34px;
  border-radius: 11px;
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 700; color: #fff;
}
.assistant-name { display: block; font-size: 13.5px; font-weight: 600; }
.assistant-state { font-size: 11px; color: #6b7280; }
.assistant-state i {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--success);
  margin-right: 4px;
}
.assistant-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
}
.msg { display: flex; margin-bottom: 14px; gap: 8px; }
.msg.user { justify-content: flex-end; }
.msg-ava {
  width: 24px; height: 24px;
  flex-shrink: 0;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: #fff;
}
.bubble {
  background: #23232f;
  border: 1px solid var(--line);
  border-radius: 4px 14px 14px 14px;
  padding: 9px 12px;
  font-size: 12.5px;
  max-width: 86%;
  line-height: 1.65;
}
.bubble p { margin: 0; }
.bubble p.error { color: var(--danger); }
.user-bubble {
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  border-radius: 14px 4px 14px 14px;
  padding: 9px 12px;
  font-size: 12.5px;
  max-width: 80%;
}
.phase-line { font-size: 12.5px; display: flex; justify-content: space-between; gap: 10px; }
.phase-line .running { color: var(--gold); }
.phase-line .done { color: var(--success); }
.a-title { font-weight: 600; margin-bottom: 4px !important; }
.a-summary { color: var(--text-soft, #9ca3af); font-size: 12px !important; }
.a-item {
  display: flex;
  gap: 9px;
  padding: 8px 0;
  border-top: 1px dashed var(--line);
  margin-top: 8px;
}
.a-item img { width: 46px; height: 46px; border-radius: 9px; object-fit: cover; }
.a-item-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.a-item-name { font-size: 12px; }
.a-item-tags i {
  font-style: normal;
  font-size: 10px;
  background: rgba(108,92,231,0.18);
  color: var(--primary-light);
  padding: 1px 6px;
  border-radius: 5px;
  margin-right: 4px;
}
.a-item-tags em { font-size: 10px; color: #6b7280; font-style: normal; }
.a-item-size { font-size: 10px; color: #6b7280; }
.plan-step { display: flex; gap: 9px; padding: 6px 0; align-items: flex-start; }
.step-no {
  width: 20px; height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  background: rgba(108,92,231,0.2);
  color: var(--primary-light);
  font-size: 11px;
  display: flex; align-items: center; justify-content: center;
}
.plan-step b { display: block; font-size: 12.5px; font-weight: 600; }
.plan-step em { display: block; font-size: 11px; color: #6b7280; font-style: normal; margin-top: 2px; }
.result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.result-cell { border-radius: 10px; overflow: hidden; background: #f6f6f8; border: 1px solid var(--line); }
.result-cell img { width: 100%; height: 100px; object-fit: contain; display: block; }
.result-cell span { display: block; font-size: 10.5px; padding: 4px 6px; color: #d1d5db; background: #20202c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.typing { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.typing-dots { display: flex; gap: 4px; background: #23232f; padding: 10px 12px; border-radius: 10px; }
.typing-dots i {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--primary-light);
  animation: blink 1.2s infinite;
}
.typing-dots i:nth-child(2) { animation-delay: 0.2s; }
.typing-dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }
.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
}
.suggestions button {
  font-size: 11px;
  background: rgba(108,92,231,0.12);
  border: 1px solid rgba(138,123,255,0.25);
  color: var(--primary-light);
  padding: 5px 10px;
  border-radius: 20px;
  cursor: pointer;
}
.suggestions button:hover { background: rgba(108,92,231,0.25); }
.chat-input {
  display: flex;
  gap: 8px;
  padding: 10px 12px 14px;
  border-top: 1px solid var(--line);
}
.chat-input textarea {
  flex: 1;
  resize: none;
  max-height: 80px;
  background: #20202c;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: #fff;
  font-size: 12.5px;
  padding: 8px 11px;
  outline: none;
  font-family: inherit;
}
.chat-input textarea:focus { border-color: var(--primary-light); }
.chat-input button {
  background: linear-gradient(135deg, var(--primary-light), var(--primary));
  border: none;
  color: #fff;
  font-size: 12.5px;
  padding: 0 16px;
  border-radius: 10px;
  cursor: pointer;
}
.chat-input button:disabled { opacity: 0.5; cursor: wait; }
</style>
