import crypto from 'node:crypto';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { volcApi } from './volc-sign.js';
import { prepareRefImages } from './image-prep.js';
import { UPLOAD_DIR } from '../config.js';

// ---------- 运行模式 ----------
const REAL_MODE = !!(process.env.VOLC_ACCESS_KEY && process.env.VOLC_SECRET_KEY);
// Seedream 5.0 Flash（方舟 Ark 接口）：配置了 ARK_API_KEY 则启用，输出 1.5K 标清
const ARK_MODE = !!process.env.ARK_API_KEY;
export const TASK_TIMEOUT_MS = 180 * 1000;
const PER_OUTPUT_TIMEOUT_MS = 120 * 1000; // 每张输出图的独立超时
const NO_PROGRESS_TIMEOUT_MS = 120 * 1000; // 生成中连续无进展自动判失败
const QUEUE_HARD_LIMIT_MS = 10 * 60 * 1000; // 排队最长等待
const DOWNLOAD_TIMEOUT_MS = 60 * 1000; // 结果图下载超时
const ARK_REQUEST_TIMEOUT_MS = 180 * 1000; // Ark 同步接口单次请求超时
const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const ARK_MODEL = 'doubao-seedream-5-0-flash-260915'; // Seedream 5.0 Flash

// ---------- Prompt 基础组件 ----------
const Q = 'professional fashion industry, ultra detailed, studio quality, 8k';
// 严格遵循参考图，仅执行用户要求的改动
const KEEP = 'strictly preserve the exact garment silhouette, cut, proportions and design details of the uploaded reference images, only apply the requested changes';
const flat = (view = 'front view') =>
  `Output: professional garment flat lay, ${view}, pure white background, e-commerce catalog photo, clothing laid flat neatly, ${Q}`;

// ---------- 七大模块定义 ----------
export const MODULES = [
  { key: 'quick', name: '快捷编辑', icon: '✦' },
  { key: 'style', name: '款式编辑', icon: '❖' },
  { key: 'print', name: '印花编辑', icon: '◈' },
  { key: 'fabric', name: '面料编辑', icon: '◉' },
  { key: 'line', name: '线稿编辑', icon: '✎' },
  { key: 'tech', name: '工艺单', icon: '❋' },
  { key: 'tools', name: '通用工具', icon: '⚒' },
];

// 每个功能：
//   module 归属 / name 显示 / hint 说明 / scale 文本权重 / credits 积分
//   outputs(p, imageCount, opts) -> [{ label, prompt }]
//   local: 'crop' / 'upscale' 表示本地 sharp 处理，不调用大模型
//   needInstruction: 提交前必须有用户指令
export const FUNCTIONS = {
  // ========== 快捷编辑 ==========
  quick_edit: {
    module: 'quick', name: '自由编辑', hint: '用一句话自由修改，AI 即刻执行',
    scale: 0.3, credits: 2, needInstruction: true,
    outputs: (p) => [{ label: '编辑效果图', prompt: `${p}. ${KEEP}. ${flat()}` }],
  },

  // ========== 款式编辑 ==========
  style_partial: {
    module: 'style', name: '局部修改', hint: '描述要调整的部位与方式',
    scale: 0.3, credits: 2, needInstruction: true,
    outputs: (p) => [{ label: '局部修改效果图', prompt: `${p}. ${KEEP}. ${flat()}` }],
  },
  print_on_garment: {
    module: 'style', name: '印花上身', hint: '第 1 张为款式图，其余为印花图案',
    scale: 0.3, credits: 2,
    outputs: (p, n) =>
      Array.from({ length: Math.max(1, n - 1) }, (_, i) => ({
        label: `印花上身效果 ${i + 1}`,
        prompt: `${p}. Apply the print pattern from reference image ${i + 2} onto the garment in reference image 1, natural fabric placement following garment folds. ${KEEP}. ${flat()}`,
      })),
  },
  fabric_replace: {
    module: 'style', name: '面料替换', hint: '第 1 张为款式图，其余为面料图',
    scale: 0.3, credits: 2,
    outputs: (p, n) =>
      Array.from({ length: Math.max(1, n - 1) }, (_, i) => ({
        label: `面料替换效果 ${i + 1}`,
        prompt: `${p}. Replace the fabric of the garment in reference image 1 with the material from fabric swatch ${i + 2}, realistic texture and drape, keep the same cut. ${flat()}`,
      })),
  },
  color_change: {
    module: 'style', name: '颜色修改', hint: '说明目标颜色，整体换色',
    scale: 0.3, credits: 2, needInstruction: true,
    outputs: (p) => [{ label: '换色效果图', prompt: `${p}. ${KEEP}. ${flat()}` }],
  },
  ai_tryon: {
    module: 'style', name: 'AI 试衣', hint: '上传模特图与服装图，真人上身',
    scale: 0.3, credits: 3,
    outputs: (p) => [{
      label: '试衣效果图',
      prompt: `${p}. Dress the person in reference image 1 wearing the garment from reference image 2, natural realistic fit, keep the person face and pose unchanged. Output: fashion model try-on photo, professional studio, ${Q}`,
    }],
  },
  to_3d_flat: {
    module: 'style', name: '转 3D 平铺', hint: '平面款式转 3D 立体展示',
    scale: 0.3, credits: 2,
    outputs: (p) => [{
      label: '3D 立体平铺图',
      prompt: `${p}. ${KEEP}. Output: 3D rendered garment visualization, volumetric fabric with realistic thickness and soft shadows, pure white background, product render, ${Q}`,
    }],
  },
  multi_view: {
    module: 'style', name: '多视角生成', hint: '一次输出正面 / 侧面 / 背面',
    scale: 0.3, credits: 6,
    outputs: (p) => [
      { label: '正面展示图', prompt: `${p}. ${KEEP}. ${flat('front view')}` },
      { label: '侧面展示图', prompt: `${p}. Keep the same garment design from the reference, Output: garment side view, pure white background, e-commerce catalog photo, ${Q}` },
      { label: '背面展示图', prompt: `${p}. Keep the same garment design from the reference, ${flat('back view')}` },
    ],
  },
  style_derivation: {
    module: 'style', name: '款式裂变', hint: '基于原版型衍生 3 个新款',
    scale: 0.4, credits: 6,
    outputs: (p) => [1, 2, 3].map((i) => ({
      label: `裂变款式 ${i}`,
      prompt: `${p}. Keep the original garment silhouette from the reference, create design variation ${i} with refined new details. ${flat()}`,
    })),
  },

  // ========== 印花编辑 ==========
  print_design: {
    module: 'print', name: '印花设计', hint: '描述图案主题，生成服饰印花',
    scale: 0.35, credits: 2, needInstruction: true,
    outputs: (p) => [{
      label: '服饰印花图案',
      prompt: `${p}. ${KEEP}. Output: fashion textile print pattern design suitable for clothing fabric, elegant composition, ${Q}`,
    }],
  },
  style_transfer: {
    module: 'print', name: '风格迁移', hint: '第 1 张图案，第 2 张为风格参考',
    scale: 0.35, credits: 2,
    outputs: (p) => [{
      label: '风格迁移图案',
      prompt: `${p}. Recreate the pattern/artwork in reference image 1 using exactly the artistic style of reference image 2. Output: fashion textile print pattern, ${Q}`,
    }],
  },
  seamless_tile: {
    module: 'print', name: '四方连续', hint: '图案转无缝拼接，适配生产',
    scale: 0.35, credits: 2,
    outputs: (p) => [{
      label: '四方连续无缝印花',
      prompt: `${p}. ${KEEP}. Output: seamless repeat tile pattern, four-way continuous textile print, perfectly tessellated motif with no visible seams, ${Q}`,
    }],
  },

  // ========== 面料编辑 ==========
  fabric_apply: {
    module: 'fabric', name: '面料上身', hint: '款式图 + 面料图，逐张套版',
    scale: 0.3, credits: 2,
    outputs: (p, n) =>
      Array.from({ length: Math.max(1, n - 1) }, (_, i) => ({
        label: `面料套版 ${i + 1}`,
        prompt: `${p}. Apply fabric swatch ${i + 2} onto the garment in reference image 1 with realistic material texture and drape. Output: garment pure white background flat lay, ${Q}`,
      })),
  },
  fabric_create: {
    module: 'fabric', name: '面料创款', hint: '从面料质感反向生成款式',
    scale: 0.35, credits: 2,
    outputs: (p) => [{
      label: '面料创款效果图',
      prompt: `${p}. Design a fashionable garment made primarily from the fabric material shown in the reference image, let the material inspire the style. Output: garment pure white background flat lay, ${Q}`,
    }],
  },
  fabric_color: {
    module: 'fabric', name: '颜色修改', hint: '面料质感调色',
    scale: 0.3, credits: 2, needInstruction: true,
    outputs: (p) => [{
      label: '面料调色效果图',
      prompt: `${p}. ${KEEP}. ${flat()}`,
    }],
  },

  // ========== 线稿编辑 ==========
  sketch_to_real: {
    module: 'line', name: '线稿转实物', hint: '线稿生成真实面料效果',
    scale: 0.3, credits: 2,
    outputs: (p) => [{
      label: '线稿转实物图',
      prompt: `${p}. Turn the fashion technical sketch in the reference image into a real garment, follow the exact outline and construction of the sketch, realistic fabric material. Output: real garment pure white background flat lay, ${Q}`,
    }],
  },
  real_to_sketch: {
    module: 'line', name: '实物转线稿', hint: '实物图转黑白结构线稿',
    scale: 0.3, credits: 2,
    outputs: (p) => [{
      label: '黑白结构线稿',
      prompt: `${p}. Convert the garment in the reference image into a black and white technical flat sketch CAD drawing, clean vector outline, construction lines, white background, ultra crisp edges`,
    }],
  },
  vector_convert: {
    module: 'line', name: '矢量图转换', hint: '位图转矢量风格，无限放大不失真',
    scale: 0.3, credits: 2,
    outputs: (p) => [{
      label: '矢量风格图',
      prompt: `${p}. Convert the reference into clean vector art style, flat solid color shapes, smooth bezier outlines, no photographic texture, pure white background, professional vector illustration`,
    }],
  },

  // ========== 工艺单 ==========
  tech_pack: {
    module: 'tech', name: '全套生产素材', hint: '一键生成正背面/细节/线稿/SKC',
    scale: 0.3, credits: 8,
    outputs: (p) => [
      { label: '正背面白底平铺图', prompt: `${p}. ${KEEP}. Output: garment flat lay showing front and back view together, pure white background, tech pack reference photo, ${Q}` },
      { label: '细节工艺放大图', prompt: `${p}. ${KEEP}. Output: close-up detail craftsmanship photo, stitching zipper buttons fabric texture detail, macro shot, ${Q}` },
      { label: '黑白结构线稿', prompt: `${p}. Convert the garment into a black and white technical flat sketch CAD drawing, clean vector outline, construction lines, white background` },
      { label: '多配色 SKC 展示图', prompt: `${p}. Keep the same garment design, Output: multiple colorways SKC lineup, color options side by side, pure white background, ${Q}` },
    ],
  },

  // ========== 通用工具 ==========
  hd_upscale: {
    module: 'tools', name: '高清放大', hint: '2 倍无损放大，细节增强',
    local: 'upscale', credits: 0,
  },
  remove_bg: {
    module: 'tools', name: '一键去底', hint: '去除背景，输出纯白底商品图',
    scale: 0.25, credits: 2,
    outputs: (p) => [{
      label: '白底去底图',
      prompt: `Remove the background of the uploaded image completely, keep the exact same garment unchanged. Output: the same garment on a seamless pure white background, professional e-commerce product photo, ${Q}`,
    }],
  },
  smart_cutout: {
    module: 'tools', name: '智能抠图', hint: '精细抠出主体，边缘干净',
    scale: 0.25, credits: 2,
    outputs: (p) => [{
      label: '主体抠图',
      prompt: `Cut out the main subject from the uploaded image with refined clean edges, keep the subject itself identical. Output: extracted subject placed on pure white background with a soft natural drop shadow, professional product image, ${Q}`,
    }],
  },
  smart_crop: {
    module: 'tools', name: '智能裁图', hint: '按比例裁剪构图，即时完成',
    local: 'crop', credits: 0,
  },
  ai_expand: {
    module: 'tools', name: 'AI 扩图', hint: '智能延展画面，自然填充',
    scale: 0.25, credits: 2,
    outputs: (p, n, opts = {}) => [{
      label: '扩图效果图',
      prompt: `Outpaint the uploaded image: extend the canvas to ${opts.ratioLabel || 'a wider 16:9 ratio'} (extend ${opts.directionsLabel || 'all sides'}), keep the original content unchanged, naturally and seamlessly fill the extended areas with matching background and consistent lighting`,
    }],
  },
  ai_erase: {
    module: 'tools', name: 'AI 消除', hint: '描述要去除的内容，无痕消除',
    scale: 0.25, credits: 2, needInstruction: true,
    outputs: (p) => [{
      label: '消除效果图',
      prompt: `${p}. Remove only the specified objects from the uploaded image and seamlessly reconstruct the area behind them, keep everything else exactly identical, photorealistic, ${Q}`,
    }],
  },

  // ========== 兼容旧数据（原场景 key） ==========
  fashion_design: {
    module: 'style', name: '服装设计', scale: 0.3, credits: 4,
    outputs: (p) => [
      { label: '正面白底平铺图', prompt: `${p}. ${KEEP}. ${flat('front view')}` },
      { label: '背面白底平铺图', prompt: `${p}. ${KEEP}. ${flat('back view')}` },
    ],
  },
  multi_fusion: {
    module: 'quick', name: '多款融合', scale: 0.35, credits: 4,
    outputs: (p) => [
      { label: '融合款白底平铺图', prompt: `${p}. Fuse details from the multiple uploaded reference garments exactly as instructed. Output: fused fashion design, pure white background flat lay, ${Q}` },
      { label: '融合款细节展示', prompt: `${p}. Fuse details from the multiple uploaded reference garments exactly as instructed. Output: fused design alternate angle with details highlighted, pure white background, ${Q}` },
    ],
  },
  fabric_mapping: {
    module: 'fabric', name: '面料套版', scale: 0.3, credits: 2,
    outputs: (p, n) =>
      Array.from({ length: n }, (_, i) => ({
        label: `面料 ${i + 1} 实物款式图`,
        prompt: `${p}. Apply fabric swatch ${i + 1}, fine realistic material texture. Output: garment pure white background flat lay, ${Q}`,
      })),
  },
  style_variation: {
    module: 'style', name: '单款裂变', scale: 0.4, credits: 6,
    outputs: (p) => [1, 2, 3].map((i) => ({
      label: `裂变款式 ${i}`,
      prompt: `${p}. Keep the original silhouette, vary design details. Output: design variation ${i}, pure white background flat lay, ${Q}`,
    })),
  },
};
// 旧名导出兼容
export const SCENES = FUNCTIONS;

// 对话模式模板（保留兼容）
export const DIALOG_TEMPLATES = [
  { key: 'multi_fusion', name: '多款融合', desc: '多图款式融合生成新款', prompt: '把参考图的设计细节融合，生成一张白底服装平铺图' },
  { key: 'fabric_mapping', name: '面料套版', desc: '把面料素材套到款式上', prompt: '将面料应用到款式中生成实物款式图，面料质感细腻' },
  { key: 'style_variation', name: '单款裂变', desc: '基于 1 个款式衍生变体', prompt: '基于原版型裂变更多设计点，生成 3 张款式图' },
  { key: 'print_design', name: '印花设计', desc: '生成服饰印花图案', prompt: '设计一款精致的服饰印花图案' },
  { key: 'tech_pack', name: '工艺单素材包', desc: '输出工艺单配套素材', prompt: '生成正背面白底平铺图、细节工艺图、黑白线稿图、SKC 配色展示图' },
];

// ---------- 内容安全 ----------
const BLOCK_WORDS = ['色情', '裸体', '暴恐', '血腥', '枪支', '毒品'];
function checkSafety(prompt) {
  return BLOCK_WORDS.some((w) => prompt.includes(w));
}

// ---------- 内存任务表 ----------
const tasks = new Map();

// ---------- 进程内串行队列（账号并发=1），排队状态对用户可见 ----------
const pending = []; // 等待获取执行槽的任务（按提交顺序）
let chain = Promise.resolve();

function recomputeQueuePos() {
  pending.forEach((t, i) => { t.queuePos = i + 1; });
}
function enqueue(task, fn) {
  pending.push(task);
  task.phase = 'queued';
  recomputeQueuePos();
  const job = chain.then(() => {
    const i = pending.indexOf(task);
    if (i >= 0) pending.splice(i, 1);
    recomputeQueuePos();
    task.queuePos = 0;
    return fn();
  });
  chain = job.then(
    () => {},
    () => {}
  );
  return job;
}

export function getTask(taskId) {
  const t = tasks.get(taskId);
  if (!t) return null;
  if (t.status === 'processing') {
    const now = Date.now();
    // 排队中：超过硬性上限才失败；生成中：长时间无进展才失败（避免误杀慢但正常的多输出任务）
    const stale =
      t.phase === 'queued'
        ? now - t.createdAt > QUEUE_HARD_LIMIT_MS
        : now - (t.lastProgressAt || t.createdAt) > NO_PROGRESS_TIMEOUT_MS;
    if (stale) {
      t.status = 'failed';
      t.errorCode = 'timeout';
      t.error = t.phase === 'queued' ? '排队等待超时，请稍后重试' : 'AI 生成超时，请重新调整提示词重试';
    }
  }
  return t;
}

export function submitTask({ scene = 'quick_edit', prompt = '', images = [], userId = 0, opts = {} }) {
  const meta = FUNCTIONS[scene] || FUNCTIONS.quick_edit;
  // 防御性归一化：接受 URL 字符串或 {url} 对象
  images = (images || [])
    .map((x) => (typeof x === 'string' ? x : x?.url))
    .filter((u) => typeof u === 'string' && u.startsWith('/uploads/'));

  const taskId = crypto.randomUUID();
  const task = {
    id: taskId,
    scene,
    prompt,
    status: 'processing',
    phase: 'starting', // queued 排队 / preparing 素材准备 / generating 生成中 / saving 收尾
    queuePos: 0,
    outputLabel: '',
    lastProgressAt: Date.now(),
    startedAt: 0,
    results: [],
    error: null,
    errorCode: '',
    createdAt: Date.now(),
    finishedAt: null,
  };
  tasks.set(taskId, task);
  if (meta.local) runLocal(task, meta, images, userId, opts);
  else if (REAL_MODE || ARK_MODE) runReal(task, meta, prompt, images, userId, opts);
  else runMock(task, meta, prompt, images);
  return taskId;
}

// ---------- 模拟模式（无大模型凭据时） ----------
async function runMock(task, meta, prompt, images) {
  try {
    if (checkSafety(prompt)) {
      return Object.assign(task, { status: 'failed', errorCode: 'safety', error: '生成内容不符合规范，请修改提示词或更换参考图片', finishedAt: Date.now() });
    }
    await sleep(3000 + Math.random() * 2000);
    const items = meta.outputs(prompt, images.length);
    task.results = items.map((it, i) => ({ lookNo: i + 1, label: it.label, url: images[i % images.length], prompt: it.prompt }));
    task.status = 'success';
    task.finishedAt = Date.now();
  } catch {
    Object.assign(task, { status: 'failed', errorCode: 'service', error: '系统服务异常，请稍后重试', finishedAt: Date.now() });
  }
}

// ---------- 本地工具（sharp，不消耗积分） ----------
async function runLocal(task, meta, images, userId, opts) {
  try {
    if (images.length === 0) throw { errorCode: 'service' };
    const src = resolveLocal(images[0]);
    if (!src) throw { errorCode: 'service' };
    const dir = path.join(UPLOAD_DIR, String(userId), 'ai');
    mkdirSync(dir, { recursive: true });
    let buf;
    let label;
    if (meta.local === 'upscale') {
      const m = await sharp(src).rotate().metadata();
      buf = await sharp(src).rotate().resize({ width: m.width * 2 }).png().toBuffer();
      label = '2 倍高清放大图';
    } else {
      const ratio = String(opts.ratio || '1:1');
      const [rw, rh] = ratio.split(':').map(Number);
      const m = await sharp(src).rotate().metadata();
      // 按目标比例计算居中裁剪区域
      const target = m.width / m.height > rw / rh
        ? { height: m.height, width: Math.round(m.height * rw / rh) }
        : { width: m.width, height: Math.round(m.width * rh / rw) };
      const left = Math.round((m.width - target.width) / 2);
      const top = Math.round((m.height - target.height) / 2);
      buf = await sharp(src).rotate()
        .extract({ left, top, width: target.width, height: target.height })
        .jpeg({ quality: 92 }).toBuffer();
      label = `${ratio} 裁剪图`;
    }
    const ext = meta.local === 'upscale' ? 'png' : 'jpg';
    const fileName = `${crypto.randomUUID()}.${ext}`;
    writeFileSync(path.join(dir, fileName), buf);
    task.results = [{ lookNo: 1, label, url: `/uploads/${userId}/ai/${fileName}`, prompt: '' }];
    task.status = 'success';
    task.finishedAt = Date.now();
  } catch (e) {
    if (!e?.errorCode) console.error('[local] unexpected:', e?.message || e);
    Object.assign(task, { status: 'failed', errorCode: e?.errorCode || 'service', error: '处理失败，请稍后重试', finishedAt: Date.now() });
  }
}

// ---------- 真实模式（Seedream 5.0 pro / 兼容旧视觉服务） ----------
const REQ_KEY = 'jimeng_t2i_v40';
const SAFETY_RE = /sensitive|risk|violat|moderat|审核|违规|不合规|内容安全|安全拦截|不符合规范/i;

async function runReal(task, meta, prompt, images, userId, opts) {
  try {
    let items = meta.outputs(prompt, images.length, opts);
    // 用户指定生成数量：单输出功能复制为 N 张（多输出固定功能如工艺单不受影响）
    const wantCount = Math.min(4, Math.max(1, parseInt(opts.count) || 1));
    if (wantCount > 1 && items.length === 1) {
      items = Array.from({ length: wantCount }, (_, i) => ({ ...items[0], label: `${items[0].label}·${i + 1}` }));
    }

    // 账号并发=1：进入进程内队列，排队位置与状态对用户可见
    await enqueue(task, async () => {
      task.startedAt = Date.now();
      task.lastProgressAt = Date.now();

      task.phase = 'preparing';
      // 参考图压缩后转 base64（网关 body 上限约 10MB）
      const refBase64 = await prepareRefImages(images.map(resolveLocal).filter(Boolean));
      if (refBase64.length === 0) throw { errorCode: 'service' };

      // 串行执行「生成→落盘」，每张图独立超时
      const results = [];
      for (let i = 0; i < items.length; i++) {
        task.phase = 'generating';
        task.outputLabel = items[i].label;
        const deadline = Date.now() + PER_OUTPUT_TIMEOUT_MS;
        if (ARK_MODE) {
          results.push(await runOneSubArk(items[i], i + 1, refBase64, userId, opts));
        } else {
          results.push(await runOneSub(items[i], i + 1, refBase64, deadline, userId, meta.scale ?? 0.3));
        }
        task.results = results;
        task.lastProgressAt = Date.now();
      }
      task.phase = 'saving';
      task.status = 'success';
      task.finishedAt = Date.now();
    });
  } catch (e) {
    if (!e?.errorCode) console.error('[jimeng] unexpected:', e?.message || e);
    const code = e?.errorCode || 'service';
    Object.assign(task, {
      status: 'failed',
      errorCode: code,
      error:
        code === 'safety'
          ? '生成内容不符合规范，请修改提示词或更换参考图片'
          : code === 'timeout'
            ? 'AI 生成超时，请重新调整提示词重试'
            : '系统服务异常，请稍后重试',
      finishedAt: Date.now(),
    });
  }
}

async function runOneSub(item, lookNo, refBase64, deadline, userId, scale) {
  const submitBody = { req_key: REQ_KEY, prompt: item.prompt, scale, force_single: true, binary_data_base64: refBase64 };

  let submit = null;
  for (;;) {
    submit = await volcApi('CVSync2AsyncSubmitTask', submitBody);
    if (submit.code === 10000) break;
    // 50430 并发占用（可能来自服务重启后上游残留任务）：短时等待重试
    if (submit.code === 50430 && Date.now() < deadline - 3000) {
      await sleep(3000);
      continue;
    }
    throw classifyError(submit);
  }
  const remoteTaskId = submit.data?.task_id;
  if (!remoteTaskId) throw { errorCode: 'service' };

  let remoteUrl = '';
  while (Date.now() < deadline) {
    await sleep(1500);
    const r = await volcApi('CVSync2AsyncGetResult', {
      req_key: REQ_KEY,
      task_id: remoteTaskId,
      req_json: JSON.stringify({ return_url: true, logo_info: { add_logo: false } }),
    });
    const st = r.data?.status;
    if (st === 'done') {
      if (r.code !== 10000) throw classifyError(r);
      remoteUrl = r.data?.image_urls?.[0] || '';
      break;
    }
    if (st === 'not_found' || st === 'expired') throw { errorCode: 'service' };
  }
  if (!remoteUrl) throw { errorCode: 'timeout' };

  // 下载结果图（带超时，避免网络挂起）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let rawBuf;
  try {
    const resp = await fetch(remoteUrl, { signal: controller.signal });
    if (!resp.ok) throw { errorCode: 'service' };
    rawBuf = Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    if (e?.name === 'AbortError') throw { errorCode: 'timeout' };
    throw e;
  } finally {
    clearTimeout(timer);
  }
  // 账号级强制水印无法通过接口参数关闭，落盘前本地抹除右下角水印
  const buf = await stripWatermark(rawBuf);
  const dir = path.join(UPLOAD_DIR, String(userId), 'ai');
  mkdirSync(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.png`;
  writeFileSync(path.join(dir, fileName), buf);

  return { lookNo, label: item.label, url: `/uploads/${userId}/ai/${fileName}`, prompt: item.prompt };
}

// ---------- Seedream 5.0 Flash（方舟 Ark 同步接口） ----------
// 分辨率档位对应的总像素面积
const TIER_PIXELS = { '1K': 1024 * 1024, '1.5K': 1536 * 1536, '2K': 2048 * 2048, '4K': 4096 * 4096 };
// 官方 1.5K 档常见比例的精确尺寸
const RATIO_SIZE_15K = {
  '1:1': '1536x1536', '3:4': '1344x1792', '4:3': '1792x1344',
  '9:16': '1152x2048', '16:9': '2048x1152', '2:3': '1248x1872', '3:2': '1872x1248',
};
// 根据清晰度档位 + 比例计算 Ark size 参数
function arkSize(opts) {
  const tier = TIER_PIXELS[opts.sizeTier] ? opts.sizeTier : '1.5K';
  const aspect = String(opts.aspect || '智能');
  if (aspect !== '智能' && aspect.includes(':')) {
    if (tier === '1.5K' && RATIO_SIZE_15K[aspect]) return RATIO_SIZE_15K[aspect];
    const [rw, rh] = aspect.split(':').map(Number);
    if (rw > 0 && rh > 0) {
      const area = TIER_PIXELS[tier];
      const q = (v) => Math.max(720, Math.min(4096, Math.round(v / 16) * 16));
      const w = q(Math.sqrt((area * rw) / rh));
      const h = q((w * rh) / rw);
      return `${w}x${h}`;
    }
  }
  return tier; // 智能：跟随参考图比例，用档位字符串
}

async function runOneSubArk(item, lookNo, refBase64, userId, opts = {}) {
  // 方舟要求 data URI 格式
  const images = refBase64.map((b64) => `data:image/jpeg;base64,${b64}`);
  const body = {
    model: ARK_MODEL,
    prompt: item.prompt,
    image: images,
    size: arkSize(opts),
    response_format: 'url',
    watermark: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARK_REQUEST_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(ARK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw { errorCode: 'timeout' };
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw { errorCode: 'service' };
  }
  if (!resp.ok || !json?.data?.length) {
    const msg = String(json?.error?.message || '');
    if (resp.status === 401 || resp.status === 403 || /invalid\s*api\s*key|auth/i.test(msg)) {
      throw { errorCode: 'service' };
    }
    if (SAFETY_RE.test(msg) || /content.*(filter|policy|moderation)/i.test(msg)) {
      throw { errorCode: 'safety' };
    }
    console.error('[seedream] ark error:', resp.status, msg.slice(0, 200));
    throw { errorCode: 'service' };
  }

  const remoteUrl = json.data[0].url || '';
  if (!remoteUrl) throw { errorCode: 'service' };

  // 下载结果图（带超时，避免网络挂起）
  const controller2 = new AbortController();
  const timer2 = setTimeout(() => controller2.abort(), DOWNLOAD_TIMEOUT_MS);
  let rawBuf;
  try {
    const r2 = await fetch(remoteUrl, { signal: controller2.signal });
    if (!r2.ok) throw { errorCode: 'service' };
    rawBuf = Buffer.from(await r2.arrayBuffer());
  } catch (e) {
    if (e?.name === 'AbortError') throw { errorCode: 'timeout' };
    throw e;
  } finally {
    clearTimeout(timer2);
  }
  const dir = path.join(UPLOAD_DIR, String(userId), 'ai');
  mkdirSync(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.png`;
  writeFileSync(path.join(dir, fileName), rawBuf);

  return { lookNo, label: item.label, url: `/uploads/${userId}/ai/${fileName}`, prompt: item.prompt };
}

// 右下角水印区域：用该区域直方图众数（即背景色，占绝对多数）覆盖
async function stripWatermark(buf) {
  const m = await sharp(buf).metadata();
  const w = m.width;
  const h = m.height;
  const rw = Math.round(w * 0.28);
  const rh = Math.round(h * 0.08);
  const left = w - rw - Math.round(w * 0.012);
  const top = h - rh - Math.round(h * 0.008);

  let fill = 255;
  try {
    const { data } = await sharp(buf)
      .extract({ left, top, width: rw, height: rh })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // 32 级灰度桶，取众数桶中心
    const bins = new Array(32).fill(0);
    for (const v of data) bins[v >> 3]++;
    let best = 31;
    for (let i = 30; i >= 0; i--) if (bins[i] > bins[best]) best = i;
    fill = best * 8 + 4;
  } catch (e) {
    console.error('[wm] failed:', e.message);
    return buf;
  }
  const pad = 6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rw + pad * 2}" height="${rh + pad * 2}">
    <rect width="100%" height="100%" fill="rgb(${fill},${fill},${fill})"/></svg>`;
  return sharp(buf)
    .composite([{ input: Buffer.from(svg), left: left - pad, top: top - pad }])
    .png()
    .toBuffer();
}

function resolveLocal(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const fp = path.normalize(path.join(UPLOAD_DIR, url.replace('/uploads/', '')));
  return fp.startsWith(UPLOAD_DIR) ? fp : null;
}

function classifyError(r) {
  const msg = String(r?.message || '');
  console.error('[jimeng] upstream error code=', r?.code, 'message=', msg.slice(0, 300));
  return { errorCode: SAFETY_RE.test(msg) ? 'safety' : 'service', upstreamCode: r?.code };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
