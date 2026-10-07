// 参考图提交前预处理：
// 火山视觉网关请求体上限约 10MB，大图（如手机照片 10MB）base64 后会触发
// 400 "Error when parsing request"。这里统一压缩：
//   - 最长边限制（默认 2048，即梦输出本身为 2K，参考图无需更大）
//   - 转 JPEG，按图片数量动态分配质量
//   - 保证整体 base64 在安全预算内
import sharp from 'sharp';

const TOTAL_BASE64_BUDGET = 8.5 * 1024 * 1024; // 整体 base64 预算（留余量）
const MAX_EDGE = 2048;

/**
 * @param {string[]} filePaths 本地图片路径
 * @returns {Promise<string[]>} 压缩后的 base64（不含 data: 前缀）
 */
export async function prepareRefImages(filePaths) {
  const n = filePaths.length;
  if (n === 0) return [];

  // 每张图的 base64 预算
  const perBudget = Math.floor(TOTAL_BASE64_BUDGET / n);

  const results = [];
  for (const fp of filePaths) {
    let buf = await encode(fp, MAX_EDGE, 82);
    // 超预算则逐级降质量，再超则缩边
    if (buf.toString('base64').length > perBudget) {
      for (const q of [70, 58, 46]) {
        buf = await encode(fp, MAX_EDGE, q);
        if (buf.toString('base64').length <= perBudget) break;
      }
    }
    let edge = MAX_EDGE;
    while (buf.toString('base64').length > perBudget && edge > 1024) {
      edge = Math.floor(edge * 0.8);
      buf = await encode(fp, edge, 55);
    }
    results.push(buf.toString('base64'));
  }
  return results;
}

async function encode(fp, maxEdge, quality) {
  const img = sharp(fp, { failOn: 'none' }).rotate(); // 自动按 EXIF 旋正
  const meta = await img.metadata();
  if (meta.width && meta.height && Math.max(meta.width, meta.height) > maxEdge) {
    img.resize({
      width: meta.width >= meta.height ? maxEdge : null,
      height: meta.height > meta.width ? maxEdge : null,
      withoutEnlargement: true,
    });
  }
  return img.jpeg({ quality, mozjpeg: true }).toBuffer();
}
