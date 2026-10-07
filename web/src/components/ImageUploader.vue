<script setup>
import { ref, reactive } from 'vue';
import { getToken } from '../api.js';
import { showToast } from '../toast.js';
import { MAX_IMAGES } from './limits.js';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  projectId: { type: [Number, String], default: 0 },
});
const emit = defineEmits(['update:modelValue', 'uploaded']);

const fileInput = ref(null);

function pick() {
  fileInput.value.click();
}

defineExpose({ pick });

function remove(item) {
  emit('update:modelValue', props.modelValue.filter((x) => x !== item));
}

function onChange(e) {
  const picked = Array.from(e.target.files || []);
  e.target.value = '';

  // 逐张校验格式/大小
  const valid = [];
  for (const f of picked) {
    if (!['image/jpeg', 'image/png'].includes(f.type) || f.size > 15 * 1024 * 1024) {
      showToast('图片仅支持 JPG/PNG，大小不超过 15MB');
      continue;
    }
    valid.push(f);
  }
  if (valid.length === 0) return;

  // 总数上限
  const remain = MAX_IMAGES - props.modelValue.length;
  if (remain <= 0) return showToast(`最多上传 ${MAX_IMAGES} 张图片`);
  let accepted = valid;
  if (valid.length > remain) {
    accepted = valid.slice(0, remain);
    showToast(`最多上传 ${MAX_IMAGES} 张，已自动选取前 ${remain} 张`);
  }

  // 一次性为所有图片建立占位项（单次 emit，避免覆盖）
  const newItems = accepted.map((f) =>
    reactive({ url: '', fileName: f.name, progress: 0, uploading: true, failed: false })
  );
  emit('update:modelValue', [...props.modelValue, ...newItems]);

  // 多张图片合并为一个请求同时上传
  const xhr = new XMLHttpRequest();
  const fd = new FormData();
  accepted.forEach((f) => fd.append('files', f));
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const p = Math.round((ev.loaded / ev.total) * 100);
      newItems.forEach((it) => (it.progress = p));
    }
  };
  xhr.onload = () => {
    if (xhr.status === 200) {
      try {
        const d = JSON.parse(xhr.responseText);
        newItems.forEach((it, i) => {
          it.url = d.list[i]?.url || '';
          it.uploading = false;
        });
        emit('uploaded', d.list);
      } catch {
        failItems(newItems);
        showToast('上传失败，请重试');
      }
    } else {
      failItems(newItems);
      let m = '上传失败，请重试';
      try { m = JSON.parse(xhr.responseText).error || m; } catch {}
      showToast(m);
    }
  };
  xhr.onerror = () => {
    failItems(newItems);
    showToast('网络异常，上传失败');
  };
  xhr.open('POST', '/api/upload' + (props.projectId ? `?projectId=${props.projectId}` : ''));
  xhr.setRequestHeader('authorization', 'Bearer ' + getToken());
  xhr.send(fd);
}

function failItems(items) {
  items.forEach((it) => {
    it.failed = true;
    it.uploading = false;
  });
}
</script>

<template>
  <div class="uploader">
    <button class="dropzone" :class="{ compact: modelValue.length > 0 }" @click="pick">
      <span class="dz-icon">＋</span>
      <span class="dz-text">
        <b>上传参考图片</b>
        <small>JPG/PNG，单张 ≤15MB，最多 {{ MAX_IMAGES }} 张</small>
      </span>
    </button>
    <input ref="fileInput" type="file" accept="image/jpeg,image/png" multiple hidden @change="onChange" />

    <div class="img-tags">
      <div v-for="(item, i) in modelValue" :key="i" class="img-tag">
        <div class="thumb">
          <img v-if="item.url" :src="item.url" alt="" />
          <div v-else class="thumb-loading">
            <span v-if="item.failed">✕</span>
            <span v-else>{{ item.progress }}%</span>
          </div>
        </div>
        <span class="img-name" :title="item.fileName">{{ item.fileName }}</span>
        <button class="img-del" @click="remove(item)">✕</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px;
  border: 1.5px dashed var(--line-bright);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.2s;
  text-align: left;
}
.dropzone:hover {
  border-color: rgba(138, 123, 255, 0.5);
  background: rgba(108, 92, 231, 0.05);
}
.dz-icon {
  width: 42px; height: 42px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(108, 92, 231, 0.25), rgba(138, 123, 255, 0.12));
  color: var(--primary-light);
  font-size: 20px;
}
.dz-text b { display: block; color: var(--text-1); font-size: 14px; }
.dz-text small { color: var(--text-3); font-size: 12px; }

.img-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}
.img-tag {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 5px 5px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  max-width: 250px;
}
.thumb {
  width: 34px; height: 34px;
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--card-2);
}
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb-loading {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: var(--text-3);
}
.img-name {
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.img-del {
  color: var(--text-3);
  font-size: 11px;
  width: 18px; height: 18px;
  border-radius: 50%;
  transition: all 0.15s;
  flex-shrink: 0;
}
.img-del:hover { background: rgba(255, 107, 107, 0.2); color: var(--danger); }
</style>
