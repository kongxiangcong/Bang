import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexHookFiles } from '../runtime/codex/hook-config.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const optionalStat = file => fs.lstatSync(file, { throwIfNoEntry: false });
const format = 1;
const empty = { format, current: null, previousRelease: null, pending: null };

function paths(project) {
  const codex = path.join(project, '.codex');
  const bang = path.join(project, '.bang');
  const runtime = path.join(bang, 'runtime');
  return {
    codex, bang, runtime,
    hook: path.join(codex, 'hooks.json'),
    receipt: path.join(runtime, 'codex-install-state.json'),
    lock: path.join(runtime, 'codex-install.lock'),
    writerLock: path.join(runtime, 'writer.lock'),
  };
}

function safeDirectory(dir) {
  const stat = optionalStat(dir);
  return !stat || stat.isDirectory();
}

function readHook(files) {
  if (!safeDirectory(files.codex)) return { state: 'unsafe', sha256: null };
  const stat = optionalStat(files.hook);
  if (!stat) return { state: 'absent', sha256: null };
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) {
    return { state: 'unsafe', sha256: null };
  }
  return { state: 'existing', sha256: digest(fs.readFileSync(files.hook)) };
}

function releaseValid(release) {
  return release && typeof release.directory === 'string' && path.isAbsolute(release.directory) &&
    hashPattern.test(release.manifestSha256) && /^[a-f0-9]{40,64}$/.test(release.sourceCommit);
}

function snapshotValid(snapshot) {
  return snapshot === null || (snapshot && typeof snapshot.text === 'string' &&
    digest(snapshot.text) === snapshot.sha256);
}

function readReceipt(files) {
  if (!safeDirectory(files.bang) || !safeDirectory(files.runtime)) {
    throw Error('Bang maintenance state path must be a real directory');
  }
  const stat = optionalStat(files.receipt);
  if (!stat) return empty;
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) {
    throw Error('Unsafe Bang maintenance receipt');
  }
  const value = JSON.parse(fs.readFileSync(files.receipt, 'utf8'));
  if (value?.format !== format ||
      (value.current !== null && (!releaseValid(value.current?.release) ||
        !value.current?.hook || !snapshotValid(value.current.hook))) ||
      (value.previousRelease !== null && !releaseValid(value.previousRelease)) ||
      (value.pending !== null && (!value.pending || !snapshotValid(value.pending.before) ||
        !snapshotValid(value.pending.after)))) {
    throw Error('Invalid Bang maintenance receipt');
  }
  return value;
}

function sameRelease(left, right) {
  return left?.directory === right?.directory && left?.manifestSha256 === right?.manifestSha256;
}

export function maintenancePlan(project, targetRelease = null) {
  const files = paths(project);
  const { current, previousRelease, pending } = readReceipt(files);
  const hook = readHook(files);
  const state = hook.state === 'existing'
    ? current ? (hook.sha256 === current.hook.sha256 ? 'owned' : 'modified') : 'untracked'
    : hook.state;
  const protectedEntry = ['modified', 'untracked', 'unsafe'].includes(state);
  const ownsEntry = current !== null;
  const same = sameRelease(current?.release, targetRelease);
  const repair = ownsEntry && (targetRelease === null || same)
    ? state === 'absent' ? 'restore' : 'unchanged' : 'use-current-package';
  const upgrade = ownsEntry ? same && state === 'owned' ? 'unchanged' : 'switch-package' : 'install-first';
  const actions = pending
    ? { install: 'recover-first', repair: 'recover-first', upgrade: 'recover-first', uninstall: 'recover-first' }
    : protectedEntry
      ? { install: 'preserve', repair: 'preserve', upgrade: 'preserve', uninstall: 'preserve' }
      : {
        install: ownsEntry ? 'use-repair-or-upgrade' : 'create',
        repair: ownsEntry ? repair : 'install-first',
        upgrade,
        uninstall: ownsEntry ? state === 'owned' ? 'remove' : 'clear-receipt' : 'unchanged',
      };
  return {
    entry: { path: files.hook, state, sha256: hook.sha256, expectedSha256: current?.hook.sha256 ?? null },
    activeRelease: current?.release ?? null,
    previousRelease,
    targetRelease,
    interrupted: pending !== null,
    actions,
  };
}

function publish(file, text, create = false) {
  const temporary = path.join(path.dirname(file), '.bang-pending-' + randomUUID());
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (create) fs.linkSync(temporary, file);
    else fs.renameSync(temporary, file);
  } finally {
    if (optionalStat(temporary)) fs.unlinkSync(temporary);
  }
}

function saveReceipt(files, receipt) {
  publish(files.receipt, JSON.stringify(receipt, null, 2) + '\n', !optionalStat(files.receipt));
}

function hookMatches(files, snapshot) {
  const actual = readHook(files);
  return snapshot === null
    ? actual.state === 'absent'
    : actual.state === 'existing' && actual.sha256 === snapshot.sha256;
}

function writeHook(files, before, after) {
  if (after !== null && before === null) fs.mkdirSync(files.codex, { recursive: true });
  if (!hookMatches(files, before)) throw Error('Codex hook changed during maintenance; preserved');
  if (after === null) {
    if (before !== null) fs.unlinkSync(files.hook);
  } else {
    publish(files.hook, after.text, before === null);
  }
}

function rollback(files, receipt) {
  const { before, after } = receipt.pending;
  if (!hookMatches(files, before)) {
    if (!hookMatches(files, after)) throw Error('Codex hook no longer matches the interrupted transaction; preserved');
    writeHook(files, after, before);
  }
  saveReceipt(files, { ...receipt, pending: null });
}

function transact(files, receipt, before, after, next) {
  const pending = { ...receipt, pending: { before, after } };
  saveReceipt(files, pending);
  try {
    writeHook(files, before, after);
    saveReceipt(files, next);
  } catch (error) {
    try {
      rollback(files, pending);
    } catch {
      throw Error('Maintenance interrupted; review Bang plan and run rollback-codex after clearing the conflict');
    }
    throw Error('Maintenance failed; previous Codex entry retained (' + (error.code ?? error.message) + ')');
  }
}

function apply(project, command, release) {
  const files = paths(project);
  const receipt = readReceipt(files);
  const plan = maintenancePlan(project, release);
  if (command === 'rollback') {
    if (!receipt.pending) return { status: 'unchanged', ...plan };
    rollback(files, receipt);
    return { status: 'rolled-back', ...maintenancePlan(project, release) };
  }
  const action = plan.actions[command];
  if (action === 'recover-first') throw Error('Interrupted Codex maintenance; run rollback-codex first');
  if (action === 'preserve') {
    if (command === 'uninstall') return { status: 'preserved', ...plan };
    throw Error('Existing or modified Codex entry preserved; review Bang plan');
  }
  if (action === 'unchanged') return { status: 'unchanged', ...plan };
  if (action === 'use-repair-or-upgrade') throw Error('Codex entry already registered; run repair-codex or upgrade-codex');
  if (action === 'use-current-package') throw Error('Use the active package to repair; use upgrade-codex to switch packages');
  if (action === 'install-first') throw Error('No Bang-owned Codex entry; run install-codex first');

  const before = plan.entry.state === 'owned' ? receipt.current.hook : null;
  let current = null;
  let previousRelease = receipt.previousRelease;
  if (command === 'install' || command === 'upgrade') {
    const text = codexHookFiles(project).hooks;
    current = { release, hook: { text, sha256: digest(text) } };
    if (command === 'upgrade' && !sameRelease(receipt.current.release, release)) {
      previousRelease = receipt.current.release;
    }
  } else if (command === 'repair') {
    current = receipt.current;
  } else {
    previousRelease = null;
  }
  const after = current?.hook ?? null;
  transact(files, receipt, before, after, { format, current, previousRelease, pending: null });
  return {
    status: command === 'uninstall' ? 'uninstalled' : 'installed-needs-trust',
    ...maintenancePlan(project, release),
    ...(current ? { hostTrust: 'required' } : {}),
  };
}

const here = fileURLToPath(import.meta.url);
const helper = fileURLToPath(new URL(
  process.platform === 'win32' ? '../runtime/native/lock-host.exe' : '../runtime/native/lock-host',
  import.meta.url,
));

function underLock(file, stage, project, command, release) {
  const stat = optionalStat(file);
  if (stat && (!stat.isFile() || stat.nlink !== 1)) throw Error('Unsafe Bang maintenance lock path');
  const result = spawnSync(helper, [file, process.execPath, here, stage, project, command, JSON.stringify(release)], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (result.status === 73) {
    throw Error(stage === 'offline'
      ? 'Project Runtime still owns the writer lock; stop the project before maintenance'
      : 'Another Codex maintenance operation is in progress');
  }
  if (result.status !== 0) throw Error(result.stderr?.trim() || result.error?.code || 'Codex maintenance helper failed');
  return JSON.parse(result.stdout);
}

export function maintain(project, command, release) {
  const files = paths(project);
  readReceipt(files);
  if (!optionalStat(files.runtime)) {
    if (command === 'uninstall') return { status: 'unchanged', ...maintenancePlan(project, release) };
    throw Error('No Bang-owned Codex entry; run install-codex first');
  }
  return underLock(files.lock, 'locked', project, command, release);
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  try {
    const [stage, project, command, descriptor] = process.argv.slice(2);
    const lockOwner = String(process.platform === 'win32' ? process.ppid : process.pid);
    if (process.env.BANG_NATIVE_LOCK_OWNER !== lockOwner || !['locked', 'offline'].includes(stage) ||
        !['install', 'repair', 'upgrade', 'uninstall', 'rollback'].includes(command)) {
      throw Error('Codex maintenance requires the native lock');
    }
    const release = JSON.parse(descriptor);
    if (!releaseValid(release)) throw Error('Invalid Bang package identity');
    const result = stage === 'locked' && command !== 'install'
      ? underLock(paths(project).writerLock, 'offline', project, command, release)
      : apply(project, command, release);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
