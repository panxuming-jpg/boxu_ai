import { Router } from 'express';
import crypto from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Archiver } from 'archiver';
import { db } from '../db.js';
import { authRequired } from '../auth.js';
import { nowStr } from '../util.js';
import { UPLOAD_DIR, MAX_PROMPT, MAX_IMAGES } from '../config.js';
import {
  submitTask, getTask, FUNCTIONS, MODULES, DIALOG_TEMPLATES,
} from '../engine/jimeng.js';

const r = Router();
r.use(authRequired);

// 归一化图片参数
function normalizeImages(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((x) => (typeof x === 'string' ? x : x?.url))
    .filter((u) => typeof u === 'string' && u.startsWith('/uploads/'));
}

// 计算某场景将产出的图片总数
function metaOutputCount(row) {
  const meta = FUNCTIONS[row.scene];
  if (!meta || meta.local) return 1;
  try {
    const n = JSON.parse(row.input_images || '[]').length;
    return meta.outputs(row.prompt || '', n).length;
  } catch {
    return 1;
  }
}

function resolveLocalPath(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const fp = path.normalize(path.join(UPLOAD_DIR, url.replace('/uploads/', '')));
  return fp.startsWith(UPLOAD_DIR) ? fp : null;
}

// 生成结果自动写入个人资产
async function recordGeneratedAssets(userId, dbTaskId, scene, results) {
  for (const it of results) {
    if (!it.url?.startsWith('/uploads/')) continue;
    const dup = db.prepare('SELECT 1 FROM assets WHERE user_id=? AND url=? AND task_id=?')
      .get(userId, it.url, dbTaskId);
    if (dup) continue;
    let width = 0;
    let height = 0;
    try {
      const m = await sharp(resolveLocalPath(it.url)).metadata();
      width = m.width || 0;
      height = m.height || 0;
    } catch { /* ignore */ }
    db.prepare(
      `INSERT INTO assets(user_id,source,scene,url,file_name,group_name,width,height,task_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, 'generated', scene, it.url, it.label || path.basename(it.url), 'AI 生成', width, height, dbTaskId, nowStr());
  }
}

// ---------- 功能目录（七大模块） ----------
r.get('/ai/catalog', (req, res) => {
  const funcs = Object.entries(FUNCTIONS)
    // 排除仅用于旧数据兼容的场景
    .filter(([key]) => !['fashion_design', 'multi_fusion', 'fabric_mapping', 'style_variation'].includes(key))
    .map(([key, m]) => ({
      key,
      module: m.module,
      name: m.name,
      hint: m.hint,
      credits: m.credits,
      local: !!m.local,
      needInstruction: !!m.needInstruction,
    }));
  res.json({ modules: MODULES, functions: funcs });
});

// 对话场景模板（旧版兼容）
r.get('/ai/templates', (req, res) => {
  res.json({ list: DIALOG_TEMPLATES.map(({ key, name, desc, prompt }) => ({ key, name, desc, prompt })) });
});

// ---------- 素材分析（三阶段之一：素材分析） ----------
const RATIO_LABEL = (w, h) => {
  const v = w / h;
  if (v > 1.33) return '横版构图';
  if (v < 0.75) return '竖版构图';
  return '方形构图';
};
const KEYWORD_RULES = [
  [/裙|dress/i, '连衣裙'], [/衬衫|衬|shirt/i, '衬衫'], [/裤|pants|trouser/i, '裤装'],
  [/面料|fabric|布|textile/i, '面料素材'], [/印花|图案|print|pattern/i, '印花图案'],
  [/线稿|草图|sketch|line/i, '线稿'], [/工艺|tech/i, '工艺素材'],
  [/模特|人像|model|person/i, '人物模特'], [/平铺|flat/i, '白底平铺'],
];

r.post('/ai/analyze', async (req, res) => {
  const images = normalizeImages(req.body.images);
  if (images.length === 0) return res.status(400).json({ error: '请先选择素材' });

  const items = [];
  for (const url of images.slice(0, MAX_IMAGES)) {
    const fp = resolveLocalPath(url);
    if (!fp || !existsSync(fp)) continue;
    const assetRow = db.prepare('SELECT file_name FROM assets WHERE user_id=? AND url=? ORDER BY id DESC LIMIT 1')
      .get(req.user.id, url);
    const name = assetRow?.file_name || '';
    let meta = { width: 0, height: 0, format: '' };
    let sizeKb = 0;
    try {
      meta = await sharp(fp).metadata();
      sizeKb = Math.round(statSync(fp).size / 1024);
    } catch { /* ignore */ }

    const tags = KEYWORD_RULES.filter(([re]) => re.test(name)).map(([, t]) => t);
    if (meta.width && meta.height) tags.push(RATIO_LABEL(meta.width, meta.height));
    items.push({
      url,
      fileName: name,
      width: meta.width || 0,
      height: meta.height || 0,
      format: (meta.format || '').toUpperCase(),
      sizeKb,
      tags: [...new Set(tags)],
    });
  }

  const kinds = [...new Set(items.flatMap((i) => i.tags))].slice(0, 4);
  const summary = `已识别 ${items.length} 张素材${kinds.length ? `，包含：${kinds.join('、')}` : ''}。素材质量良好，可直接用于 AI 编辑。`;
  res.json({ items, summary });
});

// ---------- 生成计划（三阶段之二：生成计划） ----------
r.post('/ai/plan', (req, res) => {
  const fnKey = String(req.body.fn || 'quick_edit');
  const meta = FUNCTIONS[fnKey];
  if (!meta) return res.status(400).json({ error: '功能不存在' });
  const prompt = String(req.body.prompt || '').trim();
  const images = normalizeImages(req.body.images);
  const opts = req.body.opts && typeof req.body.opts === 'object' ? req.body.opts : {};

  let steps;
  if (meta.local) {
    steps = [{ label: meta.name, desc: meta.hint }];
  } else {
    steps = meta.outputs(prompt, images.length, opts).map((it) => ({
      label: it.label,
      desc: prompt ? `按需求「${prompt.slice(0, 30)}${prompt.length > 30 ? '…' : ''}」生成` : '基于所选素材生成',
    }));
  }

  const broadcasts = [
    '素材接收成功，开始解析图像内容…',
    ...steps.map((s) => `任务拆解：${s.label}`),
    ...steps.map((s) => `正在生成：${s.label}，请稍候…`),
    ...steps.map((s, i) => `✅ ${s.label} 已完成（${i + 1}/${steps.length}）`),
    `全部完成，共 ${steps.length} 张产出，已自动存入「个人资产 · AI 生成」`,
  ];

  res.json({
    fn: fnKey,
    analysis: {
      title: '素材分析',
      points: images.length
        ? [`已加载 ${images.length} 张参考素材`, prompt ? `需求：${prompt.slice(0, 60)}` : '未提供额外指令，按素材智能生成', '图像质量校验通过']
        : ['未检测到参考素材'],
    },
    plan: { title: '生成计划', steps },
    execution: { title: '执行播报', broadcasts },
    credits: (meta.credits || 0) * (meta.local ? 1 : steps.length),
  });
});

// ---------- 提交 AI 生成任务 ----------
r.post('/ai/tasks', (req, res) => {
  const scene = String(req.body.scene || 'quick_edit');
  const prompt = String(req.body.prompt || '').trim();
  const images = normalizeImages(req.body.images);
  const projectId = Number(req.body.projectId || 0);
  const opts = req.body.opts && typeof req.body.opts === 'object' ? req.body.opts : {};
  const meta = FUNCTIONS[scene];

  if (!meta) return res.status(400).json({ error: '功能场景不正确' });
  if (!images.length) return res.status(400).json({ error: '请先选择素材' });
  if (images.length > MAX_IMAGES) return res.status(400).json({ error: `素材最多 ${MAX_IMAGES} 张` });
  if (meta.needInstruction && !prompt) return res.status(400).json({ error: '请先输入编辑需求' });
  if (prompt.length > MAX_PROMPT) return res.status(400).json({ error: `需求描述不超过 ${MAX_PROMPT} 字符` });
  if (projectId) {
    const p = db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(projectId, req.user.id);
    if (!p) return res.status(404).json({ error: '项目不存在' });
  }

  const info = db.prepare(
    `INSERT INTO ai_tasks(user_id,project_id,scene,prompt,input_images,status,created_at)
     VALUES(?,?,?,?,?,?,?)`
  ).run(req.user.id, projectId || null, scene, prompt, JSON.stringify(images), 'processing', nowStr());

  const taskId = submitTask({ scene, prompt, images, userId: req.user.id, opts });
  db.prepare('UPDATE ai_tasks SET results=? WHERE id=?').run(JSON.stringify([{ engine_task_id: taskId }]), info.lastInsertRowid);
  res.json({ taskDbId: info.lastInsertRowid, taskId });
});

// ---------- 查询任务状态（轮询） ----------
r.get('/ai/tasks/:id', async (req, res) => {
  const row = db.prepare('SELECT * FROM ai_tasks WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: '任务不存在' });

  const stored = JSON.parse(row.results || '[]');
  const engineId = stored[0]?.engine_task_id;
  const engine = engineId ? getTask(engineId) : null;
  if (!engine) return res.status(404).json({ error: '任务不存在' });

  if (engine.status !== row.status || engine.errorCode !== row.error_code) {
    const results = engine.status === 'success'
      ? JSON.stringify([{ engine_task_id: engineId }, ...engine.results])
      : row.results;
    db.prepare(
      `UPDATE ai_tasks SET status=?,error_code=?,results=?,finished_at=? WHERE id=?`
    ).run(engine.status, engine.errorCode, results, engine.finishedAt ? nowStr() : '', row.id);
    if (engine.status === 'success') {
      await recordGeneratedAssets(req.user.id, row.id, row.scene, engine.results);
    }
  }

  res.json({
    status: engine.status,
    errorCode: engine.errorCode,
    error: engine.error,
    phase: engine.phase,
    queuePos: engine.queuePos || 0,
    outputLabel: engine.outputLabel || '',
    elapsed: Math.round((Date.now() - engine.createdAt) / 1000),
    total: metaOutputCount(row.scene),
    results: engine.status === 'success' ? engine.results : [],
    partial: engine.status === 'processing' ? engine.results : [],
  });
});

// ---------- 结果保存到项目 ----------
r.post('/ai/tasks/:id/save', async (req, res) => {
  const row = db.prepare('SELECT * FROM ai_tasks WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: '任务不存在' });
  const stored = JSON.parse(row.results || '[]');
  const engineId = stored[0]?.engine_task_id;
  const engine = engineId ? getTask(engineId) : null;
  if (!engine || engine.status !== 'success') return res.status(400).json({ error: '任务尚未完成，无法保存' });

  let projectId = Number(req.body.projectId || 0);
  const lookNos = Array.isArray(req.body.lookNos) && req.body.lookNos.length > 0
    ? req.body.lookNos.map(Number)
    : engine.results.map((x) => x.lookNo);
  const picked = engine.results.filter((x) => lookNos.includes(x.lookNo));
  if (picked.length === 0) return res.status(400).json({ error: '请至少选择一张图片' });

  if (projectId) {
    const p = db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(projectId, req.user.id);
    if (!p) return res.status(404).json({ error: '项目不存在' });
  } else {
    const name = String(req.body.projectName || '').trim();
    if (!name) return res.status(400).json({ error: '请输入新项目名称' });
    const info = db.prepare('INSERT INTO projects(user_id,name,scene,created_at) VALUES(?,?,?,?)')
      .run(req.user.id, name, row.scene, nowStr());
    projectId = info.lastInsertRowid;
  }

  const ins = db.prepare(
    `INSERT INTO project_assets(project_id,user_id,kind,scene,look_no,url,prompt,created_at)
     VALUES(?,?,?,?,?,?,?,?)`
  );
  let cover = '';
  for (const item of picked) {
    const localUrl = item.url.startsWith('/uploads/')
      ? item.url
      : await persistRemote(item.url, req.user.id);
    ins.run(projectId, req.user.id, 'generated', row.scene, item.lookNo, localUrl, row.prompt, nowStr());
    if (!cover) cover = localUrl;
  }
  db.prepare('UPDATE projects SET cover=?,scene=? WHERE id=?').run(cover, row.scene, projectId);
  res.json({ ok: true, projectId });
});

// ---------- 单张下载 ----------
r.get('/download', async (req, res) => {
  const url = String(req.query.url || '');
  const name = String(req.query.name || 'look.png');
  const disposition = () => {
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  };
  try {
    if (/^https?:\/\//.test(url)) {
      const resp = await fetch(url);
      if (!resp.ok) return res.status(502).json({ error: '图片下载失败' });
      disposition();
      res.setHeader('content-type', 'image/png');
      return res.send(Buffer.from(await resp.arrayBuffer()));
    }
    if (url.startsWith('/uploads/')) {
      const filePath = resolveLocalPath(url);
      if (!filePath) return res.status(400).json({ error: '下载地址不正确' });
      disposition();
      return res.sendFile(filePath);
    }
    res.status(400).json({ error: '下载地址不正确' });
  } catch {
    res.status(502).json({ error: '图片下载失败' });
  }
});

// ---------- 批量导出 ZIP ----------
r.post('/ai/export', (req, res) => {
  const urls = normalizeImages(req.body.urls).slice(0, 50);
  if (urls.length === 0) return res.status(400).json({ error: '请选择要导出的图片' });

  const zipName = String(req.body.name || '帛序AI-批量导出').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
  res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}.zip`);
  res.setHeader('content-type', 'application/zip');

  const archive = new Archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (e) => {
    console.error('[export] archive error:', e.message);
    res.status(500).end();
  });
  archive.pipe(res);

  const usedNames = new Set();
  urls.forEach((url, i) => {
    const fp = resolveLocalPath(url);
    if (!fp || !existsSync(fp)) return;
    let base = path.basename(fp);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let outName = `${String(i + 1).padStart(2, '0')}-${stem.slice(0, 20)}${ext}`;
    let n = 1;
    while (usedNames.has(outName)) outName = `${String(i + 1).padStart(2, '0')}-${stem.slice(0, 18)}-${n++}${ext}`;
    usedNames.add(outName);
    archive.append(createReadStream(fp), { name: outName });
  });
  archive.finalize();
});

// ---------- 埋点 ----------
r.post('/track', (req, res) => {
  console.log('[track]', req.body.event || '', req.body.props || '');
  res.json({ ok: true });
});

async function persistRemote(url, userId) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('结果图下载失败');
  const buf = Buffer.from(await resp.arrayBuffer());
  const dir = path.join(UPLOAD_DIR, String(userId));
  mkdirSync(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.png`;
  writeFileSync(path.join(dir, fileName), buf);
  return `/uploads/${userId}/${fileName}`;
}

export default r;
