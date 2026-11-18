// Explicit local acceptance against an extracted validation package.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createPrivateKey } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [installArgument, codexArgument] = process.argv.slice(2);
if (!installArgument || !codexArgument) throw Error('Usage: node tests/installed-security.mjs EXTRACTED_PACKAGE PINNED_CODEX');
const install = await fs.realpath(installArgument);
const codex = await fs.realpath(codexArgument);
const windows = process.platform === 'win32';
const node = path.join(install, windows ? 'node/node.exe' : 'node/bin/node');
const release = path.join(install, 'release/bang.mjs');
const cli = path.join(install, 'runtime/canvas/bang.mjs');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'Bang security '));
const project = path.join(temp, 'project A');
const other = path.join(temp, 'project B');
const authHome = path.join(temp, 'empty Codex home');
const syntheticPrompt = 'Synthetic discussion prompt marker 44';
const syntheticCredential = 'synthetic-credential-marker-44';
const unaccepted = 'Synthetic unaccepted event marker 44';
const services = [];
const diagnostics = [];
const evidence = [];
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(SYSTEMROOT|WINDIR|COMSPEC|PATH|TEMP|TMP|TMPDIR|USERPROFILE|HOME|USER|USERNAME|LOGNAME|LANG|LC_.*|LOCALAPPDATA|APPDATA)$/i.test(name),
));
Object.assign(env, {
  HOME: temp, USERPROFILE: temp, CODEX_HOME: authHome, APPDATA: temp, LOCALAPPDATA: temp,
  BANG_ORGANIZER_CODEX: JSON.stringify({ version: 1, executable: codex, authHome, model: 'gpt-6.1-sol' }),
});

function run(entry, args, input, extraEnv) {
  const result = spawnSync(node, [entry, ...args], {
    env: { ...env, ...extraEnv }, input: input === undefined ? undefined : JSON.stringify(input),
    cwd: project, encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  diagnostics.push(result.stderr ?? '');
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return JSON.parse(result.stdout);
}

function canvas(command, target, topic, input) {
  return run(cli, [command, '--project', target, ...(topic ? ['--topic', topic] : [])], input);
}

async function serve(target) {
  const args = ['serve', '--project', target];
  const child = spawn(windows ? node : path.join(install, 'bang'), windows ? [release, ...args] : args, {
    env, cwd: project, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  services.push(child);
  child.stderr.setEncoding('utf8').on('data', data => diagnostics.push(data));
  const output = createInterface({ input: child.stdout });
  const line = await Promise.race([
    once(output, 'line').then(([value]) => value),
    once(child, 'close').then(([code]) => { throw Error('Installed editor stopped: ' + code); }),
    delay(20000, undefined, { ref: false }).then(() => { throw Error('Installed editor start timed out'); }),
  ]);
  return new URL(JSON.parse(line).url).origin;
}

async function request(origin, route, { token, headers, data } = {}) {
  const body = data === undefined ? undefined : JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = http.request(origin + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
        ...(token && { 'x-bang-browser-token': token }), ...headers,
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8').on('data', data => { text += data; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.setTimeout(5000, () => req.destroy(Error('Local request timed out')));
    req.on('error', reject).end(body);
  });
}

function check(response, status, description) {
  assert.equal(response.status, status, description);
  assert.ok(!response.text.includes(syntheticCredential), 'response must omit credential marker');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  evidence.push(description);
  if (response.headers['content-type']?.startsWith('application/json')) return JSON.parse(response.text);
}

const box = { x: 0, y: 0, width: 280, height: 160 };
const patch = (topic, card) => ({
  operationId: 'validate-' + card.id, topic, baseRevision: 0,
  author: { kind: 'manual', id: 'test-editor' }, intent: 'explicit-save', readDependencies: [],
  operations: [{ type: 'create-card', card: { ...box, ...card } }],
});

try {
  await Promise.all([project, other, authHome].map(dir => fs.mkdir(dir, { mode: 0o700 })));
  const health = run(release, ['check', '--project', project, '--codex', codex]);
  assert.equal(health.package, 'verified');
  assert.equal(health.codex.version, '0.169.0-alpha.11.1');
  assert.equal(run(release, ['install-codex', '--project', project, '--codex', codex]).status, 'installed-needs-trust');
  canvas('generate', project, 'demo', { cards: [] });
  canvas('generate', project, 'control', { cards: [] });
  canvas('generate', other, 'demo', { cards: [] });
  const first = await serve(project);
  const second = await serve(other);
  const bootstrap = '/api/canvas/session/bootstrap';
  const state = '/api/canvas/demo/state';
  const commit = '/api/canvas/demo/commit';
  const own = check(await request(first, bootstrap, { headers: { origin: first } }), 200, 'same-origin bootstrap');
  const foreign = check(await request(second, bootstrap), 200, 'second project bootstrap');
  assert.notEqual(own.workspaceId, foreign.workspaceId);
  assert.notEqual(own.token, foreign.token);
  const saved = patch('demo', { id: 'saved', text: 'Synthetic authorized manual save' });

  check(await request(first, bootstrap, { headers: { origin: second } }), 403, 'foreign origin');
  check(await request(first, bootstrap, { headers: { host: 'unrelated.test' } }), 403, 'foreign host');
  check(await request(first, bootstrap, { headers: { 'sec-fetch-site': 'cross-site' } }), 403, 'cross-site fetch');
  check(await request(first, commit, { data: saved }), 403, 'missing editor token');
  check(await request(first, commit, { token: '0'.repeat(64), data: saved }), 403, 'wrong editor token');
  check(await request(second, commit, { token: own.token, data: saved }), 403, 'cross-project token');
  check(await request(first, commit, { token: own.token, headers: { 'x-bang-restored-project': 'project-B' }, data: saved }), 400, 'restored-project selector requires an allocated identifier');
  check(await request(first, commit, { token: own.token, data: { ...saved, topic: 'control' } }), 400, 'route and patch topic mismatch');
  check(await request(first, commit, { token: own.token, data: { ...saved, author: { kind: 'organizer', id: 'test-organizer' } } }), 400, 'editor requires explicit manual author for direct write');

  const descriptor = JSON.parse(await fs.readFile(path.join(project, '.bang/runtime/connection.json'), 'utf8'));
  assert.notEqual(own.token, descriptor.token);
  const control = { command: 'state', topic: 'demo' };
  const daemonHeaders = { 'x-bang-token': descriptor.token, 'x-bang-epoch': descriptor.epoch };
  check(await request(descriptor.url, '/control', { data: control }), 403, 'daemon requires capability');
  check(await request(descriptor.url, '/control', { headers: { ...daemonHeaders, 'x-bang-token': own.token }, data: control }), 403, 'browser token denied by daemon');
  check(await request(descriptor.url, '/control', { headers: { ...daemonHeaders, origin: first }, data: control }), 403, 'foreign daemon origin');
  check(await request(descriptor.url, '/control', { headers: { ...daemonHeaders, host: 'unrelated.test' }, data: control }), 403, 'foreign daemon host');
  check(await request(descriptor.url, '/control', { headers: daemonHeaders, data: control }), 200, 'owner daemon state');

  const outsideFile = path.join(other, 'reference.txt');
  await fs.writeFile(outsideFile, 'Synthetic external project document');
  await fs.symlink(other, path.join(project, 'outside'), windows ? 'junction' : 'dir');
  for (const [id, status, resource] of [
    ['credential-url', 400, { type: 'link', url: 'https://example.test/?token=' + syntheticCredential }],
    ['reserved-url-scheme', 400, { type: 'link', url: 'javascript:void(0)' }],
    ['external-document', 400, { type: 'file', file: path.relative(project, outsideFile) }],
    ['linked-document', 409, { type: 'file', file: 'outside/reference.txt' }],
  ]) {
    check(await request(first, commit, { token: own.token, data: patch('demo', { id, ...resource }) }), status, id + ' rejected');
  }
  const preview = { canvas: { nodes: [{ ...box, id: 'group', type: 'group', label: 'Fixture', background: 'outside/reference.txt' }], edges: [] } };
  check(await request(first, '/api/canvas/demo/import-preview', { token: own.token, data: preview }), 400, 'import rejects linked group background');
  assert.equal(check(await request(first, state, { token: own.token }), 200, 'original board observable').revision, 0);
  check(await request(first, commit, { token: own.token, data: saved }), 200, 'authorized write succeeds');

  const hook = path.join(install, 'runtime/codex/hook.mjs');
  const hookEvent = { hook_event_name: 'UserPromptSubmit', session_id: 'test-unbound', turn_id: 'test-turn', cwd: project, prompt: unaccepted };
  for (const event of [hookEvent, { ...hookEvent, agent_id: 'controlled-child' }, { ...hookEvent, hook_event_name: 'Stop' }]) {
    assert.deepEqual(run(hook, [project, '--context-v1'], event, { CODEX_THREAD_ID: 'test-unbound' }), {});
  }
  assert.deepEqual(canvas('binding-sources', project, undefined, { topicId: 'demo' }), []);
  check(await request(first, '/api/canvas/session/ingest', { token: own.token, data: { batch: { sourceId: 'unbound', events: [] } } }), 400, 'browser cannot authorize an unbound source');

  const { CodexSessionConnector, CODEX_VERSION } = await import(pathToFileURL(path.join(install, 'runtime/codex/connector.mjs')));
  const registration = JSON.parse(await fs.readFile(path.join(project, '.bang/runtime/codex-install.json'), 'utf8'));
  let bodyReads = 0;
  let parentThreadId = 'primary-parent';
  const transport = { version: CODEX_VERSION, async request(method, args) {
    if (method === 'thread/read') return { thread: { id: args.threadId, sessionId: args.threadId, source: 'cli', parentThreadId, cwd: project, cliVersion: CODEX_VERSION, historyMode: 'paginated' } };
    if (method === 'thread/turns/list') return { data: [{ id: 'test-turn', status: 'completed', completedAt: 1 }], backwardsCursor: 'anchor', nextCursor: null };
    assert.equal(method, 'thread/items/list');
    bodyReads++;
    return { data: [
      { type: 'userMessage', content: [{ type: 'text', text: syntheticPrompt }] },
      { type: 'agentMessage', phase: 'final_answer', id: 'test-response', text: 'Synthetic final response' },
    ], nextCursor: null };
  } };
  const connector = new CodexSessionConnector({ project, transport, connectorId: registration.connectorId, instanceId: registration.instanceId, privateKey: createPrivateKey(registration.privateKey) });
  await assert.rejects(connector.enable(hookEvent, { scope: ['*'] }), /primary thread/);
  assert.equal(bodyReads, 0);
  parentThreadId = null;
  const bound = await connector.enable(hookEvent, { scope: ['control'], topicId: 'control' });
  const topic = bound.topic.id;
  assert.deepEqual(await connector.poll(topic, 'unbound-source'), { status: 'disabled', received: 0 });
  assert.equal(bodyReads, 0);
  assert.equal((await connector.poll(topic, bound.source.id)).received, 1);
  assert.equal(bodyReads, 1);
  evidence.push('installed source connector rejects child and unbound metadata before body read');

  const [source] = canvas('binding-sources', project, undefined, { topicId: topic });
  const batch = { sourceId: source.id, previousCursor: source.receivedCursor, events: [
    { kind: 'turn', role: 'subagent', status: 'completed', turnId: 'child', cursor: 'test-child' },
    { kind: 'turn', role: 'organizer', status: 'completed', turnId: 'worker', cursor: 'test-worker' },
  ] };
  const proof = connector.proof({
    workspaceId: own.workspaceId, sessionId: source.sessionId, turnId: source.startTurnId,
    cursor: source.startCursor, scope: [topic], purpose: 'completed-turn-ingestion', sourceId: source.id,
    batchHash: createHash('sha256').update(JSON.stringify(batch)).digest('hex'),
  });
  const ignored = canvas('turn-ingest', project, undefined, { batch, proof });
  assert.equal(ignored.received, 0);
  const queued = canvas('turn-status', project, undefined, { topicId: topic });
  assert.deepEqual(queued.ignored.map(event => event.cursor), ['test-child', 'test-worker']);
  evidence.push('child and Organizer events do not reenter the CompletedTurn queue');
  const sourceQuery = '/source?id=' + encodeURIComponent(queued.pending[0].id);
  const authorized = check(await request(first, '/api/canvas/' + topic + sourceQuery, { token: own.token }), 200, 'authorized topic can inspect its synthetic source');
  assert.equal(authorized.user.content, syntheticPrompt);
  check(await request(first, '/api/canvas/demo' + sourceQuery, { token: own.token }), 400, 'source scoped to its authorized topic');

  const organizer = '/api/canvas/' + topic + '/organizer';
  check(await request(first, organizer + '-configure', { token: own.token, data: { limits: { executable: syntheticCredential } } }), 400, 'editor cannot set executor in limits');
  check(await request(first, organizer + '-enable', { token: own.token, data: {} }), 200, 'enable owner-configured organizer');
  let task;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await request(first, organizer, { token: own.token });
    assert.equal(response.status, 200);
    assert.ok(!response.text.includes(syntheticPrompt));
    task = JSON.parse(response.text).tasks[0];
    if (task?.status === 'failed') break;
    await delay(50);
  }
  assert.equal(task?.error?.code, 'AUTH_REQUIRED');
  assert.equal(task.process.executor.stage, 'authorization');
  assert.equal(task.process.exitConfirmed, true);
  assert.equal(task.attempts.length, 1);
  const turns = canvas('turn-status', project, undefined, { topicId: topic });
  assert.equal(turns.received, 1);
  assert.equal(turns.organized, 0);
  evidence.push('actual pinned Codex stops at empty-home authorization before model dispatch');

  canvas('stop', project);
  canvas('stop', other);
  assert.equal(canvas('state', project, 'demo').revision, 1);
  assert.equal(canvas('state', project, 'control').revision, 0);
  assert.equal(canvas('state', other, 'demo').revision, 0);
  const eventLog = await fs.readFile(path.join(project, '.bang/runtime/events.jsonl'), 'utf8');
  const publications = eventLog.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(publications.some(event => event.event === 'publication-confirmed' && event.revision === 1));
  for (const event of publications) assert.deepEqual(Object.keys(event).sort(), ['at', 'event', 'revision']);
  for (const marker of [syntheticPrompt, syntheticCredential, unaccepted, own.token, descriptor.token]) {
    assert.ok(![eventLog, ...diagnostics].some(output => output.includes(marker)), 'ordinary diagnostics must omit private markers');
  }
  assert.equal(createHash('sha256').update(await fs.readFile(outsideFile)).digest('hex'), createHash('sha256').update('Synthetic external project document').digest('hex'));
  evidence.push('reopened project and topic scopes unchanged by refusals', 'ordinary publication logs and diagnostics omit private markers');
  console.log(JSON.stringify({ pass: true, platform: health.platform, osRelease: os.release(), sourceCommit: health.sourceCommit, codex: health.codex.version, evidence }));
} finally {
  for (const child of services) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
  }
  for (const target of [project, other]) {
    spawnSync(node, [release, 'stop', '--project', target], { env, stdio: 'ignore', timeout: 15000, windowsHide: true });
  }
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
