import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from './cli.mjs';

test('专题可以创建、切换和归档，新的 CLI 进程可查回状态', async (t) => {
  const { run } = await createProject(t);
  await run(['init']);
  const first = await run(['topic', 'create', 'GDN']);
  const second = await run(['topic', 'create', 'NPU architecture']);
  await run(['topic', 'switch', first.id]);
  await run(['topic', 'archive', second.id]);
  await run(['stop']);

  const { activeTopicId, topics } = await run(['topic', 'list']);
  assert.equal(activeTopicId, first.id);
  assert.deepEqual(topics.map(({ name, archivedAt }) => [name, Boolean(archivedAt)]), [
    ['GDN', false],
    ['NPU architecture', true],
  ]);
});
