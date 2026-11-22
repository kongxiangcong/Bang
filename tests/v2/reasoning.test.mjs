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
