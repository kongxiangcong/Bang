import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const source = fileURLToPath(new URL('../../', import.meta.url));
const timestamp = '2026-11-21T12:00:00.000Z';
const row = (type, payload) => JSON.stringify({ timestamp, type, payload }) + '\n';

function beginTurn(turnId, question) {
  return row('event_msg', { type: 'task_started', turn_id: turnId }) + row('response_item', {
    type: 'message', role: 'user', content: [{ type: 'input_text', text: question }],
    internal_chat_message_metadata_passthrough: {
      turn_id: turnId, content_item_metadata: [{ provenance: { type: 'user' } }],
    },
  });
}

function completeTurn(turnId, answer) {
  return row('response_item', {
    type: 'message', role: 'assistant', phase: 'final_answer',
    content: [{ type: 'output_text', text: answer }],
  }) + row('event_msg', { type: 'task_complete', turn_id: turnId, last_agent_message: answer });
}

async function installation(t, { copySource = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "bang source install's "));
  const home = join(root, 'home');
  const skill = join(home, '.agents', 'skills', 'bang');
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(root, 'codex') };
  delete env.BANG_LLM_BASE_URL;
  delete env.BANG_LLM_MODEL;
  delete env.BANG_LLM_TIMEOUT_MS;
  delete env.BANG_LLM_API_KEY;
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const projects = [];
  t.after(async () => {
    await Promise.all(projects.map((run) => run(['stop']).catch(() => {})));
    await rm(root, { recursive: true, force: true });
  });
  const checkout = copySource ? join(root, 'source') : source;
  if (copySource) {
    await mkdir(checkout);
    await Promise.all(['install.mjs', 'packages', 'skills'].map((path) =>
      cp(join(source, path), join(checkout, path), { recursive: true })));
  }
  return {
    checkout,
    skill,
    install: () => execute(process.execPath, [join(checkout, 'install.mjs')], { env, cwd: root }),
    async learningDirectory(name, session) {
      const cwd = join(root, name);
      const sessions = join(env.CODEX_HOME, 'sessions', '2026', '11', '21');
      await Promise.all([mkdir(cwd), mkdir(sessions, { recursive: true })]);
      const transcript = join(sessions, `rollout-2026-11-21T12-00-00-${session}.jsonl`);
      await writeFile(transcript, row('session_meta', { id: session, source: 'cli', cwd }));
      const options = {
        cwd,
        env: {
          ...env, CODEX_THREAD_ID: session, CODEX_SESSION_ID: '', CODEX_TURN_ID: '', CODEX_TRANSCRIPT_PATH: '',
        },
      };
      const run = async (args) => {
        const { stdout } = await execute(process.execPath,
          ['--experimental-strip-types', join(skill, 'launch.mjs'), ...args], options);
        return JSON.parse(stdout);
      };
      const start = async () => {
        if (process.platform === 'win32') return run(['skill', 'start']);
        const document = await readFile(join(skill, 'SKILL.md'), 'utf8');
        const line = document.match(/^.+ skill start$/m)?.[0];
        assert.ok(line, 'installed start command');
        const { stdout } = await execute('/bin/sh', ['-c', line], options);
        return JSON.parse(stdout);
      };
      projects.push(run);
      return { cwd, run, start, transcript };
    },
  };
}

async function waitForEpisodes(run, slug, count) {
  let episodes = [];
  for (let attempt = 0; attempt < 30 && episodes.length < count; attempt += 1) {
    ({ episodes } = await run(['episode', 'list', '--topic', slug]));
    if (episodes.length < count) await delay(80);
  }
  return episodes;
}

async function readWhiteboard({ url, topic }) {
  const exchange = await fetch(url, { redirect: 'manual' });
  assert.equal(exchange.status, 303);
  const location = exchange.headers.get('location');
  assert.equal(location, `/?topic=${encodeURIComponent(topic.slug)}`);
  const cookie = exchange.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const board = await fetch(new URL(location, url), { headers: { Cookie: cookie } });
  assert.equal(board.status, 200);
  return board.text();
}

test('一次源码安装可在两个学习目录绑定并回读各自的第一轮 Episode', async (t) => {
  const { skill, install, learningDirectory } = await installation(t);
  await install();
  const installed = await readFile(join(skill, 'SKILL.md'), 'utf8');
  const command = installed.match(/^.+ skill start$/m)?.[0];
  assert.ok(command);
  const skillCall = row('response_item', {
    type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: command }),
  });

  for (const [name, slug, session] of [['gdn', 'gdn', 'session-a'], ['门控 学习', '门控-学习', 'session-b']]) {
    const { run, start, transcript } = await learningDirectory(name, session);
    const question = `${name} 中门控如何控制更新？`;
    const answer = '门控逐元素调制更新。';
    await appendFile(transcript, beginTurn('launch', '$bang 打开白板'));
    const receipt = await start();
    assert.equal(receipt.topic.title, name);
    assert.deepEqual(receipt.sessions, [session]);
    assert.match(receipt.message, /正在自动记录/);
    assert.match(receipt.message, /整理模型尚未配置/);
    const exchange = await fetch(receipt.url, { redirect: 'manual' });
    assert.equal(exchange.status, 303);
    assert.equal(exchange.headers.get('location'), `/?topic=${encodeURIComponent(slug)}`);
    assert.equal((await fetch(receipt.url, { redirect: 'manual' })).status, 401);

    await appendFile(transcript, completeTurn('launch', receipt.message) +
      beginTurn('link-only', '给我刚才的那个链接。') + skillCall +
      completeTurn('link-only', `[白板](http://127.0.0.1:4318/api/auth/exchange?token=${'X'.repeat(43)})`) +
      beginTurn('study', `$bang\n\n${question}`));
    const continued = await start();
    await appendFile(transcript, completeTurn('study', `专题 ${name}。${continued.message}\n\n${answer}`));
    const episodes = await waitForEpisodes(run, slug, 1);
    assert.deepEqual(episodes.map((episode) => episode.turnId), ['study']);
    const original = await run(['episode', 'get', episodes[0].id, '--topic', slug]);
    assert.deepEqual(original.messages.map(({ content }) => content), [question, answer]);
  }
});

test('源码更新期间原项目沿用原版本采集，新启动的项目使用新版', async (t) => {
  const { checkout, install, learningDirectory } = await installation(t, { copySource: true });
  const board = join(checkout, 'packages', 'web', 'src', 'whiteboard', 'index.html');
  const originalBoard = await readFile(board, 'utf8');
  const oldBoard = originalBoard + '\n<!-- Old Bang release -->\n';
  const newBoard = originalBoard + '\n<!-- New Bang release -->\n';
  await writeFile(board, oldBoard);
  await install();

  const a = await learningDirectory('gdn', 'session-a');
  const initial = await a.start();
  assert.deepEqual(initial.sessions, ['session-a']);
  assert.equal(await readWhiteboard(initial), oldBoard);
  const { pid } = await a.run(['status']);
  assert.ok(pid);
  await appendFile(a.transcript, beginTurn('before', '门控控制什么？') + completeTurn('before', '门控控制更新。'));
  const before = await waitForEpisodes(a.run, 'gdn', 1);
  assert.deepEqual(before.map(({ turnId }) => turnId), ['before']);

  const question = '门控为零时会发生什么？';
  const answer = '该位置不会写入新信息。';
  await appendFile(a.transcript, beginTurn('during', question));
  await writeFile(board, newBoard);
  await install();
  await appendFile(a.transcript, completeTurn('during', answer));

  const captured = await waitForEpisodes(a.run, 'gdn', 2);
  assert.deepEqual(captured.map(({ turnId }) => turnId).sort(), ['before', 'during']);
  const during = captured.find(({ turnId }) => turnId === 'during');
  const readDuring = () => a.run(['episode', 'get', during.id, '--topic', 'gdn']);
  assert.deepEqual((await readDuring()).messages.map(({ content }) => content), [question, answer]);

  const continued = await a.start();
  assert.deepEqual(continued.topic, initial.topic);
  assert.deepEqual(continued.sessions, initial.sessions);
  assert.equal((await a.run(['status'])).pid, pid);
  assert.equal(await readWhiteboard(continued), oldBoard);

  const b = await learningDirectory('attention', 'session-b');
  const updated = await b.start();
  assert.equal(updated.topic.title, 'attention');
  assert.deepEqual(updated.sessions, ['session-b']);
  assert.equal(await readWhiteboard(updated), newBoard);

  await a.run(['stop']);
  const restarted = await a.start();
  assert.deepEqual(restarted.topic, initial.topic);
  assert.deepEqual(restarted.sessions, initial.sessions);
  assert.equal(await readWhiteboard(restarted), newBoard);
  assert.deepEqual((await readDuring()).messages.map(({ content }) => content), [question, answer]);
});

test('新版技能停止旧守护进程后保留末轮，后续状态查询不会恢复旧绑定', async (t) => {
  const { checkout, install, learningDirectory } = await installation(t, { copySource: true });
  const server = join(checkout, 'packages', 'core', 'src', 'server.ts');
  const current = await readFile(server, 'utf8');
  const legacy = current.replace(/      if \(method === 'POST' && url\.pathname === '\/api\/stop'\) \{[\s\S]*?\n      \}/u, `
      if (method === 'POST' && url.pathname === '/api/stop') {
        response.once('finish', () => void close());
        return json({ running: false });
      }`).replace(', ready, captureStop: true', ', ready');
  assert.notEqual(legacy, current);
  await writeFile(server, legacy);
  await install();
  const project = await learningDirectory('gdn', 'legacy-watcher');
  await project.start();

  await writeFile(server, current);
  await install();
  await appendFile(project.transcript, beginTurn('before-stop', '停止前已完成的问答？') +
    completeTurn('before-stop', '这一轮仍然属于原采集区间。'));
  assert.deepEqual((await project.run(['skill', 'stop'])).unverifiedSessions, []);
  const afterStop = new Date().toISOString();
  await appendFile(project.transcript, (beginTurn('after-stop', '停采以后？') +
    completeTurn('after-stop', '这一轮应跳过。')).replaceAll(timestamp, afterStop));
  assert.deepEqual((await project.run(['skill', 'status'])).topics[0].sessions, []);
  const episodes = await waitForEpisodes(project.run, 'gdn', 1);
  assert.deepEqual(episodes.map(({ turnId }) => turnId), ['before-stop']);
});

test('更新安装失败后仍可用原有技能启动并访问原专题', async (t) => {
  const { checkout, skill, install, learningDirectory } = await installation(t, { copySource: true });
  await install();
  const document = join(skill, 'SKILL.md');
  const installed = await readFile(document, 'utf8');
  const a = await learningDirectory('gdn', 'session-a');
  const initial = await a.start();
  const originalBoard = await readWhiteboard(initial);
  await a.run(['stop']);

  const entry = join(checkout, 'packages', 'adapters', 'src', 'cli.ts');
  await writeFile(entry, "throw new Error('Broken Bang release');\n");
  await assert.rejects(install(), { code: 1, stderr: /Broken Bang release/ });
  assert.equal(await readFile(document, 'utf8'), installed);

  const recovered = await a.start();
  assert.deepEqual(recovered.topic, initial.topic);
  assert.deepEqual(recovered.sessions, initial.sessions);
  assert.equal(await readWhiteboard(recovered), originalBoard);
});

test('重装刷新 Bang 技能并保留用户编写和修改的同名技能', async (t) => {
  const { skill, install } = await installation(t);
  await install();
  const document = join(skill, 'SKILL.md');
  assert.match((await install()).stdout, /已安装 Bang 技能/);
  const managed = await readFile(document, 'utf8');

  const edited = managed.replace('# Bang', '# 我的 Bang 技能');
  await writeFile(document, edited);
  assert.match((await install()).stdout, /已保留现有 Bang 技能/);
  assert.equal(await readFile(document, 'utf8'), edited);

  const custom = await installation(t);
  const original = '---\nname: bang\ndescription: My Bang skill\n---\n\nMy instructions.\n';
  const customDocument = join(custom.skill, 'SKILL.md');
  await mkdir(custom.skill, { recursive: true });
  await writeFile(customDocument, original);
  assert.match((await custom.install()).stdout, /已保留现有 Bang 技能/);
  assert.equal(await readFile(customDocument, 'utf8'), original);
});

test('配置整理模型后可处理该专题已保存的 Episode', async (t) => {
  const { install, learningDirectory } = await installation(t);
  await install();
  const { cwd, run, start, transcript } = await learningDirectory('gdn', 'session-a');
  assert.match((await start()).message, /整理模型尚未配置/);
  await appendFile(transcript, beginTurn('study', '门控如何控制更新？') + completeTurn('study', '门控逐元素调制更新。'));
  const episodes = await waitForEpisodes(run, 'gdn', 1);
  assert.equal(episodes.length, 1);
  const submitted = [];
  const provider = createServer(async (request, response) => {
    const call = JSON.parse(await text(request));
    const input = JSON.parse(call.messages[1].content);
    submitted.push(...input.episodes.map(({ id }) => id));
    const content = JSON.stringify({
      landmarks: [], remove_landmarks: [], relationships: [], remove_relationships: [], epistemic_hints: [],
    });
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => { provider.closeAllConnections(); provider.close(); });
  await writeFile(join(cwd, '.bang', 'config.json'), JSON.stringify({
    auto_watch_project: false, llm: { base_url: `http://127.0.0.1:${provider.address().port}/v1`, model: 'test-model' },
  }));
  assert.equal((await start()).model, 'configured');
  await run(['sync', '--topic', 'gdn']);
  const { jobs } = await run(['status', '--topic', 'gdn']);
  assert.equal(jobs[0].status, 'done');
  assert.deepEqual(submitted, [episodes[0].id]);
});
