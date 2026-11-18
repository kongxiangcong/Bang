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
  const cliArgs = [command, '--project', project, ...args];
  const options = { cwd: project, encoding: 'utf8', windowsHide: true, timeout: 55000 };
  if (process.platform !== 'win32') {
    return spawnSync(path.join(directory, 'bang'), cliArgs, options);
  }
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const invocation = '[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); & ' +
    [path.join(directory, 'Bang.cmd'), ...cliArgs].map(quote).join(' ') + '; exit $LASTEXITCODE';
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return spawnSync(powershell, [
    '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(invocation, 'utf16le').toString('base64'),
  ], options);
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

test('legacy installation plan presents the checked source fingerprint without switching projects', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'Bang 迁移预检 '));
  try {
    const sessions = path.join(project, '.bang', 'sessions');
    fs.mkdirSync(sessions, { recursive: true });
    const session = path.join(sessions, 'pim.json');
    const original = JSON.stringify({ events: [], messages: [], scene: { elements: [], appliedEventIds: [] } });
    fs.writeFileSync(session, original);
    const report = json(bang(process.execPath, sourceLauncher, project, 'plan', '--legacy', 'session')).legacyMigration;
    assert.equal(report.status, 'preflight-only');
    assert.equal(report.next, 'migrate-explicitly-and-install-on-returned-project');
    assert.match(report.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(report.requiresOfflineConfirmation, true);
    assert.deepEqual(fs.readdirSync(path.join(project, '.bang')), ['sessions']);
    assert.equal(fs.existsSync(path.join(project, '.codex')), false);
    assert.equal(fs.readFileSync(session, 'utf8'), original);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

const packageB = process.env.BANG_LIFECYCLE_B;

function packagedRuntime(directory, project, command, input) {
  return spawnSync(
    path.join(directory, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'),
    [path.join(directory, 'runtime', 'canvas', 'bang.mjs'), command, '--project', project, '--topic', 'demo'],
    { encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input), timeout: 20000 },
  );
}

function denyHookWrites(directory) {
  if (process.platform === 'win32') {
    const who = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    const sid = '*' + who.stdout.match(/S-1-5-[0-9-]+/)[0];
    const acl = (...args) => {
      const result = spawnSync('icacls.exe', [directory, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    acl('/deny', sid + ':(WD,AD,WEA,WA)');
    return () => acl('/remove:d', sid);
  }
  const mode = fs.statSync(directory).mode & 0o777;
  fs.chmodSync(directory, 0o500);
  return () => fs.chmodSync(directory, mode);
}

test('switching packages, retrying blocked maintenance and reinstalling preserves the original project', {
  skip: !packageA || !packageB || !codex,
}, () => {
  assert.notEqual(packageA, packageB);
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'Bang 独立维护 '));
  const project = path.join(area, '原项目');
  const global = path.join(area, '隔离 Codex HOME');
  fs.mkdirSync(project);
  fs.mkdirSync(global);
  const fakeAuth = path.join(global, 'auth.json');
  const globalContents = '{"fixture":"not-a-credential"}\n';
  fs.writeFileSync(fakeAuth, globalContents);
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = global;
  const codexDir = path.join(project, '.codex');
  const hooks = path.join(codexDir, 'hooks.json');
  const localConfig = path.join(codexDir, 'config.toml');
  const configContents = '# user comment\r\nmodel = "reviewed-fixture"\r\n';
  const run = (dir, command, ...args) => installed(dir, project, command, ...args);
  const install = dir => json(run(dir, 'install-codex', '--codex', codex));
  const plan = dir => json(run(dir, 'status')).maintenance;
  const runtime = (dir, command, input) => json(packagedRuntime(dir, project, command, input));
  try {
    install(packageA);
    const original = fs.readFileSync(hooks);
    fs.writeFileSync(localConfig, configContents);
    runtime(packageA, 'generate', { cards: [{ id: 'card', text: '保留旧稿', x: 20, y: 20, width: 120, height: 90 }] });
    runtime(packageA, 'commit', {
      operationId: 'save', topic: 'demo', baseRevision: 0, author: { kind: 'manual', id: 'tester' },
      readDependencies: [], intent: 'explicit-save',
      operations: [{ type: 'edit-card', id: 'card', text: '保留已保存正文' }],
    });

    const busy = run(packageB, 'upgrade-codex');
    assert.notEqual(busy.status, 0);
    assert.match(busy.stderr, /Runtime still owns the writer lock/);
    assert.deepEqual(fs.readFileSync(hooks), original);
    json(run(packageA, 'stop'));

    fs.unlinkSync(hooks);
    assert.equal(plan(packageA).actions.repair, 'restore');
    assert.equal(json(run(packageA, 'repair-codex')).hostTrust, 'required');
    assert.deepEqual(fs.readFileSync(hooks), original);

    const modified = Buffer.concat([original, Buffer.from('\r\n ')]);
    fs.writeFileSync(hooks, modified);
    assert.equal(plan(packageB).entry.state, 'modified');
    assert.notEqual(run(packageA, 'repair-codex').status, 0);
    assert.notEqual(run(packageB, 'upgrade-codex').status, 0);
    assert.equal(json(run(packageB, 'uninstall-codex')).status, 'preserved');
    assert.deepEqual(fs.readFileSync(hooks), modified);
    fs.writeFileSync(hooks, original);

    const allowWrites = denyHookWrites(codexDir);
    try {
      const failure = run(packageB, 'upgrade-codex');
      assert.notEqual(failure.status, 0);
      assert.match(failure.stderr, /previous Codex entry retained/);
      assert.deepEqual(fs.readFileSync(hooks), original);
      const retained = plan(packageB);
      assert.equal(retained.interrupted, false);
      assert.equal(retained.activeRelease.directory, packageA);
      assert.equal(retained.actions.upgrade, 'switch-package');
    } finally {
      allowWrites();
    }

    const upgraded = json(run(packageB, 'upgrade-codex'));
    assert.equal(upgraded.hostTrust, 'required');
    assert.equal(upgraded.activeRelease.directory, packageB);
    assert.equal(upgraded.previousRelease.directory, packageA);
    assert.notDeepEqual(fs.readFileSync(hooks), original);
    assert.equal(json(run(packageB, 'upgrade-codex')).status, 'unchanged');
    assert.equal(runtime(packageB, 'state').canvas.nodes[0].text, '保留已保存正文');
    assert.deepEqual(runtime(packageB, 'history').map(row => row.revision), [0, 1]);
    json(run(packageB, 'stop'));

    assert.equal(json(run(packageA, 'upgrade-codex')).activeRelease.directory, packageA);
    assert.deepEqual(fs.readFileSync(hooks), original);
    assert.equal(json(run(packageA, 'uninstall-codex')).status, 'uninstalled');
    assert.equal(fs.existsSync(hooks), false);
    assert.equal(json(run(packageA, 'uninstall-codex')).status, 'unchanged');
    install(packageB);
    assert.equal(runtime(packageB, 'state').revision, 1);
    assert.equal(runtime(packageB, 'history-preview', { revision: 0 }).canvas.nodes[0].text, '保留旧稿');
    assert.equal(fs.readFileSync(localConfig, 'utf8'), configContents);
    assert.equal(fs.readFileSync(fakeAuth, 'utf8'), globalContents);
    assert.deepEqual(fs.readdirSync(global), ['auth.json']);
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    run(packageA, 'stop');
    fs.rmSync(area, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
