import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CODEX_VERSION } from '../runtime/codex/executor-config.mjs';
import { inventory, nodeVersion, platforms, regularFile, sha256 } from './resources.mjs';
import { maintain, maintenancePlan } from './codex-maintenance.mjs';

const root = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const projectOption = { project: { type: 'string' } };
const codexOption = { codex: { type: 'string' } };
const legacyOptions = { legacy: { type: 'string' }, 'legacy-topic': { type: 'string' } };
const operations = {
  'repair-codex': 'repair',
  'upgrade-codex': 'upgrade',
  'uninstall-codex': 'uninstall',
  'rollback-codex': 'rollback',
};
const manifestPath = path.join(root, 'package-manifest.json');

function codexCheck(candidate) {
  if (!candidate) return { status: 'not-supplied' };
  if (!path.isAbsolute(candidate) || /\.(cmd|bat|ps1)$/i.test(candidate)) {
    return { status: 'absolute-native-executable-required' };
  }
  let executable;
  try { executable = fs.realpathSync(candidate); } catch { return { status: 'unavailable' }; }
  if (!executable || !regularFile(executable)) return { status: 'unavailable' };
  const probeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bang-codex-version-'));
  let result;
  try {
    result = spawnSync(executable, ['--version'], {
      cwd: probeHome, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 65536,
      env: {
        SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        PATH: process.env.PATH, CODEX_HOME: probeHome,
        HOME: probeHome, USERPROFILE: probeHome, TMP: probeHome, TEMP: probeHome,
      },
    });
  } finally {
    fs.rmSync(probeHome, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
  if (result.status !== 0) return { status: 'unavailable' };
  const version = result.stdout.trim().match(/^codex-cli ([\w.-]+)$/)?.[1];
  return version === CODEX_VERSION
    ? { status: 'compatible', version, executable }
    : { status: 'version-mismatch', version: version ?? null };
}

function packageFiles() {
  const manifestName = 'package-manifest.json';
  if (!regularFile(manifestPath)) throw Error('Bang package manifest is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const platform = platforms[manifest.platform];
  if (manifest.format !== 1 || manifest.platform !== process.platform + '-' + process.arch ||
      !platform || manifest.nodeVersion !== nodeVersion || process.versions.node !== nodeVersion ||
      fs.realpathSync(process.execPath) !== fs.realpathSync(path.join(root, 'node', platform.node))) {
    throw Error('Start Bang with its bundled Node on the declared platform');
  }
  const actual = inventory(root).filter(file => file !== manifestName);
  if (actual.length !== Object.keys(manifest.files).length) throw Error('Bang package file list differs');
  for (const relative of actual) {
    if (sha256(path.join(root, relative)) !== manifest.files[relative]) {
      throw Error('Bang package file failed integrity check: ' + relative);
    }
  }
  return manifest;
}

function explicitPreparation(project, executable) {
  const privateRuntime = path.join(project, '.bang', 'runtime');
  for (const dir of [path.dirname(privateRuntime), privateRuntime]) {
    const type = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (type && !type.isDirectory()) throw Error('Bang runtime path must be a real directory');
  }
  const existingManifest = path.join(privateRuntime, 'codex-install.json');
  const type = fs.lstatSync(existingManifest, { throwIfNoEntry: false });
  if (type && (!type.isFile() || JSON.parse(fs.readFileSync(existingManifest, 'utf8')).executable !== executable)) {
    throw Error('Existing Codex registration needs review before changing executables');
  }
  const review = path.join(privateRuntime, 'codex-hook-review-' + randomUUID());
  const prepared = spawnSync(process.execPath, [
    path.join(root, 'runtime', 'codex', 'prepare.mjs'), project, review,
  ], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, CODEX_APP_RUNTIME_CLI_PATH: executable },
  });
  if (prepared.status !== 0) throw Error('Codex review preparation failed: ' + prepared.stderr.trim());
  return JSON.parse(prepared.stdout);
}

function releaseIdentity(manifest) {
  return { directory: root, sourceCommit: manifest.sourceCommit, manifestSha256: sha256(manifestPath) };
}

async function projectPlan(project, release, values = {}) {
  const maintenance = maintenancePlan(project, release);
  const { entry } = maintenance;
  const plan = {
    project,
    host: 'codex',
    requiredVersion: CODEX_VERSION,
    hookFile: entry.path,
    hooks: ['absent', 'unsafe'].includes(entry.state) ? entry.state : 'existing',
    trust: 'review-in-codex',
    maintenance,
  };
  if (values.legacy !== undefined || values['legacy-topic'] !== undefined) {
    const kind = values.legacy;
    const topic = values['legacy-topic'];
    if (!['session', 'companion'].includes(kind) ||
        (kind === 'companion' ? !topic : topic !== undefined)) {
      throw Error('Select --legacy session or --legacy companion --legacy-topic TOPIC');
    }
    const { preflightLegacy } = await import('../runtime/canvas/legacy-migration.mjs');
    const { replay, ...report } = preflightLegacy(project, undefined, { kind, topic });
    plan.legacyMigration = {
      ...report,
      kind,
      ...(topic ? { topic } : {}),
      status: 'preflight-only',
      next: 'migrate-explicitly-and-install-on-returned-project',
    };
  }
  return plan;
}

try {
  const [command, ...args] = process.argv.slice(2);
  const options = {
    plan: { ...projectOption, ...legacyOptions },
    status: projectOption,
    check: { ...projectOption, ...codexOption },
    'prepare-codex': { ...projectOption, ...codexOption },
    'install-codex': { ...projectOption, ...codexOption },
    'repair-codex': projectOption,
    'upgrade-codex': projectOption,
    'uninstall-codex': projectOption,
    'rollback-codex': projectOption,
    serve: { ...projectOption, port: { type: 'string', default: '0' } },
    stop: projectOption,
  };
  if (!Object.hasOwn(options, command)) {
    throw Error('Usage: Bang plan | status | check | prepare-codex | install-codex | repair-codex | upgrade-codex | rollback-codex | uninstall-codex | serve | stop --project DIR');
  }
  const { values } = parseArgs({ args, options: options[command] });
  if (!values.project) throw Error('Specify an existing project directory with --project');
  const project = fs.realpathSync(values.project);
  if (!fs.statSync(project).isDirectory()) throw Error('Project must be a directory');
  if (regularFile(manifestPath)) {
    const relative = path.relative(root, project);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw Error('Choose a project outside Bang installation resources');
    }
  }
  if (command === 'plan' || command === 'status') {
    const release = regularFile(manifestPath)
      ? releaseIdentity(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
      : null;
    console.log(JSON.stringify(await projectPlan(project, release, values)));
  } else if (command === 'stop') {
    const { runtimeOperation } = await import('../runtime/native/runtime.mjs');
    console.log(JSON.stringify(await runtimeOperation(project, 'stop')));
  } else {
    const manifest = packageFiles();
    const release = releaseIdentity(manifest);
    if (Object.hasOwn(operations, command)) {
      console.log(JSON.stringify(maintain(project, operations[command], release)));
    } else if (command === 'serve') {
      if (!/^\d{1,5}$/.test(values.port) || Number(values.port) > 65535) throw Error('Invalid loopback port');
      const { serveEditor } = await import('./editor.mjs');
      console.log(JSON.stringify(await serveEditor(root, project, Number(values.port), manifest.files)));
    } else {
      const plan = await projectPlan(project, release);
      const codex = codexCheck(values.codex ?? process.env.CODEX_APP_RUNTIME_CLI_PATH);
      if (command === 'check') {
        await import('node:sqlite');
        console.log(JSON.stringify({
          ...plan, package: 'verified', platform: manifest.platform,
          sourceCommit: manifest.sourceCommit, node: process.versions.node, codex,
          sessionAcceptance: 'unverified-by-check',
        }));
        if (codex.status !== 'compatible' || plan.maintenance.interrupted ||
            ['unsafe', 'modified'].includes(plan.maintenance.entry.state) ||
            (plan.maintenance.activeRelease && plan.maintenance.entry.state === 'absent')) {
          process.exitCode = 1;
        }
      } else {
        if (codex.status !== 'compatible') throw Error('Pinned native Codex required: ' + codex.status);
        if (plan.hooks === 'unsafe') throw Error('Codex hook path must be a real directory and regular file');
        const shouldInstall = command === 'install-codex';
        if (shouldInstall && plan.maintenance.actions.install !== 'create') {
          throw Error('Codex entry preserved; review Bang plan or prepare and merge the candidate manually');
        }
        const receipt = explicitPreparation(project, codex.executable);
        const result = shouldInstall
          ? { ...receipt, ...maintain(project, 'install', release), hookFile: plan.hookFile }
          : receipt;
        console.log(JSON.stringify(result));
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
