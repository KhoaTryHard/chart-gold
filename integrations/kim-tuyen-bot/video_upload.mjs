// Upload a bounded local MP4 directly to Blob with an ephemeral scoped token.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire('D:/KinhDoanh/chart-gold/package.json');
const { put } = require('@vercel/blob/client');
try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const file = path.resolve(input.path);
  const base = path.resolve('C:/Users/LENOVO/kim-tuyen-ai/assets/video') + path.sep;
  if (!file.startsWith(base) || fs.statSync(file).size > 45 * 1024 * 1024) throw new Error('Invalid upload asset');
  const bytes = fs.readFileSync(file);
  if (input.sha256 && createHash('sha256').update(bytes).digest('hex') !== input.sha256) throw new Error('Upload checksum mismatch');
  if (input.bytes && input.bytes !== bytes.length) throw new Error('Upload size mismatch');
  let blob;
  if (input.upload?.provider === 'r2') {
    const url = new URL(input.upload.url);
    const virtualHost = /^chart-gold-media-prod\.[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname);
    const pathHost = /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname);
    const expectedPath = virtualHost ? '/' + input.pathname : '/chart-gold-media-prod/' + input.pathname;
    if (url.protocol !== 'https:' || !(virtualHost || pathHost) || url.username || url.password || url.port ||
        decodeURIComponent(url.pathname) !== expectedPath || input.upload.method !== 'PUT' ||
        input.upload.headers?.['content-type'] !== 'video/mp4' || input.upload.headers?.['if-none-match'] !== '*' ||
        input.upload.headers?.['content-length'] !== String(bytes.length)) throw new Error('Invalid R2 upload grant');
    const response = await fetch(url, { method: 'PUT', headers: input.upload.headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(150000) });
    if (!response.ok) throw new Error('R2 upload not confirmed; read back the asset');
    blob = { pathname: input.pathname };
  } else {
    blob = await put(input.pathname, bytes, { access: 'private', token: input.clientToken, contentType: 'video/mp4', multipart: true });
  }
  process.stdout.write(JSON.stringify({ success: true, pathname: blob.pathname, size: fs.statSync(file).size }));
} catch (error) {
  const rawMessage = String(error?.message || '');
  const safeMessage = rawMessage.replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]').slice(0, 220);
  process.stdout.write(JSON.stringify({ success: false, error_type: error?.name || 'UploadError', message: safeMessage }));
  process.exitCode = 1;
}
