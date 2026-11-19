import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../release/bang.mjs', import.meta.url));

test('Linux launcher uses bundled Node and preserves project paths from another directory', {
  skip: process.platform !== 'linux',
}, () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'Bang 中文 '));
  const install = path.join(workspace, '安装 位置');
  const project = path.join(workspace, "用户's 项目");
  const shellLauncher = path.join(install, 'bang');
  try {
    for (const directory of [project, path.join(install, 'node', 'bin')]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.cpSync(path.dirname(launcher), path.join(install, 'release'), { recursive: true });
    fs.symlinkSync(fileURLToPath(new URL('../runtime', import.meta.url)), path.join(install, 'runtime'));
    fs.symlinkSync(process.execPath, path.join(install, 'node', 'bin', 'node'));
    fs.copyFileSync(fileURLToPath(new URL('../release/bang', import.meta.url)), shellLauncher);
    fs.chmodSync(shellLauncher, 0o755);

    const result = spawnSync(shellLauncher, ['plan', '--project', project], {
      cwd: workspace, env: { PATH: '', NODE_OPTIONS: '--invalid-option' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.equal(JSON.parse(result.stdout).project, fs.realpathSync(project));
    assert.deepEqual(fs.readdirSync(project), []);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

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
