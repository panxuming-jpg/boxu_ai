import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowStr } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'boxu.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verify_codes(
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  scene TEXT DEFAULT '',                 -- fashion_design / print_design / fabric_apply / tech_pack
  cover TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_assets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- upload 原图 / generated 生成图
  scene TEXT DEFAULT '',
  look_no INTEGER DEFAULT 0,
  url TEXT NOT NULL,
  prompt TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  scene TEXT NOT NULL DEFAULT 'fashion_design',
  prompt TEXT NOT NULL DEFAULT '',
  input_images TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'processing', -- processing / success / failed
  error_code TEXT DEFAULT '',            -- timeout / safety / service
  results TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  finished_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS assets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,                  -- upload 上传 / generated AI生成
  scene TEXT DEFAULT '',
  url TEXT NOT NULL,
  file_name TEXT DEFAULT '',
  group_name TEXT DEFAULT '默认分组',
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  task_id INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

// 演示种子账号：13800000000（登录也支持任意手机号自动注册）
if (!count('users')) {
  db.prepare('INSERT INTO users(phone,name,created_at) VALUES(?,?,?)')
    .run('13800000000', '演示设计师', nowStr());
}

export { nowStr };
