import { createServer, request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cloudConfig, readRelease } from '../api/src/cloud.mjs';

const defaultDist = fileURLToPath(new URL('./dist/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
export function webServer({ config, release, apiUrl, dist = defaultDist }) {
  const api = new URL(apiUrl);
  if (api.protocol !== 'http:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash || !(/^[a-z0-9-]+\.railway\.internal$/.test(api.hostname) || api.hostname === '127.0.0.1')) throw new Error('API_INTERNAL_URL must address the private API');
  return createServer(async (req, res) => {
    const reply = (status, message) => { if (res.headersSent) { res.destroy(); return; } res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: { message } })); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      if (req.url === '/health/ready' && req.method === 'GET') {
        await readFile(resolve(dist, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ status: 'ok', role: 'web', ...release })); return;
      }
      if (req.headers.host !== config.host || req.headers['x-forwarded-proto'] !== 'https') return reply(403, '허용된 HTTPS 주소로 접속해 주세요.');
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) return reply(400, '잘못된 경로입니다.');
      const url = new URL(req.url, config.origin);
      if (url.pathname.startsWith('/api/')) {
        const headers = {};
        for (const key of ['accept', 'content-type', 'content-length', 'cookie', 'origin', 'idempotency-key', 'last-event-id', 'authorization', 'x-webhook-key-id', 'x-webhook-signature', 'x-webhook-timestamp']) if (req.headers[key] !== undefined) headers[key] = req.headers[key];
        // Railway's edge supplies X-Real-IP. Never forward caller-supplied internal headers.
        const ip = req.headers['x-real-ip'];
        headers['x-crm-client'] = typeof ip === 'string' && isIP(ip) ? ip : req.socket.remoteAddress;
        headers['x-crm-proxy-token'] = config.proxyToken;
        const upstream = httpRequest({ hostname: api.hostname, port: api.port || 80, path: url.pathname.slice(4) + url.search, method: req.method, headers }, incoming => {
          const outgoing = {};
          for (const key of ['content-type', 'cache-control', 'set-cookie', 'retry-after', 'content-length']) if (incoming.headers[key] !== undefined) outgoing[key] = incoming.headers[key];
          res.writeHead(incoming.statusCode, outgoing); incoming.pipe(res);
        });
        upstream.setTimeout(45000, () => upstream.destroy(new Error('API timeout')));
        upstream.on('error', () => reply(502, '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'));
        req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy());
        req.pipe(upstream); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return reply(405, '지원하지 않는 요청입니다.');
      if (url.pathname === '/') { res.writeHead(302, { Location: '/live' }); res.end(); return; }
      const asset = url.pathname.startsWith('/assets/');
      if (!asset && url.pathname !== '/live' && !url.pathname.startsWith('/live/')) return reply(404, '화면을 찾을 수 없습니다.');
      const file = asset ? resolve(dist, `.${decodeURIComponent(url.pathname)}`) : resolve(dist, 'index.html');
      if (!file.startsWith(resolve(dist) + sep)) return reply(400, '잘못된 파일 경로입니다.');
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': asset ? 'public, max-age=31536000, immutable' : 'no-store' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch { reply(503, '화면을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = webServer({ config: cloudConfig(), release: readRelease(), apiUrl: process.env.API_INTERNAL_URL });
  server.listen(Number(process.env.PORT || 8080), '::', () => console.log('CRM Web listening.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(() => process.exit(0)); server.closeIdleConnections(); const force = setTimeout(() => process.exit(1), 25000); force.unref(); });
}
