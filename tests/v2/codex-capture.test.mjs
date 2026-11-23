import assert from 'node:assert/strict';
import { appendFile, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createProject } from './cli.mjs';

const timestamp = '2026-11-21T12:00:00.000Z';
const row = (type, payload, at = timestamp) => JSON.stringify({ timestamp: at, type, payload }) + '\n';
const event = (type, turn_id, at) => row('event_msg', { type, turn_id }, at);
function prompt(id, text) {
  return row('response_item', {
    type: 'message', role: 'user', content: [{ type: 'input_text', text }],
    internal_chat_message_metadata_passthrough: {
      turn_id: id, content_item_metadata: [{ provenance: { type: 'user' } }],
    },
  });
}
const start = (id, question, at) => event('task_started', id, at) + prompt(id, question);
const finalAnswer = (answer) => row('response_item', {
  type: 'message', role: 'assistant', phase: 'final_answer',
  content: [{ type: 'output_text', text: answer }],
});
const finish = (id, answer, at) => finalAnswer(answer) +
  row('event_msg', { type: 'task_complete', turn_id: id, last_agent_message: answer }, at);
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

async function episodes(run, ids, topic = 'gdn') {
  let found;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { episodes } = await run(['episode', 'list', '--topic', topic]);
    found = episodes;
    if (found.length >= ids.length) break;
    await delay(80);
  }
  assert.deepEqual(found.map((episode) => episode.turnId), ids);
  return found;
}

test('Bang 有多个活跃专题时先请用户选择，选定后从新绑定起点采集', async (t) => {
  const { run, session } = await project(t);
  const other = await run(['topic', 'create', 'state', '--title', '循环状态']);
  await run(['topic', 'create', 'retired']);
  await run(['topic', 'archive', 'retired']);
  const file = await session('choosing');
  const startSkill = (...args) => run(['skill', 'start', '--session', 'choosing', ...args]);

  const choice = await startSkill();
  assert.equal(choice.status, 'choose_topic');
  assert.deepEqual(choice.candidates.map(({ slug, title }) => [slug, title]), [['gdn', 'GDN'], ['state', '循环状态']]);
  assert.equal(choice.url, undefined);
  await appendFile(file, turn('while-choosing', '选择前的问题', '选择前的答案'));

  const selected = await startSkill('--topic', '循环状态');
  assert.equal(selected.topic.id, other.id);
  const exchange = await fetch(selected.url, { redirect: 'manual' });
  assert.equal(exchange.headers.get('location'), '/?topic=state');
  await appendFile(file, turn('after-selection', '选择后的问题', '选择后的答案'));
  const [saved] = await episodes(run, ['after-selection'], 'state');
  const source = await run(['episode', 'get', saved.id, '--topic', 'state']);
  assert.deepEqual(source.messages.map(({ content }) => content), ['选择后的问题', '选择后的答案']);
  await episodes(run, [], 'gdn');
});

test('Bang 遇到同名专题时列出可区分的标识，接受精确的 slug', async (t) => {
  const { run, session } = await project(t);
  await run(['topic', 'create', 'first', '--title', '循环状态']);
  const second = await run(['topic', 'create', 'second', '--title', '循环状态']);
  await session('same-title');
  const startSkill = (topic) => run(['skill', 'start', '--session', 'same-title', '--topic', topic]);

  await assert.rejects(startSkill('循环'), /topic_not_found/);
  const choice = await startSkill('循环状态');
  assert.equal(choice.status, 'choose_topic');
  assert.deepEqual(choice.candidates.map(({ slug }) => slug), ['first', 'second']);
  assert.equal((await startSkill('second')).topic.id, second.id);
});

test('Bang 重复启动沿用原采集区间，解绑只结束指定会话的采集', async (t) => {
  const { run, session } = await project(t);
  const a = await session('learning-a');
  const b = await session('learning-b');
  const startSkill = (id, ...args) => run(['skill', 'start', '--session', id, ...args]);
  const initial = await startSkill('learning-a');
  assert.equal(initial.topic.slug, 'gdn');
  await appendFile(a, start('ongoing', 'A 会话进行中的问题'));
  await run(['topic', 'create', 'different']);
  const parallel = await startSkill('learning-b', '--topic', initial.topic.id);
  assert.deepEqual(parallel.sessions, ['learning-a', 'learning-b']);

  const repeated = await startSkill('learning-a', '--topic', 'different');
  assert.equal(repeated.topic.id, initial.topic.id);
  assert.deepEqual(repeated.sessions, ['learning-a', 'learning-b']);
  await appendFile(a, finish('ongoing', 'A 会话进行中的回答'));
  await episodes(run, ['ongoing']);
  await appendFile(b, turn('parallel', 'B 会话的问题', 'B 会话的回答'));
  const originals = await episodes(run, ['ongoing', 'parallel']);
  for (const [index, contents] of [
    ['A 会话进行中的问题', 'A 会话进行中的回答'],
    ['B 会话的问题', 'B 会话的回答'],
  ].entries()) {
    const original = await run(['episode', 'get', originals[index].id, '--topic', 'gdn']);
    assert.deepEqual(original.messages.map(({ content }) => content), contents);
  }

  await run(['unbind', '--session', 'learning-a']);
  await appendFile(a, turn('unbound', 'A 会话解绑后的问题', 'A 会话解绑后的回答'));
  await appendFile(b, turn('continues', 'B 会话继续讨论', 'B 会话继续采集'));
  await episodes(run, ['ongoing', 'parallel', 'continues']);
  assert.deepEqual((await startSkill('learning-b')).sessions, ['learning-b']);
});

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
  process.kill(restarted.pid, 'SIGKILL');
  await appendFile(file, turn('while-down', '意外退出期间仍绑定', '重启后补采'));
  await run(['serve']);
  await episodes(run, [...expected, 'split', 'while-down']);
});

test('主动停止结束项目内各专题的采集，保留已完成的问答，只重新绑定一个会话', async (t) => {
  const { run, session } = await project(t);
  const other = await project(t);
  const a = await session('capture-a');
  const b = await session('capture-b');
  const independent = await other.session('independent');
  await run(['topic', 'create', 'Other']);
  await Promise.all([
    run(['bind', '--topic', 'gdn', '--session', 'capture-a']),
    run(['bind', '--topic', 'other', '--session', 'capture-b']),
    other.run(['bind', '--topic', 'gdn', '--session', 'independent']),
  ]);
  const { pid: independentPid } = await other.run(['status']);
  await appendFile(b, start('unfinished', '停止时仍在作答'));
  await appendFile(a, turn('complete', '停止前已完成的问题', '停止前已完成的回答'));
  const stopped = await run(['stop']);
  assert.equal(stopped.running, false);
  assert.deepEqual(stopped.unverifiedSessions, []);
  assert.deepEqual(await run(['status']), { running: false });

  await appendFile(a, turn('gap-a', '停采期间的问题', '停采期间的回答'));
  await appendFile(b, finish('unfinished', '停止后才答完') + turn('gap-b', '停采期间的问题', '停采期间的回答'));
  await appendFile(independent, turn('continues', '另一项目的问题', '另一项目的回答'));
  await run(['serve']);
  assert.ok((await run(['status'])).bindings.every(({ enabled }) => !enabled));
  const [saved] = await episodes(run, ['complete']);
  const source = await run(['episode', 'get', '--topic', 'gdn', saved.id]);
  assert.deepEqual(source.messages.map(({ content }) => content), ['停止前已完成的问题', '停止前已完成的回答']);
  await episodes(run, [], 'other');
  await episodes(other.run, ['continues']);
  assert.equal((await other.run(['status'])).pid, independentPid);

  await run(['bind', '--topic', 'other', '--session', 'capture-b']);
  await appendFile(a, turn('still-disabled', '只重绑了 B', 'A 继续停采'));
  await appendFile(b, turn('after-rebind', '重绑后的问题', '重绑后的回答'));
  await episodes(run, ['after-rebind'], 'other');
  await episodes(run, ['complete']);
});

test('停止时点名不可读的来源，恢复后只补采停止前已完成的问答', async (t) => {
  const { run, session } = await project(t);
  const a = await session('missing-source');
  const b = await session('readable-source');
  await run(['bind', '--topic', 'gdn', '--session', 'missing-source']);
  await run(['bind', '--topic', 'gdn', '--session', 'readable-source']);
  const unavailable = a + '.unavailable';
  await rename(a, unavailable);
  await appendFile(unavailable, turn('saved-on-recovery', '恢复后可证明的问答', '停止前完成') +
    start('unfinished-source', '已有最后一条消息但轮次仍未结束') + finalAnswer('详见后续补充'));
  await appendFile(b, turn('saved-on-stop', '可读的问答', '停止前完成'));

  const stopped = await run(['stop']);
  assert.deepEqual(stopped, { running: false, unverifiedSessions: ['missing-source'] });
  await appendFile(unavailable, event('task_complete', 'unfinished-source', new Date().toISOString()));
  await appendFile(unavailable, start('gap-a', '停止后的问题', new Date().toISOString()) +
    finish('gap-a', '停止后的回答', new Date().toISOString()));
  await appendFile(b, turn('gap-b', '另一会话也已停止采集', '停止期间完成'));

  await run(['serve']);
  await episodes(run, ['saved-on-stop']);
  assert.ok((await run(['status'])).bindings.every(({ enabled }) => !enabled));
  await rename(unavailable, a);
  await episodes(run, ['saved-on-stop', 'saved-on-recovery']);
});

test('守护进程意外退出后仍可主动停止原采集区间', async (t) => {
  const { run, session } = await project(t);
  const file = await session('offline-stop');
  await run(['bind', '--topic', 'gdn', '--session', 'offline-stop']);
  process.kill((await run(['status'])).pid, 'SIGKILL');
  await appendFile(file, turn('before-stop', '意外退出后仍在绑定', '主动停止前的答案'));

  assert.deepEqual(await run(['stop']), { running: false, unverifiedSessions: [] });
  await appendFile(file, turn('after-stop', '主动停止后的问题', '主动停止后的答案'));
  await run(['serve']);
  await episodes(run, ['before-stop']);
  assert.equal((await run(['status'])).bindings[0].enabled, false);
});

test('重新绑定移动过的来源时保留已结束轮次，跳过停止前就已开始的进行中轮次', async (t) => {
  const { run, session } = await project(t);
  const file = await session('relocated-source');
  await run(['bind', '--topic', 'gdn', '--session', 'relocated-source']);
  const moved = file + '.relocated';
  await rename(file, moved);
  await appendFile(moved, turn('complete-before-stop', '停止请求前的问题', '停止请求前的答案') +
    start('unfinished-at-stop', '停止请求时仍在作答'));
  assert.deepEqual((await run(['stop'])).unverifiedSessions, ['relocated-source']);

  await run(['bind', '--topic', 'gdn', '--transcript', moved], undefined, {
    CODEX_THREAD_ID: 'relocated-source', CODEX_TURN_ID: 'unfinished-at-stop',
  });
  await appendFile(moved, finish('unfinished-at-stop', '现在才作答完毕', new Date().toISOString()) +
    turn('new-interval', '重新绑定后的问题', '重新绑定后的答案'));
  await episodes(run, ['complete-before-stop', 'new-interval']);
});
