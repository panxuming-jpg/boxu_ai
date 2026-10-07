import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '../db.js';
import { authRequired } from '../auth.js';
import { nowStr } from '../util.js';
import { UPLOAD_DIR, MAX_FILE_SIZE, MAX_IMAGES } from '../config.js';

const r = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, String(req.user.id));
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
    cb(null, `${crypto.randomUUID()}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return cb(new Error('FORMAT'));
    }
    cb(null, true);
  },
});

const insProjectAsset = db.prepare(
  `INSERT INTO project_assets(project_id,user_id,kind,url,file_name,created_at) VALUES(?,?,?,?,?,?)`
);
const insPersonalAsset = db.prepare(
  `INSERT INTO assets(user_id,source,scene,url,file_name,group_name,width,height,created_at)
   VALUES(?,?,?,?,?,?,?,?,?)`
);

// 图片上传（最多 20 张）；query projectId 存在时同时写入项目素材；query group 写入个人资产分组
r.post('/upload', authRequired, (req, res, next) => {
  upload.array('files', MAX_IMAGES)(req, res, async (err) => {
    if (err) {
      if (err.message === 'FORMAT' || err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '图片仅支持 JPG/PNG，单张不超过 15MB' });
      }
      return next(err);
    }
    try {
      const projectId = Number(req.query.projectId || 0);
      if (projectId) {
        const p = db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(projectId, req.user.id);
        if (!p) return res.status(404).json({ error: '项目不存在' });
      }
      const group = String(req.query.group || '默认分组').slice(0, 30) || '默认分组';
      const scene = String(req.query.scene || '');

      const list = [];
      for (const f of req.files) {
        const url = `/uploads/${req.user.id}/${f.filename}`;
        let width = 0;
        let height = 0;
        try {
          const m = await sharp(path.join(UPLOAD_DIR, String(req.user.id), f.filename)).metadata();
          width = m.width || 0;
          height = m.height || 0;
        } catch { /* 元数据失败不阻塞上传 */ }

        insPersonalAsset.run(req.user.id, 'upload', scene, url, f.originalname, group, width, height, nowStr());
        if (projectId) insProjectAsset.run(projectId, req.user.id, 'upload', url, f.originalname, nowStr());
        list.push({ url, fileName: f.originalname, width, height });
      }
      res.json({ list });
    } catch (e) {
      next(e);
    }
  });
});

export default r;
