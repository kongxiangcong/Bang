import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';

const assets = new Map([
  ['/', { file: 'index.html', type: 'text/html' }],
  ['/whiteboard.js', { file: 'whiteboard.js', type: 'text/javascript' }],
  ['/whiteboard.css', { file: 'whiteboard.css', type: 'text/css' }],
]);

export function serveWhiteboard(path: string, response: ServerResponse) {
  const asset = assets.get(path);
  if (!asset) return false;
  const content = readFileSync(new URL(`./whiteboard/${asset.file}`, import.meta.url));
  response.writeHead(200, {
    'Content-Type': `${asset.type}; charset=utf-8`,
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(content);
  return true;
}
