import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../release/resources.mjs';

const { values } = parseArgs({
  options: { zip: { type: 'string' }, codex: { type: 'string' }, screenshot: { type: 'string' } },
});
if (process.platform !== 'win32' || !values.zip || !values.codex) {
  throw Error('Usage on Windows: node tests/installed-bang-smoke.mjs --zip FILE --codex CODEX_EXE [--screenshot PNG]');
}
const zip = path.resolve(values.zip);
const codex = fs.realpathSync(values.codex);
const browserTest = fileURLToPath(new URL('./canvas-save-browser.mjs', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'Bang 安装验证 '));
const install = path.join(temp, '只读 安装');
const project = path.join(temp, '验证 项目');
const extract = path.join(temp, '解压 目录');
const system32 = path.join(process.env.SystemRoot, 'System32');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('BANG_') && key.toUpperCase() !== 'PATH' && key !== 'NODE_OPTIONS',
));
env.PATH = system32;
const execute = (file, args, extra = {}) => spawnSync(file, args, {
  env, encoding: 'utf8', timeout: 45000, windowsHide: true, ...extra,
});
function successful(result) {
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout;
}
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const launcher = path.join(install, 'Bang.cmd');
function bang(command, ...args) {
  const invocation = '[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); & ' + [launcher, command, '--project', project, ...args].map(quote).join(' ') +
    '; exit $LASTEXITCODE';
  const base64 = Buffer.from(invocation, 'utf16le').toString('base64');
  return execute(path.join(system32, 'WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', base64]);
}

let sid;
try {
  fs.mkdirSync(project);
  fs.mkdirSync(extract);
  const expectedZipDigest = fs.readFileSync(zip + '.sha256', 'utf8').split(/\s+/)[0];
  assert.equal(sha256(zip), expectedZipDigest);
  successful(execute('tar.exe', ['-xf', zip, '-C', extract]));
  fs.renameSync(path.join(extract, 'bang-codex-windows-x64'), install);
  sid = successful(execute('whoami.exe', ['/user', '/fo', 'csv', '/nh'])).match(/S-1-5-[0-9-]+/)[0];
  successful(execute('icacls.exe', [install, '/deny', '*' + sid + ':(OI)(CI)(WD,AD,WEA,WA)']));
  assert.throws(() => fs.writeFileSync(path.join(install, 'write-probe'), 'denied'), error => ['EACCES', 'EPERM'].includes(error.code));
  assert.throws(() => fs.appendFileSync(path.join(install, 'README.md'), 'denied'), error => ['EACCES', 'EPERM'].includes(error.code));

  const health = JSON.parse(successful(bang('check', '--codex', codex)));
  assert.equal(health.package, 'verified');
  assert.equal(health.node, '25.8.1');
  assert.equal(health.codex.version, '0.169.0-alpha.11.1');
  assert.equal(health.sessionAcceptance, 'unverified-by-check');
  assert.equal(JSON.parse(successful(bang('plan'))).hooks, 'absent');
  assert.deepEqual(fs.readdirSync(project), []);
  assert.equal(bang('check', '--codex', path.join(temp, 'missing.exe')).status, 1);
  assert.deepEqual(fs.readdirSync(project), []);

  const prepared = JSON.parse(successful(bang('prepare-codex', '--codex', codex)));
  assert.equal(prepared.hostTrust, 'required');
  assert.equal(fs.existsSync(path.join(project, '.codex')), false);
  const preview = fs.readFileSync(path.join(prepared.review, 'command.txt'), 'utf8');
  assert.ok(preview.includes(path.join(install, 'node', 'node.exe')));
  assert.ok(preview.includes(project));
  assert.match(preview, / --context-v1$/);
  assert.equal(prepared.activationPrompt, 'Bang: enable current session');

  const installed = JSON.parse(successful(bang('install-codex', '--codex', codex)));
  const hooksFile = path.join(project, '.codex', 'hooks.json');
  assert.equal(installed.status, 'installed-needs-trust');
  assert.equal(installed.hookFile, hooksFile);
  const hooks = fs.readFileSync(hooksFile, 'utf8');
  assert.deepEqual(JSON.parse(hooks), JSON.parse(fs.readFileSync(path.join(installed.review, 'hooks.json'), 'utf8')));
  const promptHook = JSON.parse(hooks).hooks.UserPromptSubmit[0].hooks[0];
  assert.ok(promptHook.command.includes('-EncodedCommand'));
  assert.equal(promptHook.additionalContextLimit, 0);
  assert.equal(bang('install-codex', '--codex', codex).status, 1);
  assert.equal(fs.readFileSync(hooksFile, 'utf8'), hooks);
  assert.equal(JSON.parse(successful(bang('plan'))).hooks, 'existing');

  const browser = execute(process.execPath, [browserTest], {
    env: {
      ...env,
      BANG_BROWSER_PACKAGED_ROOT: install,
      BANG_BROWSER_WORKSPACE: temp,
      BANG_BROWSER_SCREENSHOT: values.screenshot ? path.resolve(values.screenshot) : path.join(temp, 'browser.png'),
    },
    timeout: 60000,
  });
  assert.equal(JSON.parse(successful(browser)).packaged, true);
  assert.equal(JSON.parse(successful(bang('check', '--codex', codex))).package, 'verified');
  console.log(JSON.stringify({
    pass: true, osBuild: os.release(), platform: health.platform, node: health.node,
    codex: health.codex.version, sourceCommit: health.sourceCommit, zipSha256: expectedZipDigest,
    frontend: JSON.parse(browser.stdout).evidence, hookStatus: installed.status,
  }));
} finally {
  if (fs.existsSync(launcher)) bang('stop');
  if (sid) execute('icacls.exe', [install, '/remove:d', '*' + sid]);
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
