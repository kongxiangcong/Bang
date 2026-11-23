import assert from 'node:assert/strict';
import { once } from 'node:events';
import { appendFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import test from 'node:test';
import { createProject } from './cli.mjs';

test('查询未初始化项目只报告状态，不创建项目文件', async (t) => {
  const { path, run } = await createProject(t);
  assert.deepEqual(await run(['skill', 'status']), {
    status: 'uninitialized', message: 'Bang 尚未初始化。',
  });
  assert.deepEqual(await readdir(path), []);
});

async function bind({ path, run }, topic, sessionId) {
  const transcript = join(path, sessionId + '.jsonl');
  await writeFile(transcript, JSON.stringify({
    type: 'session_meta', payload: { id: sessionId, source: 'cli', cwd: path },
  }) + '\n');
  await run(['bind', '--topic', topic, '--session', sessionId, '--transcript', transcript]);
  return transcript;
}

async function openBoard(url, topic) {
  const exchange = await fetch(url, { redirect: 'manual' });
  assert.equal(exchange.status, 303);
  const board = new URL(exchange.headers.get('location'), url);
  assert.equal(board.searchParams.get('topic'), topic);
  const Cookie = exchange.headers.get('set-cookie').split(';')[0];
  const page = await fetch(board, { headers: { Cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<main[^>]+id="canvas"/);
}

test('未绑定的会话可查看各专题、采集会话和可重新签发的独立白板链接', async (t) => {
  const project = await createProject(t);
  const { run } = project;
  for (const name of ['GDN', 'Delta Rule', 'Archived']) await run(['topic', 'create', name]);
  await bind(project, 'gdn', 'active-capture');
  await bind(project, 'delta-rule', 'ended-capture');
  await run(['unbind', '--session', 'ended-capture']);
  await bind(project, 'archived', 'archived-capture');
  await run(['topic', 'archive', 'archived']);
  const status = () => run(['skill', 'status'], undefined, { CODEX_THREAD_ID: 'never-bound' });
  const before = await run(['status']);
  const receipt = await status();
  assert.equal(receipt.status, 'ready');
  assert.deepEqual(receipt.topics.map(({ topic, sessions, turnCount, latestReasoning }) =>
    [topic.title, sessions, turnCount, latestReasoning]), [
    ['GDN', ['active-capture'], 0, null],
    ['Delta Rule', [], 0, null],
    ['Archived', [], 0, null],
  ]);
  assert.equal(new Set(receipt.topics.map(({ url }) => url)).size, 3);
  for (const { topic, url } of receipt.topics) await openBoard(url, topic.slug);
  const [first] = receipt.topics;
  assert.equal((await fetch(first.url, { redirect: 'manual' })).status, 401);
  const [refreshed] = (await status()).topics;
  assert.notEqual(refreshed.url, first.url);
  await openBoard(refreshed.url, 'gdn');
  assert.deepEqual(await run(['status']), before);
});

test('同文轮次分别计数，修订保留原文版本，进度按成功完成顺序取值', async (t) => {
  const { path, run } = await createProject(t);
  await run(['topic', 'create', 'GDN']);
  const earlier = Promise.withResolvers();
  const release = Promise.withResolvers();
  const provider = createServer(async (request, response) => {
    const payload = JSON.parse(await text(request));
    const { episodes } = JSON.parse(payload.messages[1].content);
    if (episodes[0].messages[0].content === '修订后的提问') {
      response.writeHead(500).end();
      return;
    }
    if (episodes[0].sessionId === 'earlier') {
      earlier.resolve();
      await release.promise;
    }
    const content = JSON.stringify({
      landmarks: [], remove_landmarks: [], relationships: [], remove_relationships: [], epistemic_hints: [],
    });
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => {
    release.resolve();
    provider.closeAllConnections();
    provider.close();
  });
  await writeFile(join(path, '.bang', 'config.json'), JSON.stringify({
    llm: { base_url: `http://127.0.0.1:${provider.address().port}/v1`, model: 'test-model' },
  }));

  function record(turnId, sessionId, content = '为什么只更新第一列？', replacement = {}) {
    return run(['ingest', '--topic', 'gdn'], {
      sourceTool: 'host',
      sessionId,
      turnId,
      messages: [
        { role: 'user', timestamp: '2026-01-01T00:00:00Z', content },
        { role: 'assistant', timestamp: '2026-01-01T00:01:00Z', content: '第二个键分量为零。' },
      ],
      ...replacement,
    });
  }
  const { episode: first } = await record('1', 'earlier');
  const { episode: original } = await record('2', 'earlier');
  const { episode: third } = await record('1', 'later', '不同会话的第一轮');
  assert.deepEqual(first.messages, original.messages);
  const status = async () => (await run(['skill', 'status'])).topics[0];
  assert.equal((await status()).turnCount, 3);

  const earlierSync = run(['sync', '--topic', 'gdn', '--session', 'earlier']);
  await Promise.race([earlier.promise, earlierSync.then((value) => assert.fail(JSON.stringify(value)))]);
  try {
    const laterJob = (await run(['sync', '--topic', 'gdn', '--session', 'later'])).jobs[0];
    assert.equal(laterJob.status, 'done');
    assert.equal((await status()).latestReasoning.throughEpisodeId, third.id);
  } finally {
    release.resolve();
    await earlierSync;
  }

  const revision = { replacesEpisodeId: original.id, revisionId: 'rewrite' };
  const revised = await record('2', 'earlier', '修订后的提问', revision);
  assert.equal((await record('2', 'earlier', '修订后的提问', revision)).status, 'duplicate');
  const failed = (await run(['sync', '--topic', 'gdn', '--session', 'earlier'])).jobs[0];
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.episodeIds, [revised.episode.id]);

  const row = await status();
  assert.equal(row.turnCount, 3);
  assert.deepEqual(row.latestReasoning, {
    sessionId: 'earlier', sourceTool: 'host', throughEpisodeId: original.id, throughTurnId: '2', revision: null,
  });
  for (const episode of [original, revised.episode]) {
    assert.deepEqual(await run(['episode', 'get', '--topic', 'gdn', episode.id]), episode);
  }
});

function codexTurn(id, question) {
  const timestamp = new Date().toISOString();
  const answer = '答案见更新规则。';
  const rows = [
    ['event_msg', { type: 'task_started', turn_id: id }],
    ['event_msg', { type: 'user_message', message: question }],
    ['event_msg', { type: 'agent_message', phase: 'final_answer', message: answer }],
    ['event_msg', { type: 'task_complete', turn_id: id, last_agent_message: answer }],
  ];
  return rows.map(([type, payload]) => JSON.stringify({ timestamp, type, payload })).join('\n') + '\n';
}

test('主动停止点名未核实的会话，状态重启白板且保持停采', async (t) => {
  const project = await createProject(t);
  const { run } = project;
  await run(['topic', 'create', 'GDN']);
  const visible = await bind(project, 'gdn', 'visible');
  const missing = await bind(project, 'gdn', 'unverified');
  await rename(missing, missing + '.moved');
  await appendFile(visible, codexTurn('saved', '停止前的问题'));
  const stopped = await run(['skill', 'stop']);
  assert.equal(stopped.running, false);
  assert.match(stopped.message, /已停止/);
  assert.deepEqual(stopped.unverifiedSessions, ['unverified']);
  assert.deepEqual(await run(['status']), { running: false });

  const status = () => run(['skill', 'status'], undefined, { CODEX_THREAD_ID: 'visible' });
  const receipt = await status();
  assert.equal(receipt.status, 'ready');
  assert.equal(receipt.message, '白板服务已启动，当前无会话正在采集。');
  const [board] = receipt.topics;
  assert.deepEqual(board.sessions, []);
  assert.equal(board.turnCount, 1);
  await openBoard(board.url, 'gdn');
  await appendFile(visible, codexTurn('outside', '停采期间的问题'));
  await rename(missing + '.moved', missing);
  const restored = (await status()).topics[0];
  assert.deepEqual(restored.sessions, []);
  assert.equal(restored.turnCount, 1);
  const { episodes } = await run(['episode', 'list', '--topic', 'gdn']);
  assert.deepEqual(episodes.map(({ turnId }) => turnId), ['saved']);
});
