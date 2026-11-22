import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import test from 'node:test';
import { createProject } from './cli.mjs';

function turn(id, content, sessionId = 'session') {
  return {
    sourceTool: 'cli', sessionId, turnId: String(id),
    messages: [
      { role: 'user', timestamp: '2026-01-01T00:00:00Z', content },
      { role: 'assistant', timestamp: '2026-01-01T00:01:00Z', content: 'The rule applies under load.' },
    ],
  };
}

async function fixture(t, respond) {
  const provider = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      const call = JSON.parse(await text(request));
      assert.equal(call.model, 'test-model');
      assert.equal(call.response_format.json_schema.strict, true);
      const input = JSON.parse(call.messages[1].content);
      const answer = await respond(call.response_format.json_schema.name, input);
      const { finishReason = 'stop', ...structured } = answer;
      const content = JSON.stringify(structured);
      response.end(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }));
    } catch (error) {
      t.diagnostic(String(error.stack));
      response.writeHead(500).end();
    }
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => { provider.closeAllConnections(); provider.close(); });
  const project = await createProject(t);
  const { run, path } = project;
  await run(['init']);
  await writeFile(join(path, '.bang', 'config.json'), JSON.stringify({
    auto_watch_project: false,
    llm: { base_url: `http://127.0.0.1:${provider.address().port}/v1`, model: 'test-model' },
  }));
  await run(['topic', 'create', 'Rules']);
  return project;
}

function landmark(id) {
  return {
    id: 'rule', kind: 'claim', tag: 'finding', title: 'Load rule',
    detail: 'Under load, use the rule.', conditions: ['Under load'],
    event_time: null, source_episodes: [id],
  };
}

const empty = { landmarks: [], remove_landmarks: [], relationships: [], remove_relationships: [], epistemic_hints: [] };

test('手动同步提交带原文引用的专题版本，重启后增量为空时保留原版本与导出', async (t) => {
  let calls = 0;
  const { run, path } = await fixture(t, (stage, input) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(stage, 'bang_pass1');
      assert.deepEqual(input.previous.landmarks, []);
      return { ...empty, landmarks: [landmark(input.episodes[0].id)] };
    }
    if (calls === 2) {
      assert.equal(stage, 'bang_pass2');
      assert.deepEqual(input.blurry, []);
      return { summary: 'Add load rule', operations: [{ op: 'ADD_NODE', node: input.session.landmarks[0] }] };
    }
    assert.equal(calls, 3);
    assert.equal(stage, 'bang_pass1');
    assert.equal(input.previous.landmarks[0].title, 'Load rule');
    assert.deepEqual(input.episodes.map(({ turnId }) => turnId), ['2']);
    return empty;
  });
  const initial = await run(['ingest', '--topic', 'rules'], turn(1, 'How does the rule work?'));
  const first = await run(['sync', '--topic', 'rules']);
  assert.equal(first.jobs[0].status, 'done');
  assert.equal(first.jobs[0].revision, 1);
  const board = await run(['inspect', '--topic', 'rules']);
  assert.equal(board.revision, 1);
  assert.deepEqual(board.knowledge.nodes[0].source_episodes, [initial.episode.id]);
  assert.deepEqual((await run(['episode', 'get', '--topic', 'rules', initial.episode.id])).messages, initial.episode.messages);
  const snapshots = ['knowledge.json', 'epistemic.json', 'layout.json'];
  const getSnapshots = () => Promise.all(snapshots.map((file) => readFile(join(path, '.bang', 'topics', 'rules', file), 'utf8')));
  const initialExport = await getSnapshots();

  await run(['stop']);
  await run(['ingest', '--topic', 'rules'], turn(2, 'Thanks.'));
  const second = await run(['sync', '--topic', 'rules']);
  assert.equal(second.jobs[0].status, 'done');
  assert.equal(second.jobs[0].revision, null);
  assert.equal((await run(['inspect', '--topic', 'rules'])).revision, 1);
  assert.deepEqual((await run(['sync', '--topic', 'rules'])).jobs, []);
  await run(['export', '--topic', 'rules']);
  assert.deepEqual(await getSnapshots(), initialExport);
  assert.equal(calls, 3);
});

test('来源不属于本专题时不提交任何算子，重试从已保存的 Pass 2 继续', async (t) => {
  const stages = [];
  let unrelated;
  const { run } = await fixture(t, (stage, input) => {
    stages.push(stage);
    if (stage === 'bang_pass1') return { ...empty, landmarks: [landmark(input.episodes[0].id)] };
    const node = input.session.landmarks[0];
    if (stages.length === 2) {
      return {
        summary: 'Invalid sources',
        operations: [
          { op: 'ADD_NODE', node },
          { op: 'ADD_NODE', node: { ...node, id: 'foreign', source_episodes: [unrelated] } },
        ],
      };
    }
    if (stages.length === 3) {
      return {
        finishReason: 'length',
        summary: 'A truncated response looks like valid JSON',
        operations: [{ op: 'ADD_NODE', node }],
      };
    }
    return { summary: 'Add load rule', operations: [{ op: 'ADD_NODE', node }] };
  });
  await run(['topic', 'create', 'Another topic']);
  unrelated = (await run(['ingest', '--topic', 'another-topic'], turn(1, 'Unrelated question.'))).episode.id;
  await run(['ingest', '--topic', 'rules'], turn(1, 'How does the rule work?'));

  const sync = () => run(['sync', '--topic', 'rules']);
  const inspect = () => run(['inspect', '--topic', 'rules']);
  const rejected = (await sync()).jobs[0];
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.error.code, 'invalid_model_output');
  assert.equal((await inspect()).revision, 0);
  assert.deepEqual((await inspect()).knowledge.nodes, []);

  await run(['stop']);
  const truncated = (await sync()).jobs[0];
  assert.equal(truncated.id, rejected.id);
  assert.equal(truncated.status, 'failed');
  assert.equal(truncated.error.code, 'invalid_model_output');
  assert.equal((await inspect()).revision, 0);

  const corrected = (await sync()).jobs[0];
  assert.equal(corrected.id, rejected.id);
  assert.equal(corrected.status, 'done');
  assert.equal(corrected.revision, 1);
  assert.deepEqual(stages, ['bang_pass1', 'bang_pass2', 'bang_pass2', 'bang_pass2']);
});

test('指定原生会话时，各来源独立处理轮次与水位', async (t) => {
  const inputs = [];
  const { run } = await fixture(t, (stage, input) => {
    assert.equal(stage, 'bang_pass1');
    inputs.push(input.episodes.map(({ id }) => id));
    return empty;
  });
  const ingest = async (id, sourceTool, sessionId = 'shared') =>
    (await run(['ingest', '--topic', 'rules'], { ...turn(id, 'Question', sessionId), sourceTool })).episode.id;
  const cliEpisode = await ingest(1, 'cli');
  const codexEpisode = await ingest(1, 'codex');
  const otherEpisode = await ingest(1, 'cli', 'other');

  const sync = (...args) => run(['sync', '--topic', 'rules', ...args]);
  const scoped = await sync('--session', 'shared');
  assert.deepEqual(scoped.jobs.map(({ sessionId, sourceTool, episodeIds }) => ({ sessionId, sourceTool, episodeIds })), [
    { sessionId: 'shared', sourceTool: 'cli', episodeIds: [cliEpisode] },
    { sessionId: 'shared', sourceTool: 'codex', episodeIds: [codexEpisode] },
  ]);
  assert.deepEqual((await sync('--session', 'shared')).jobs, []);
  const next = await ingest(2, 'codex');
  assert.deepEqual((await sync()).jobs.map(({ episodeIds }) => episodeIds), [[next], [otherEpisode]]);
  assert.deepEqual(inputs.map(([id]) => id).sort(), [cliEpisode, codexEpisode, next, otherEpisode].sort());
});

test('较长的自述只支持自报掌握度，用户实际复述以后可以验证', async (t) => {
  const reported = '我现在已经完全理解这个过程了，谢谢你的解释！';
  const demonstrated = '因为误差只沿非零的 key 分量写入，所以 key = [1, 0] 时只更新第一列。';
  let selfReported = false;
  const { run } = await fixture(t, (stage, input) => {
    if (stage === 'bang_pass1') {
      const episode = input.episodes[0];
      const state = {
        node_id: 'rule', source_episodes: [episode.id],
        mastery: episode.turnId === '1' && selfReported ? 'self_reported' : 'verified',
        quote: { episode_id: episode.id, text: episode.messages[0].content },
        stance: null, belief_shift: null,
      };
      return { ...empty, landmarks: input.previous.landmarks.length ? [] : [landmark(episode.id)], epistemic_hints: [state] };
    }
    return { summary: 'Update mastery', operations: [
      ...input.changes.landmarks.map((node) => ({ op: 'ADD_NODE', node })),
      { op: 'SHIFT_EPISTEMIC', state: input.session.epistemic_hints[0] },
    ] };
  });
  const ingest = (id, user) => run(['ingest', '--topic', 'rules'], turn(id, user));
  const sync = () => run(['sync', '--topic', 'rules']);
  const inspect = () => run(['inspect', '--topic', 'rules']);

  await ingest(1, reported);
  assert.equal((await sync()).jobs[0].error?.code, 'invalid_model_output');
  assert.deepEqual((await inspect()).epistemic.nodes, []);
  selfReported = true;
  assert.equal((await sync()).jobs[0].status, 'done');
  assert.equal((await inspect()).epistemic.nodes[0].mastery, 'self_reported');
  await ingest(2, demonstrated);
  assert.equal((await sync()).jobs[0].status, 'done');
  assert.equal((await inspect()).epistemic.nodes[0].mastery, 'verified');
});

test('无查询的 inspect 默认省略被替代的路标，选项可查看其来源', async (t) => {
  const { run } = await fixture(t, (stage, input) => {
    if (stage === 'bang_pass1') {
      const episode = input.episodes[0];
      const node = landmark(episode.id);
      return { ...empty, landmarks: [
        episode.turnId === '1' ? node : { ...node, id: 'revised', title: 'Revised load rule' },
      ] };
    }
    const node = input.changes.landmarks[0];
    return { summary: 'Update load rule', operations: [
      node.id === 'rule' ? { op: 'ADD_NODE', node } : {
        op: 'SUPERSEDE', replacement: node,
        edge: {
          id: 'revision', from: 'revised', to: 'rule', skeleton: 'supersedes',
          predicate: 'replaces', provenance: 'EXTRACTED', source_episodes: node.source_episodes,
        },
      },
    ] };
  });
  const [ingest, sync, inspect] = ['ingest', 'sync', 'inspect'].map((command) => [command, '--topic', 'rules']);
  const initial = (await run(ingest, turn(1, 'What rule applies?'))).episode.id;
  await run(sync);
  await run(ingest, turn(2, 'There is a new rule.'));
  assert.equal((await run(sync)).jobs[0].status, 'done');

  const current = await run(inspect);
  assert.deepEqual(current.knowledge.nodes.map(({ id }) => id), ['revised']);
  assert.deepEqual(current.knowledge.edges, []);
  const withHistory = await run([...inspect, '--include-superseded']);
  assert.deepEqual(withHistory.knowledge.nodes.map(({ id, status }) => ({ id, status })), [
    { id: 'rule', status: 'superseded' }, { id: 'revised', status: 'active' },
  ]);
  assert.deepEqual(withHistory.knowledge.nodes[0].source_episodes, [initial]);
  assert.deepEqual(withHistory.knowledge.edges.map(({ id }) => id), ['revision']);
});

test('修订轮次没有新结论时，当前白板不再展示仅由旧版支持的路标', async (t) => {
  let calls = 0;
  const { run, path } = await fixture(t, (stage, input) => {
    calls += 1;
    if (stage === 'bang_pass1') {
      const episode = input.episodes[0];
      if (calls === 1) return { ...empty, landmarks: [landmark(episode.id)] };
      assert.deepEqual(input.previous.landmarks, []);
      assert.equal(episode.messages[0].content, 'Withdrawn.');
      return empty;
    }
    if (calls === 2) return { summary: 'Add load rule', operations: [{ op: 'ADD_NODE', node: input.session.landmarks[0] }] };
    return { summary: 'No new conclusion', operations: [] };
  });
  const [ingest, sync, inspect] = ['ingest', 'sync', 'inspect'].map((command) => [command, '--topic', 'rules']);
  const initial = (await run(ingest, turn(1, 'What rule applies?'))).episode;
  assert.equal((await run(sync)).revision, 1);
  assert.equal((await run(inspect)).knowledge.nodes[0].id, 'rule');

  const revised = (await run(ingest, { ...turn(1, 'Withdrawn.'), replacesEpisodeId: initial.id })).episode;
  const synced = await run(sync);
  assert.equal(synced.jobs[0].status, 'done');
  assert.equal(synced.revision, 1);
  assert.deepEqual((await run(inspect)).knowledge.nodes, []);
  const { nodes } = JSON.parse(await readFile(join(path, '.bang', 'topics', 'rules', 'knowledge.json'), 'utf8'));
  assert.deepEqual(nodes, []);
  assert.deepEqual(await run(['episode', 'get', '--topic', 'rules', initial.id]), initial);
  assert.equal(revised.replacesEpisodeId, initial.id);
});

test('待重试的 Pass 2 遇到来源修订时，先刷新会话再提交新版证据', async (t) => {
  const stages = [];
  const { run } = await fixture(t, (stage, input) => {
    stages.push(stage);
    if (stage === 'bang_pass1') {
      const episode = input.episodes[0];
      const node = { ...landmark(episode.id), detail: episode.messages[0].content };
      assert.deepEqual(input.previous.landmarks, []);
      return { ...empty, landmarks: [node] };
    }
    const [node] = input.session.landmarks;
    if (stages.length === 2) return { finishReason: 'length', summary: 'Incomplete merge', operations: [] };
    return { summary: 'Add the current rule', operations: [{ op: 'ADD_NODE', node }] };
  });
  const [ingest, sync, inspect] = ['ingest', 'sync', 'inspect'].map((command) => [command, '--topic', 'rules']);
  const initial = (await run(ingest, turn(1, 'Original description.'))).episode;
  const failed = (await run(sync)).jobs[0];
  assert.equal(failed.stage, 'pass2_merge');
  assert.equal(failed.status, 'failed');

  const revised = (await run(ingest, { ...turn(1, 'Revised description.'), replacesEpisodeId: initial.id })).episode;
  const recovered = (await run(sync)).jobs[0];
  assert.equal(recovered.id, failed.id);
  assert.equal(recovered.status, 'done');
  assert.deepEqual(stages, ['bang_pass1', 'bang_pass2', 'bang_pass1', 'bang_pass2']);
  const [node] = (await run(inspect)).knowledge.nodes;
  assert.equal(node.detail, 'Revised description.');
  assert.deepEqual(node.source_episodes, [revised.id]);
  assert.deepEqual((await run(sync)).jobs, []);
});

test('模型请求超时支持配置和环境覆盖，拒绝超出上限的值', async (t) => {
  const { run, path } = await fixture(t, () => empty);
  const configPath = join(path, '.bang', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.llm.timeout_ms = 3_600_001;
  await writeFile(configPath, JSON.stringify(config));
  await run(['ingest', '--topic', 'rules'], turn(1, 'How does the rule work?'));

  const sync = ['sync', '--topic', 'rules'];
  const invalid = (await run(sync)).jobs[0];
  assert.equal(invalid.error?.code, 'invalid_reasoning_timeout');
  await run(['stop']);
  const recovered = (await run(sync, undefined, { BANG_LLM_TIMEOUT_MS: '5000' })).jobs[0];
  assert.equal(recovered.id, invalid.id);
  assert.equal(recovered.status, 'done');
});
