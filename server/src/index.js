import './load-env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import uploadRoutes from './routes/upload.js';
import aiRoutes from './routes/ai.js';
import assetRoutes from './routes/assets.js';
import { UPLOAD_DIR } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRoutes);
app.use('/api', projectRoutes);
app.use('/api', uploadRoutes);
app.use('/api', aiRoutes);
app.use('/api', assetRoutes);

// 用户上传图片（UUID 文件名，不可枚举）
app.use('/uploads', express.static(UPLOAD_DIR));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '系统服务异常，请稍后重试' });
});

const dist = path.join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 3200;
app.listen(PORT, () => console.log(`帛序 AI 后端已启动: http://localhost:${PORT}`));
