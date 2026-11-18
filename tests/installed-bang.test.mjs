import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../release/bang.mjs', import.meta.url));

test('installation plan is read-only and preserves an existing project hook file', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'Bang 计划 '));
  const hostDirectory = path.join(project, '.codex');
  const existing = path.join(hostDirectory, 'hooks.json');
  try {
    fs.mkdirSync(hostDirectory);
    fs.writeFileSync(existing, '{"hooks":{"Stop":[]}}');
    const result = spawnSync(process.execPath, [launcher, 'plan', '--project', project], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.host, 'codex');
    assert.equal(plan.hooks, 'existing');
    assert.equal(plan.trust, 'review-in-codex');
    assert.equal(fs.readFileSync(existing, 'utf8'), '{"hooks":{"Stop":[]}}');
    assert.deepEqual(fs.readdirSync(project), ['.codex']);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
