// 火山引擎 OpenAPI V4 签名与请求封装
// 签名规范：https://www.volcengine.com/docs/6369/67269
// 适用视觉服务：Region=cn-north-1, Service=cv, POST application/json
import crypto from 'node:crypto';

const HOST = 'visual.volcengineapi.com';
const REGION = 'cn-north-1';
const SERVICE = 'cv';
const VERSION = '2022-08-31';
const HTTP_TIMEOUT_MS = 15 * 1000; // 单次 HTTP 请求超时，避免网络挂起无限等待

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}
function hmac(key, content) {
  // 中间派生值必须使用 Buffer digest 传递
  return crypto.createHmac('sha256', key).update(content).digest();
}

/**
 * 调用火山引擎视觉 OpenAPI
 * @param {string} action 如 CVSync2AsyncSubmitTask / CVSync2AsyncGetResult
 * @param {object} bodyObj 请求体对象
 * @returns {Promise<object>} JSON 响应
 */
export async function volcApi(action, bodyObj) {
  const ak = process.env.VOLC_ACCESS_KEY;
  const sk = process.env.VOLC_SECRET_KEY;
  if (!ak || !sk) throw new Error('未配置 VOLC_ACCESS_KEY / VOLC_SECRET_KEY');

  const body = JSON.stringify(bodyObj);
  // x-date：20261007T120000Z
  const xDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  // CanonicalQueryString（按参数名字典序；值均为固定安全字符）
  const canonicalQuery = `Action=${action}&Version=${VERSION}`;

  // 参与签名的请求头（名字小写、字典序、值 trim，每行以 \n 结尾）
  const headers = {
    'content-type': 'application/json',
    host: HOST,
    'x-content-sha256': payloadHash,
    'x-date': xDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k].trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  // 1. CanonicalRequest
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // 2. StringToSign
  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // 3. 派生签名密钥（SK 直接作为初始密钥，不加前缀）
  const kDate = hmac(sk, shortDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'request');

  // 4. 签名
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  headers.Authorization =
    `HMAC-SHA256 Credential=${ak}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`https://${HOST}/?${canonicalQuery}`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { code: 50432, data: null, message: `request timeout after ${HTTP_TIMEOUT_MS}ms` };
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // 网关/服务返回非 JSON（如纯文本错误页、HTML），包装为结构化错误
    json = {
      code: resp.ok ? 59999 : resp.status || 59999,
      data: null,
      message: `non-json response [${resp.status} ${resp.headers.get('content-type') || ''}]: ${text.slice(0, 300)}`,
    };
  }
  return json;
}
