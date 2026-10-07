import crypto from 'node:crypto';
import { db } from './db.js';

const SECRET = 'boxu-ai-secret-2026';

export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expect) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function authRequired(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const p = verifyToken(token);
  if (!p) return res.status(401).json({ error: '未登录或登录已过期' });
  const user = db.prepare('SELECT id,phone,name FROM users WHERE id=?').get(p.uid);
  if (!user) return res.status(401).json({ error: '账号不存在' });
  req.user = user;
  next();
}
