import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createProject } from './cli.mjs';

async function discovery(path) {
  return JSON.parse(await readFile(join(path, '.bang', 'server.json'), 'utf8'));
}

test('同时启动分配各项目的发现端口和令牌，单项目的并发启动共用同一个服务', async (t) => {
  const first = await createProject(t);
  const second = await createProject(t);
  const [a, same, b] = await Promise.all([
    first.run(['serve']), first.run(['serve']), second.run(['serve']),
  ]);
  assert.deepEqual(a, same);
  assert.notEqual(a.port, b.port);
  const [one, two] = await Promise.all([discovery(first.path), discovery(second.path)]);
  assert.notEqual(one.token, two.token);
  if (process.platform !== 'win32') {
    for (const file of ['server.json', 'bang.db']) {
      const metadata = await stat(join(first.path, '.bang', file));
      assert.equal(metadata.mode & 0o777, 0o600);
    }
  }
  const gitignore = await readFile(join(first.path, '.gitignore'), 'utf8');
  for (const path of ['/.bang/bang.db*', '/.bang/server.json*', '/.bang/credentials.json*']) {
    assert.ok(gitignore.split('\n').includes(path));
  }
  const config = JSON.parse(await readFile(join(first.path, '.bang', 'config.json'), 'utf8'));
  assert.equal(config.auto_watch_project, false);
  assert.ok(!JSON.stringify(config).includes(one.token));
});

test('本地服务检查 Host、Origin、CLI 凭据和一次性浏览器交换', async (t) => {
  const first = await createProject(t);
  const second = await createProject(t);
  await Promise.all([first.run(['init']), second.run(['init'])]);
  const topic = await first.run(['topic', 'create', 'GDN']);
  const [one, two] = await Promise.all([discovery(first.path), discovery(second.path)]);
  const endpoint = `http://127.0.0.1:${one.port}`;
  const bearer = { Authorization: `Bearer ${one.token}` };
  const actual = await fetch(`${endpoint}/api/health`, { headers: bearer });
  assert.equal(actual.status, 200);
  const { project_root, pid, token } = await actual.json();
  assert.equal(project_root, first.path);
  assert.equal(pid, one.pid);
  assert.equal(token, undefined);
  const otherAddress = Object.values(networkInterfaces()).flat()
    .find((address) => address && address.family === 'IPv4' && !address.internal);
  if (otherAddress) {
    await assert.rejects(fetch(`http://${otherAddress.address}:${one.port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    }));
  }
  assert.equal((await fetch(`${endpoint}/api/topics`, { headers: { ...bearer, Origin: endpoint } })).status, 200);
  assert.equal((await fetch(`${endpoint}/api/topics`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${two.port}/api/topics`, { headers: bearer })).status, 401);
  for (const origin of ['https://example.com', `http://127.0.0.1:${two.port}`, 'null']) {
    assert.equal((await fetch(`${endpoint}/api/topics`, { headers: { ...bearer, Origin: origin } })).status, 403);
  }
  const invalidHost = await new Promise((resolve, reject) => {
    const req = request(`${endpoint}/api/topics`, { headers: { ...bearer, Host: 'example.com' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject).end();
  });
  assert.equal(invalidHost, 403);

  const [{ url }, { url: otherUrl }] = await Promise.all([
    first.run(['open', '--url', '--topic', topic.slug]), second.run(['open', '--url']),
  ]);
  assert.notEqual(new URL(url).searchParams.get('token'), one.token);
  const runExchange = (url) => fetch(url, { redirect: 'manual' });
  const [exchange, otherExchange] = await Promise.all([runExchange(url), runExchange(otherUrl)]);
  assert.equal(exchange.status, 303);
  assert.equal(exchange.headers.get('location'), '/?topic=gdn');
  const cookieHeader = exchange.headers.get('set-cookie');
  assert.match(cookieHeader, /; HttpOnly; SameSite=Strict;/);
  const cookie = cookieHeader.split(';')[0];
  const otherCookie = otherExchange.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie.split('=')[0], otherCookie.split('=')[0]);
  assert.equal((await runExchange(url)).status, 401);
  const board = await fetch(`${endpoint}/?topic=gdn`, { headers: { Cookie: cookie } });
  assert.equal(board.status, 200);
  assert.match(await board.text(), /<main[^>]+id="canvas"/);
  assert.match(board.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(`${endpoint}/whiteboard.js`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${endpoint}/api/topics`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${endpoint}/api/topics`, { headers: { Cookie: otherCookie } })).status, 401);
  assert.equal((await fetch(`${endpoint}/api/topics`, {
    headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-site' },
  })).status, 401);
  assert.equal((await fetch(`${endpoint}/api/stop`, {
    method: 'POST', headers: { Cookie: cookie },
  })).status, 401);
});
