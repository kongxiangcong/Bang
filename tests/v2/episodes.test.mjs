import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createProject } from './cli.mjs';

test('GDN 会话的 17 轮原文可按录入顺序回读，保留角色、时间及来源标识', async (t) => {
  const document = await readFile(new URL('../../.scratch/bang-v2/GDN_session_examples.md', import.meta.url), 'utf8');
  const headings = [...document.matchAll(/^## (You|ChatGPT) · (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})[ \t]*$/gm)];
  assert.equal(headings.length, 34);
  const { run } = await createProject(t);
  const topic = await run(['topic', 'create', 'GDN']);
  const sessionId = document.match(/^conversation_id: ([^\r\n]+)/m)?.[1];
  assert.ok(sessionId);
  const submitted = [];
  for (let messageIndex = 0; messageIndex < headings.length; messageIndex += 2) {
    const messages = [messageIndex, messageIndex + 1].map((index) => {
      const [heading, speaker, date, time] = headings[index];
      const textStart = headings[index].index + heading.length;
      const textEnd = headings[index + 1]?.index ?? document.length;
      return {
        role: speaker === 'You' ? 'user' : 'assistant',
        timestamp: `${date}T${time}:00+08:00`,
        content: document.slice(textStart, textEnd).replace(/^\r?\n\r?\n/, '').replace(/(?:\r?\n)+$/, ''),
      };
    });
    assert.deepEqual(messages.map(({ role }) => role), ['user', 'assistant']);
    const input = {
      sourceTool: 'chatgpt', sessionId,
      turnId: `turn-${messageIndex / 2 + 1}`,
      sourceRef: `.scratch/bang-v2/GDN_session_examples.md#${messages[0].timestamp}`,
      messages,
    };
    const result = await run(['ingest', '--topic', topic.slug], input);
    assert.equal(result.status, 'recorded');
    submitted.push({ ...input, id: result.episode.id });
  }

  await run(['stop']);
  const { episodes } = await run(['episode', 'list', '--topic', topic.id]);
  assert.deepEqual(episodes.map(({ id, turnId, sourceRef, sourceTool, sessionId, messages }) =>
    ({ id, turnId, sourceRef, sourceTool, sessionId, messages })), submitted);
  const checkpoint = await run(['episode', 'get', submitted[8].id, '--topic', topic.slug]);
  assert.equal(checkpoint.messages[0].timestamp, '2026-11-20T16:55:00+08:00');
  assert.equal(checkpoint.messages[1].timestamp, '2026-11-20T16:56:00+08:00');
  assert.match(checkpoint.messages[1].content, /两列、四个元素全部更新/);
  assert.ok(episodes.some(({ messages }) => messages.some(({ content }) => content.includes('<svg'))));
  assert.equal(episodes[13].messages[0].timestamp, '2026-11-20T17:20:00+08:00');
});

test('并发重投只记录一次，独立同文轮次和修订版保留可追溯的原文', async (t) => {
  const { run } = await createProject(t);
  const topic = await run(['topic', 'create', 'Sources']);
  const input = {
    sourceTool: 'codex', sessionId: 'source-session', turnId: 'turn-1', revisionId: 'original',
    messages: [
      { role: 'user', timestamp: '2026-11-20T16:04:00Z', content: 'Question' },
      { role: 'assistant', timestamp: '2026-11-20T16:05:00Z', content: 'Answer' },
    ],
  };
  const record = (data) => run(['episode', 'record', '--topic', topic.slug], data);
  const [a, b, sameText] = await Promise.all([
    record(input), record(input), record({ ...input, turnId: 'turn-2' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), ['duplicate', 'recorded']);
  assert.equal(a.episode.id, b.episode.id);
  assert.notEqual(sameText.episode.id, a.episode.id);
  const editedInput = {
    ...input,
    revisionId: 'corrected',
    replacesEpisodeId: a.episode.id,
    messages: [input.messages[0], { ...input.messages[1], content: 'Updated answer' }],
  };
  const edited = await record(editedInput);
  assert.equal((await record(editedInput)).status, 'duplicate');
  assert.equal(edited.episode.replacesEpisodeId, a.episode.id);
  assert.equal(edited.episode.turnIndex, a.episode.turnIndex);
  await assert.rejects(record({ ...editedInput, turnId: 'unrelated-turn' }), /invalid_episode_predecessor/);
  await assert.rejects(record({ ...editedInput, replacesEpisodeId: sameText.episode.id }), /episode_conflict/);
  const before = await run(['episode', 'get', a.episode.id]);
  assert.equal(before.messages[1].content, 'Answer');

  const status = await run(['status']);
  const { url } = await run(['open', '--url']);
  const exchange = await fetch(url, { redirect: 'manual' });
  const cookie = exchange.headers.get('set-cookie').split(';')[0];
  const unique = await Promise.all(Array.from({ length: 50 }, (_, index) =>
    fetch(`http://127.0.0.1:${status.port}/api/topics/${topic.id}/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...input, turnId: `parallel-${index}` }),
    })));
  assert.ok(unique.every((response) => response.status === 201));
  const { episodes } = await run(['episode', 'list']);
  assert.equal(episodes.length, 53);
  assert.deepEqual(episodes.map((episode) => episode.ingestIndex),
    Array.from({ length: 53 }, (_, index) => index + 1));
});
