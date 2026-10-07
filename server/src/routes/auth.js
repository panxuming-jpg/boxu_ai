import { Router } from 'express';
import { db } from '../db.js';
import { signToken, authRequired } from '../auth.js';
import { nowStr } from '../util.js';

const r = Router();

// 演示模式：验证码直接返回（也接受万能码 123456）
r.post('/send-code', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare(
    `INSERT INTO verify_codes(phone,code,expires_at) VALUES(?,?,?)
     ON CONFLICT(phone) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at`
  ).run(phone, code, Date.now() + 10 * 60 * 1000);
  res.json({ code, message: '验证码已发送（演示模式直接返回）' });
});

r.post('/login', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const code = String(req.body.code || '').trim();
  if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  const row = db.prepare('SELECT * FROM verify_codes WHERE phone=?').get(phone);
  const valid = code === '123456' || (row && row.code === code && row.expires_at > Date.now());
  if (!valid) return res.status(400).json({ error: '验证码错误或已过期' });
  let user = db.prepare('SELECT id,phone,name FROM users WHERE phone=?').get(phone);
  if (!user) {
    // MVP：首次验证码登录自动注册
    const info = db.prepare('INSERT INTO users(phone,name,created_at) VALUES(?,?,?)')
      .run(phone, `设计师${phone.slice(-4)}`, nowStr());
    user = db.prepare('SELECT id,phone,name FROM users WHERE id=?').get(info.lastInsertRowid);
  }
  const token = signToken({ uid: user.id, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.json({ token, user });
});

r.get('/me', authRequired, (req, res) => res.json({ user: req.user }));

export default r;
