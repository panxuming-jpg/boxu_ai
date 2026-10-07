import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';
import { nowStr, fmtDateTime } from '../util.js';
import { SCENES } from '../engine/jimeng.js';

const r = Router();
r.use(authRequired);

// 项目列表（作品集卡片）
r.get('/projects', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id,p.name,p.scene,p.cover,p.created_at,
        (SELECT COUNT(*) FROM project_assets a WHERE a.project_id=p.id AND a.kind='upload') upload_count,
        (SELECT COUNT(*) FROM project_assets a WHERE a.project_id=p.id AND a.kind='generated') generated_count
       FROM projects p WHERE p.user_id=? ORDER BY p.id DESC`
    )
    .all(req.user.id);
  res.json({
    list: rows.map((p) => ({
      ...p,
      scene_name: SCENES[p.scene]?.name || '',
      created_label: fmtDateTime(new Date(p.created_at.replace(' ', 'T')).getTime()),
    })),
  });
});

// 新建项目
r.post('/projects', (req, res) => {
  const name = String(req.body.name || '').trim();
  const scene = String(req.body.scene || '');
  if (!name) return res.status(400).json({ error: '请输入项目名称' });
  if (name.length > 50) return res.status(400).json({ error: '项目名称不超过 50 字' });
  if (scene && !SCENES[scene]) return res.status(400).json({ error: '项目类型不正确' });
  const info = db.prepare('INSERT INTO projects(user_id,name,scene,created_at) VALUES(?,?,?,?)')
    .run(req.user.id, name, scene, nowStr());
  res.json({ id: info.lastInsertRowid });
});

// 项目详情 + 全部素材
r.get('/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const assets = db
    .prepare('SELECT * FROM project_assets WHERE project_id=? ORDER BY id')
    .all(p.id);
  res.json({
    project: { ...p, scene_name: SCENES[p.scene]?.name || '', created_label: fmtDateTime(new Date(p.created_at.replace(' ', 'T')).getTime()) },
    assets,
  });
});

// 删除项目（连带素材）
r.delete('/projects/:id', (req, res) => {
  const p = db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  db.prepare('DELETE FROM project_assets WHERE project_id=?').run(p.id);
  db.prepare('DELETE FROM projects WHERE id=?').run(p.id);
  res.json({ ok: true });
});

export default r;
