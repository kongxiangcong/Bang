import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { text } from 'node:stream/consumers';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createProject } from './cli.mjs';

const cli = fileURLToPath(new URL('../../packages/adapters/src/cli.ts', import.meta.url));

async function mcp(t, project, entry = cli) {
  const child = spawn(process.execPath, ['--experimental-strip-types', entry, '--project', project, 'mcp'], {
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
  const home = join(path, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const installer = fileURLToPath(new URL('../../install.mjs', import.meta.url));
  execFileSync(process.execPath, [installer], { cwd: path, env, stdio: 'ignore' });
  const entry = join(home, '.agents', 'skills', 'bang', 'launch.mjs');
  const start = () => JSON.parse(execFileSync(process.execPath, [
    '--experimental-strip-types', entry, 'skill', 'start', '--harness', 'antigravity', '--session', 'agy-session',
  ], { cwd: path, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const receipt = start();
  assert.match(receipt.message, /白板已就绪，宿主提交的问答会保存/);
  assert.deepEqual(receipt.sessions, ['agy-session']);
  assert.ok(receipt.bindingId);
  assert.equal(start().bindingId, receipt.bindingId);
  assert.deepEqual((await run(['skill', 'status'])).topics[0].sessions, ['agy-session']);
  assert.deepEqual((await run(['episode', 'list'])).episodes, []);

  const host = await mcp(t, path, entry);
  const turn = {
    harness: 'antigravity', session_id: 'agy-session', binding_id: receipt.bindingId,
    source_turn_id: 'native-turn-1', user_text: '门控如何影响更新？', assistant_text: '门控逐元素缩放写入。',
  };
  assert.equal((await host.call('bang_record_turn', {
    ...turn, source_turn_id: 'bang-status', user_text: '$bang status', assistant_text: '白板服务已启动。',
  })).status, 'skipped_operation');
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
  assert.equal((await run(['skill', 'status'])).topics[0].turnCount, 2);
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
  const provider = createServer(async (request, response) => {
    const modelCall = JSON.parse(await text(request));
    const input = JSON.parse(modelCall.messages[1].content);
    const result = modelCall.response_format.json_schema.name === 'bang_pass1' ? {
      landmarks: [{
        id: 'gating', kind: 'concept', tag: 'concept', title: 'Gating', detail: 'The gate scales the update.',
        conditions: [], event_time: null, source_episodes: [input.episodes[0].id],
      }],
      remove_landmarks: [], relationships: [], remove_relationships: [], epistemic_hints: [],
    } : {
      summary: 'Add gating', operations: [{ op: 'ADD_NODE', node: input.session.landmarks[0] }],
    };
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => { provider.closeAllConnections(); provider.close(); });
  await writeFile(join(path, '.bang', 'config.json'), JSON.stringify({
    llm: { base_url: `http://127.0.0.1:${provider.address().port}/v1`, model: 'host-delivery-test' },
  }));
  const queued = await host.call('bang_sync', { topic_id: 'first', session_id: turn.session_id });
  assert.ok(queued.job_id);
  assert.equal(queued.jobs[0].id, queued.job_id);
  assert.equal(queued.status, 'running');

  await run(['sync', '--topic', 'first', '--session', turn.session_id]);
  const board = await host.call('bang_query_board', { topic_id: 'first', query: 'Gating' });
  assert.equal(board.knowledge.nodes[0].id, 'gating');
  const update = {
    topic_id: 'first', node_id: 'gating', mastery: 'exploring', stance: 'endorsed',
    belief_shift: {
      previous_belief: 'I thought the gate chose the source.',
      correction: 'The gate scales the update.',
      trigger_episode_id: recorded.episode.id,
    },
  };
  assert.equal((await host.call('bang_update_epistemic', { ...update, node_id: 'unknown' })).code, 'node_not_found');
  const updated = await host.call('bang_update_epistemic', update);
  assert.equal(updated.status, 'updated');
  assert.equal(updated.revision, board.revision + 1);
  assert.equal((await host.call('bang_update_epistemic', update)).status, 'unchanged');
  const edited = await host.call('bang_query_board', { topic_id: 'first', query: 'Gating' });
  assert.deepEqual(edited.knowledge, board.knowledge);
  assert.equal(edited.epistemic.nodes[0].mastery, 'exploring');
  assert.equal(edited.epistemic.nodes[0].stance, 'endorsed');
  assert.deepEqual(edited.epistemic.nodes[0].belief_history.map((entry) => entry.trigger_episode_id), [recorded.episode.id]);
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

test('已启用的 Codex watcher 在采集前后接管缺少原生标识的投递', async (t) => {
  const { path, run } = await createProject(t);
  const transcript = join(path, 'codex.jsonl');
  const row = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
  await writeFile(transcript, row('session_meta', { id: 'codex-session', source: 'cli', cwd: path }));
  const receipt = await run(['skill', 'start', '--session', 'codex-session', '--transcript', transcript]);
  assert.match(receipt.message, /正在自动记录/);
  const host = await mcp(t, path);
  const turn = {
    harness: 'codex', session_id: 'codex-session', user_text: 'What does gating do?',
    assistant_text: 'It scales the update.',
  };
  const submit = (more) => host.call('bang_record_turn', { ...turn, ...more });
  assert.equal((await submit()).status, 'watcher_managed');
  assert.equal((await host.call('bang_query_board', { topic_id: receipt.topic.id })).topic.id, receipt.topic.id);
  assert.equal((await host.call('bang_sync', { topic_id: receipt.topic.id })).status, 'idle');
  await appendFile(transcript,
    row('event_msg', { type: 'task_started', turn_id: 'codex-native' }) +
    row('response_item', {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.user_text }],
      internal_chat_message_metadata_passthrough: {
        turn_id: 'codex-native', content_item_metadata: [{ provenance: { type: 'user' } }],
      },
    }) +
    row('response_item', {
      type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: turn.assistant_text }],
    }) +
    row('event_msg', { type: 'task_complete', turn_id: 'codex-native', last_agent_message: turn.assistant_text }));
  let episodes = [];
  for (let attempt = 0; attempt < 20 && episodes.length === 0; attempt += 1) {
    ({ episodes } = await run(['episode', 'list']));
    if (!episodes.length) await delay(50);
  }
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].sourceTool, 'codex');
  assert.equal(episodes[0].turnId, 'codex-native');
  assert.deepEqual(episodes[0].messages.map(({ content }) => content), [turn.user_text, turn.assistant_text]);
  assert.equal((await submit()).status, 'watcher_managed');
  const duplicate = await submit({ source_turn_id: 'codex-native' });
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.episode.id, episodes[0].id);
  assert.equal((await run(['skill', 'status'])).topics[0].turnCount, 1);
  await run(['unbind', '--session', 'codex-session']);
  assert.equal((await submit({ source_turn_id: 'codex-unbound' })).status, 'capture_inactive');
});
