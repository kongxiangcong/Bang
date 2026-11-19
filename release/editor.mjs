import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createCanvasMiddleware } from '../runtime/canvas/http.mjs';

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
]);

export async function serveEditor(root, project, port, resourceFiles) {
  const middleware = createCanvasMiddleware({ project });
  const assets = new Set(Object.keys(resourceFiles).filter(file => file.startsWith('editor/')));
  const server = http.createServer(async (req, res) => {
    const host = '127.0.0.1:' + req.socket.localPort;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== 'http://' + host) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403).end();
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) {
        res.writeHead(400).end();
        return;
      }
      const { pathname } = new URL(req.url, 'http://' + host);
      if (pathname.startsWith('/api/canvas/')) {
        await middleware(req, res);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const asset = pathname === '/' ? 'editor/canvas.html' : 'editor' + pathname;
      const contentType = types.get(path.extname(asset));
      if (!assets.has(asset) || !contentType) {
        res.writeHead(404).end();
        return;
      }
      const contents = await fs.readFile(path.join(root, asset));
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      res.writeHead(200, { 'Content-Length': contents.length });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { url: 'http://127.0.0.1:' + server.address().port + '/canvas.html', close: () => server.close() };
}
