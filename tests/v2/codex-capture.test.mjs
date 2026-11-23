import assert from 'node:assert/strict';
import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createProject } from './cli.mjs';

const timestamp = '2026-11-21T12:00:00.000Z';
const row = (type, payload) => JSON.stringify({ timestamp, type, payload }) + '\n';
const event = (type, turn_id) => row('event_msg', { type, turn_id });
function prompt(id, text) {
  return row('response_item', {
    type: 'message', role: 'user', content: [{ type: 'input_text', text }],
    internal_chat_message_metadata_passthrough: {
      turn_id: id, content_item_metadata: [{ provenance: { type: 'user' } }],
    },
  });
}
const start = (id, question) => event('task_started', id) + prompt(id, question);
const finish = (id, answer) => row('response_item', {
  type: 'message', role: 'assistant', phase: 'final_answer',
  content: [{ type: 'output_text', text: answer }],
}) + row('event_msg', { type: 'task_complete', turn_id: id, last_agent_message: answer });
const turn = (id, question, answer) => start(id, question) + finish(id, answer);

async function project(t) {
  const env = { CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', CODEX_TURN_ID: '', CODEX_TRANSCRIPT_PATH: '' };
  const instance = await createProject(t, env);
  env.CODEX_HOME = join(instance.path, 'codex');
  const sessions = join(env.CODEX_HOME, 'sessions', '2026', '11', '21');
  await mkdir(sessions, { recursive: true });
  await instance.run(['topic', 'create', 'GDN']);
  return {
    ...instance,
    async session(id, meta = {}) {
      const file = join(sessions, `rollout-2026-11-21T12-00-00-${id}.jsonl`);
      await writeFile(file, row('session_meta', { id, source: 'cli', cwd: instance.path, ...meta }));
      return file;
    },
  };
}

async function episodes(run, ids) {
  let found;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { episodes } = await run(['episode', 'list', '--topic', 'gdn']);
    found = episodes;
    if (found.length >= ids.length) break;
    await delay(80);
  }
  assert.deepEqual(found.map((episode) => episode.turnId), ids);
  return found;
}

test('Codex 第 12 轮绑定时从当轮采集，轮间绑定从下一轮开始', async (t) => {
  const { run, session } = await project(t);
  const file = await session('in-chat');
  await appendFile(file, Array.from({ length: 11 }, (_, index) =>
    turn(`prior-${index + 1}`, '绑定前问题', '绑定前回答')).join(''));
  await appendFile(file, start('twelfth', '为什么门控能减弱噪声？'));
  assert.equal((await run(['bind', '--topic', 'gdn'], undefined, {
    CODEX_THREAD_ID: 'in-chat', CODEX_TURN_ID: 'twelfth',
  })).status, 'bound');
  await appendFile(file, finish('twelfth', '门控逐元素调制信号。'));
  await episodes(run, ['twelfth']);

  const terminal = await session('between');
  await appendFile(terminal, turn('previous', '过去的问题', '过去的答案'));
  await run(['bind', '--topic', 'gdn', '--session', 'between']);
  await appendFile(terminal, turn('next', '新问题', '新答案'));
  const [, next] = await episodes(run, ['twelfth', 'next']);
  assert.equal(next.messages[0].content, '新问题');
});

test('纯 Bang 操作只推进游标，混合轮只保留可独立识别的专题问答', async (t) => {
  const { run, session } = await project(t);
  const file = await session('operations');
  await run(['bind', '--topic', 'gdn', '--session', 'operations']);
  const call = row('response_item', {
    type: 'function_call', name: 'mcp__bang__bang_sync', arguments: '{}',
  });
  const health = row('response_item', {
    type: 'function_call', name: 'exec_command',
    arguments: JSON.stringify({ cmd: 'bang status' }),
  });
  await appendFile(file, [
    start('pure', '请同步 Bang 白板。'), call, finish('pure', '已同步 Bang 白板。'),
    start('mixed', '$bang\n\n为什么门控能减弱噪声？'),
    call, row('response_item', {
      type: 'function_call_output', output: '无需用户授权的内部操作回执',
    }),
    finish('mixed', '已同步 Bang 白板。\n\n门控逐元素调制信号。'),
    start('named-topic', '请查看 GDN 专题。'), call, finish('named-topic', 'GDN 专题里有 3 条记录。'),
    start('named-inseparable', '请查看 GDN 专题，然后解释门控的作用。'),
    call, finish('named-inseparable', 'GDN 专题中有 3 条记录，门控逐元素调制信号。'),
    start('one-newline', 'bang sync --topic gdn\n为什么门控能减弱噪声？'),
    call, finish('one-newline', '已同步 Bang 白板。\n门控逐元素调制信号。'),
    start('inseparable', '请将白板中的成立条件改为“样本只有 8 个”，再说明这对泛化的影响。'),
    finish('inseparable', '已把条件改为“样本只有 8 个”，这限制了泛化结论。'),
    start('receipt-only', '看看状态'), health, finish('receipt-only', '当前服务正在监听本地端口。'),
    turn('bang-design', '绑定会话在 Bang 的架构里如何跨重启恢复？', '绑定状态和游标以事务保存。'),
    start('pure-last', '$bang'), call, finish('pure-last', '已同步 Bang 白板。'),
  ].join(''));
  const exchanges = await episodes(run, ['mixed', 'one-newline', 'bang-design']);
  for (const exchange of exchanges.slice(0, 2)) {
    assert.deepEqual(exchange.messages.map(({ content }) => content), ['为什么门控能减弱噪声？', '门控逐元素调制信号。']);
  }
  assert.equal((await run(['status'])).bindings[0].lastTurnId, 'pure-last');
});

test('Codex 绑定排除整理器、子代理、分支会话与其他项目', async (t) => {
  const { path, run, session } = await project(t);
  const other = join(path, 'other-project');
  await mkdir(other);
  const excluded = [
    ['organizer', { originator: 'bang-organizer' }],
    ['child', { source: { subagent: { thread_spawn: { parent_thread_id: 'main' } } } }],
    ['child-cli', { agent_nickname: 'subagent' }],
    ['fork', { forked_from_id: 'main' }],
    ['outside', { cwd: other }],
  ];
  for (const [id, meta] of excluded) {
    const file = await session(id, meta);
    await appendFile(file, turn(`${id}-turn`, '不要采集', '不要采集'));
    await assert.rejects(run(['bind', '--topic', 'gdn', '--session', id]), /codex_session_excluded/);
  }
  const neverBound = await session('never-bound');
  const main = await session('main');
  await run(['bind', '--topic', 'gdn', '--session', 'main']);
  await appendFile(neverBound, turn('unbound', '未授权', '未授权'));
  await appendFile(main, turn('allowed', '已授权', '已授权'));
  await episodes(run, ['allowed']);
});

async function waitForOffset(run, file) {
  const { size } = await stat(file);
  let state;
  for (let index = 0; index < 20; index += 1) {
    state = await run(['status']);
    if (state.bindings[0].byteOffset === size) break;
    await delay(80);
  }
  assert.equal(state.bindings[0].byteOffset, size);
  return state;
}

test('解绑跳过间隔，强杀后续采已绑定会话与按字节拆开的 UTF-8 JSONL', async (t) => {
  const { run, session } = await project(t);
  const file = await session('resumable');
  const bind = () => run(['bind', '--topic', 'gdn', '--session', 'resumable']);
  await bind();
  await appendFile(file, turn('before-unbind', '问题', '同一答案'));
  assert.equal((await run(['unbind', '--session', 'resumable'])).enabled, false);
  await appendFile(file, turn('gap', '解绑期间问题', '解绑期间答案'));
  await bind();
  await appendFile(file, turn('after-rebind', '问题', '同一答案'));
  const expected = ['before-unbind', 'after-rebind'];
  await episodes(run, expected);

  const prefix = start('split', '中文问题：如何表示门控？');
  await appendFile(file, prefix + event('turn_aborted', 'unrelated') + row('future_type', { secret: 'ignore' }));
  const suffix = Buffer.from(finish('split', '中文答案：逐元素乘法。'));
  const firstWideByte = suffix.findIndex((byte) => byte > 127);
  const split = firstWideByte + 1;
  await appendFile(file, suffix.subarray(0, split));

  const state = await waitForOffset(run, file);
  assert.equal(state.bindings[0].lastTurnId, 'after-rebind');
  process.kill(state.pid, 'SIGKILL');
  await appendFile(file, suffix.subarray(split, split + 1));
  const restarted = await run(['serve']);
  assert.notEqual(restarted.pid, state.pid);
  assert.equal((await waitForOffset(run, file)).bindings[0].lastTurnId, 'after-rebind');
  await appendFile(file, suffix.subarray(split + 1, split + 2));
  assert.equal((await waitForOffset(run, file)).bindings[0].lastTurnId, 'after-rebind');
  await appendFile(file, suffix.subarray(split + 2));

  const resumed = await episodes(run, [...expected, 'split']);
  assert.deepEqual(resumed[2].messages.map((message) => message.content), [
    '中文问题：如何表示门控？', '中文答案：逐元素乘法。',
  ]);
  assert.notEqual(resumed[0].id, resumed[1].id);
  await run(['stop']);
  await appendFile(file, turn('while-down', '停机期间仍绑定', '重启后补采'));
  await run(['serve']);
  await episodes(run, [...expected, 'split', 'while-down']);
});
