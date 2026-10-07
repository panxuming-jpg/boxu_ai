import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';

const r = Router();
r.use(authRequired);

// 素材列表
// tab: all 全部个人资产 / upload 历史上传 / generated 生成记录
// q: 按文件名搜索；group: 按分组筛选
r.get('/assets', (req, res) => {
  const tab = String(req.query.tab || 'all');
  const q = String(req.query.q || '').trim();
  const group = String(req.query.group || '').trim();

  const where = ['user_id = ?'];
  const params = [req.user.id];
  if (tab === 'upload' || tab === 'generated') {
    where.push('source = ?');
    params.push(tab);
  }
  if (q) {
    where.push('file_name LIKE ?');
    params.push(`%${q}%`);
  }
  if (group) {
    where.push('group_name = ?');
    params.push(group);
  }

  const list = db.prepare(
    `SELECT id,source,scene,url,file_name,group_name,width,height,task_id,created_at
     FROM assets WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 300`
  ).all(...params);

  const groups = db.prepare(
    'SELECT DISTINCT group_name FROM assets WHERE user_id=? ORDER BY group_name'
  ).all(req.user.id).map((x) => x.group_name);

  res.json({ list, groups });
});

// 重命名
r.post('/assets/:id/rename', (req, res) => {
  const id = Number(req.params.id);
  const fileName = String(req.body.fileName || '').trim().slice(0, 60);
  if (!fileName) return res.status(400).json({ error: '名称不能为空' });
  const info = db.prepare('UPDATE assets SET file_name=? WHERE id=? AND user_id=?')
    .run(fileName, id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: '素材不存在' });
  res.json({ ok: true });
});

// 移动分组（不存在则自动创建）
r.post('/assets/:id/group', (req, res) => {
  const id = Number(req.params.id);
  const groupName = String(req.body.group || '').trim().slice(0, 30) || '默认分组';
  const info = db.prepare('UPDATE assets SET group_name=? WHERE id=? AND user_id=?')
    .run(groupName, id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: '素材不存在' });
  res.json({ ok: true });
});

// 删除（仅移除资产记录，源文件保留以防其他引用）
r.delete('/assets/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM assets WHERE id=? AND user_id=?')
    .run(id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: '素材不存在' });
  res.json({ ok: true });
});

export default r;
