import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceLauncher = fileURLToPath(new URL('../release/bang.mjs', import.meta.url));

function bang(node, launcher, project, command, ...args) {
  return spawnSync(node, [launcher, command, '--project', project, ...args], {
    cwd: project, encoding: 'utf8', windowsHide: true, timeout: 55000,
  });
}

function json(result) {
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return JSON.parse(result.stdout);
}

test('plan reports existing Codex hooks as untracked and preserves their exact bytes', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'Bang 维护计划 '));
  try {
    const codexDir = path.join(project, '.codex');
    fs.mkdirSync(codexDir);
    const hooks = path.join(codexDir, 'hooks.json');
    const original = Buffer.from('{\r\n  "hooks": {"Stop": []}\r\n}\r\n');
    fs.writeFileSync(hooks, original);

    const plan = json(bang(process.execPath, sourceLauncher, project, 'plan'));
    assert.equal(plan.maintenance.entry.state, 'untracked');
    assert.equal(plan.maintenance.actions.uninstall, 'preserve');
    assert.deepEqual(fs.readFileSync(hooks), original);
    assert.deepEqual(fs.readdirSync(project), ['.codex']);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

const packageA = process.env.BANG_LIFECYCLE_A;
const codex = process.env.CODEX_APP_RUNTIME_CLI_PATH;
function installed(directory, project, command, ...args) {
  const node = path.join(directory, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
  return bang(node, path.join(directory, 'release', 'bang.mjs'), project, command, ...args);
}

test('installed CLI records ownership of the exact newly installed hook', {
  skip: !packageA || !codex,
}, () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'Bang 安装 生命周期 '));
  try {
    const applied = json(installed(packageA, project, 'install-codex', '--codex', codex));
    assert.equal(applied.status, 'installed-needs-trust');
    const plan = json(installed(packageA, project, 'plan')).maintenance;
    assert.equal(plan.entry.state, 'owned');
    assert.equal(plan.entry.sha256, plan.entry.expectedSha256);
    assert.equal(plan.activeRelease.directory, packageA);
  } finally {
    installed(packageA, project, 'stop');
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
