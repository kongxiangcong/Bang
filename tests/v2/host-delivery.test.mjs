import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createProject } from './cli.mjs';

const cli = fileURLToPath(new URL('../../packages/adapters/src/cli.ts', import.meta.url));

async function mcp(t, project) {
  const child = spawn(process.execPath, ['--experimental-strip-types', cli, '--project', project, 'mcp'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  t.after(() => { child.kill(); });
  async function request(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
    const reply = await replies.next();
    assert.equal(reply.done, false, 'MCP server must send a reply');
    const message = JSON.parse(reply.value);
    assert.equal(message.jsonrpc, '2.0');
    assert.equal(message.id, id);
    assert.equal(message.error, undefined, JSON.stringify(message.error));
    return message.result;
  }
  const initialized = await request('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test', version: '1' }, capabilities: {} });
  assert.equal(initialized.protocolVersion, '2025-06-18');
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  return {
    request,
    async call(name, args) {
      const result = await request('tools/call', { name, arguments: args });
      return JSON.parse(result.content[0].text);
    },
  };
}

test('逐轮投递宿主从技能启动，只保存宿主提交的来源问答', async (t) => {
  const { path, run } = await createProject(t);
  const start = () => run(['skill', 'start', '--harness', 'antigravity', '--session', 'agy-session']);
  const receipt = await start();
  assert.match(receipt.message, /白板已就绪，宿主提交的问答会保存/);
  assert.deepEqual(receipt.sessions, ['agy-session']);
  assert.ok(receipt.bindingId);
  assert.equal((await start()).bindingId, receipt.bindingId);
  assert.deepEqual((await run(['episode', 'list'])).episodes, []);

  const host = await mcp(t, path);
  const turn = {
    harness: 'antigravity', session_id: 'agy-session', binding_id: receipt.bindingId,
    source_turn_id: 'native-turn-1', user_text: '门控如何影响更新？', assistant_text: '门控逐元素缩放写入。',
  };
  const initial = await host.call('bang_record_turn', turn);
  assert.equal(initial.status, 'recorded');
  const retry = await host.call('bang_record_turn', turn);
  assert.equal(retry.status, 'duplicate');
  assert.equal(retry.episode.id, initial.episode.id);
  const repeated = await host.call('bang_record_turn', { ...turn, source_turn_id: 'native-turn-2' });
  assert.equal(repeated.status, 'recorded');
  assert.notEqual(repeated.episode.id, initial.episode.id);

  const { episodes } = await run(['episode', 'list']);
  assert.deepEqual(episodes.map(({ sourceTool, sessionId, turnId }) => [sourceTool, sessionId, turnId]), [
    ['antigravity', 'agy-session', 'native-turn-1'], ['antigravity', 'agy-session', 'native-turn-2'],
  ]);
  const episode = await run(['episode', 'get', initial.episode.id]);
  assert.deepEqual(episode.messages.map(({ content }) => content), [turn.user_text, turn.assistant_text]);
});

test('MCP exposes all five tools and asks for a topic before delivering into an ambiguous project', async (t) => {
  const { path, run } = await createProject(t);
  const host = await mcp(t, path);
  const available = await host.request('tools/list');
  assert.deepEqual(available.tools.map(({ name }) => name).sort(), [
    'bang_query_board', 'bang_record_turn', 'bang_sync', 'bang_topics', 'bang_update_epistemic',
  ]);
  for (const slug of ['first', 'second']) {
    assert.equal((await host.call('bang_topics', { action: 'create', slug, title: slug })).slug, slug);
  }
  const turn = {
    harness: 'antigravity', session_id: 'unrouted', source_turn_id: 'native-1',
    user_text: 'Which board?', assistant_text: 'Choose one.',
  };
  const selection = await host.call('bang_record_turn', turn);
  assert.equal(selection.status, 'topic_selection_required');
  assert.deepEqual(selection.topics.map(({ slug }) => slug), ['first', 'second']);
  assert.deepEqual((await run(['episode', 'list', '--topic', 'first'])).episodes, []);
  assert.deepEqual((await run(['episode', 'list', '--topic', 'second'])).episodes, []);

  const bound = await host.call('bang_topics', { action: 'bind', slug: 'first', harness: turn.harness, session_id: turn.session_id });
  assert.equal(bound.status, 'bound');
  const recorded = await host.call('bang_record_turn', { ...turn, binding_id: bound.bindingId });
  assert.equal(recorded.status, 'recorded');
  assert.equal((await host.call('bang_query_board', { topic_id: 'first' })).topic.slug, 'first');
  const queued = await host.call('bang_sync', { topic_id: 'first', session_id: turn.session_id });
  assert.ok(queued.job_id);
  assert.equal(queued.jobs[0].id, queued.job_id);
  assert.equal((await host.call('bang_update_epistemic', { topic_id: 'first', node_id: 'unknown', mastery: 'exploring' })).code,
    'node_not_found');
});

test('停止结束逐轮投递的采集区间，重绑只恢复指定会话，迟到的旧投递仍跳过', async (t) => {
  const { path, run } = await createProject(t);
  const first = await run(['topic', 'create', 'first']);
  await run(['topic', 'create', 'second']);
  const host = await mcp(t, path);
  const bind = (harness, slug) => host.call('bang_topics', { action: 'bind', slug, harness, session_id: 'same-id' });
  const agy = await bind('antigravity', 'first');
  const cursor = await bind('cursor', 'first');
  const turn = {
    harness: 'antigravity', session_id: 'same-id', binding_id: agy.bindingId, source_turn_id: 'native-1',
    user_text: 'What is gated?', assistant_text: 'The update.',
  };
  assert.equal((await host.call('bang_record_turn', turn)).status, 'recorded');
  await run(['stop']);
  assert.equal((await host.call('bang_record_turn', { ...turn, source_turn_id: 'stopped' })).status, 'capture_inactive');
  assert.deepEqual((await host.call('bang_query_board', { topic_id: first.id })).topic.slug, 'first');

  const newer = await bind('antigravity', 'second');
  assert.notEqual(newer.bindingId, agy.bindingId);
  assert.equal((await host.call('bang_record_turn', { ...turn, source_turn_id: 'delayed' })).status, 'capture_inactive');
  assert.equal((await host.call('bang_record_turn', {
    ...turn, binding_id: undefined, source_turn_id: 'gap', occurred_at: '2020-01-01T00:00:00.000Z',
  })).status, 'capture_inactive');
  assert.equal((await host.call('bang_record_turn', {
    ...turn, harness: 'cursor', binding_id: cursor.bindingId,
  })).status, 'capture_inactive');

  assert.equal((await host.call('bang_record_turn', {
    ...turn, binding_id: newer.bindingId, topic_id: 'first',
  })).code, 'binding_topic_mismatch');
  assert.equal((await host.call('bang_record_turn', {
    ...turn, binding_id: newer.bindingId, source_turn_id: 'new',
  })).status, 'recorded');
  assert.deepEqual((await run(['episode', 'list', '--topic', 'first'])).episodes.map(({ turnId }) => turnId), ['native-1']);
  assert.deepEqual((await run(['episode', 'list', '--topic', 'second'])).episodes.map(({ turnId }) => turnId), ['new']);

  await run(['unbind', '--harness', 'antigravity', '--session', 'same-id']);
  assert.equal((await host.call('bang_record_turn', {
    ...turn, binding_id: newer.bindingId, source_turn_id: 'unbound',
  })).status, 'capture_inactive');
});
