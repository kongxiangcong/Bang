import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { inventory, nodeVersion, platforms, sha256 } from './resources.mjs';

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(path.basename(file) + ' exited with ' + result.status);
  return result.stdout?.trim();
}

const { values } = parseArgs({
  options: {
    'node-archive': { type: 'string' },
    output: { type: 'string' },
    ref: { type: 'string', default: 'HEAD' },
    'npm-cache': { type: 'string' },
  },
});
if (!values['node-archive'] || !values.output) {
  throw Error('Usage: node release/package.mjs --node-archive FILE --output NEW_DIRECTORY [--ref COMMIT] [--npm-cache CACHE]');
}

const platformId = process.platform + '-' + process.arch;
const platform = platforms[platformId];
if (!platform) throw Error('No package builder is configured for ' + platformId);
const archive = path.resolve(values['node-archive']);
if (sha256(archive) !== platform.archiveSha256) {
  throw Error('Official Node archive SHA-256 mismatch for ' + platform.archive);
}
const output = path.resolve(values.output);
if (fs.lstatSync(output, { throwIfNoEntry: false })) throw Error('Choose a new output directory');
const sourceCommit = run('git', ['rev-parse', '--verify', '--end-of-options', values.ref + '^{commit}'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const work = fs.mkdtempSync(path.join(path.dirname(output), '.bang-package-'));

function copyFile(source, relative, destinationRoot) {
  const destination = path.join(destinationRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

try {
  const checkout = path.join(work, 'source');
  const nodeExtraction = path.join(work, 'node-distribution');
  const extractedTar = path.join(work, 'source.tar');
  const delivery = path.join(work, 'delivery');
  const packageName = 'bang-codex-' + platform.name;
  const stage = path.join(delivery, packageName);
  for (const dir of [checkout, nodeExtraction, stage]) fs.mkdirSync(dir, { recursive: true });

  run('git', [
    'archive', '--format=tar', '--output=' + extractedTar, sourceCommit,
    'runtime', 'release', 'prototypes/whiteboard-integration',
  ]);
  run('tar', ['-xf', extractedTar, '-C', checkout]);
  run('tar', ['-xf', archive, '-C', nodeExtraction]);
  const distribution = path.join(nodeExtraction, platform.archiveRoot);
  const node = path.join(distribution, platform.node);
  if (run(node, ['--version'], { stdio: ['ignore', 'pipe', 'inherit'] }) !== 'v' + nodeVersion) {
    throw Error('Bundled Node version mismatch');
  }
  const runtimeSource = path.join(checkout, 'runtime');
  for (const [helper, digest] of Object.entries(platform.helpers)) {
    const source = path.join(runtimeSource, 'native', helper);
    if (sha256(source) !== digest) throw Error('Native helper SHA-256 mismatch: ' + helper);
    copyFile(source, 'runtime/native/' + helper, stage);
    if (process.platform !== 'win32') fs.chmodSync(path.join(stage, 'runtime', 'native', helper), 0o755);
  }
  for (const file of inventory(runtimeSource)) {
    if (file.startsWith('dsh/') && file !== 'dsh/executor-config.mjs') continue;
    if ((/\.(mjs|ts|json)$/.test(file) && file !== 'native/build.mjs') ||
        file === 'companion/organizer.md' || file === 'companion/start.ps1') {
      copyFile(path.join(runtimeSource, file), 'runtime/' + file, stage);
    }
  }
  for (const file of ['bang.mjs', 'editor.mjs', 'resources.mjs']) {
    copyFile(path.join(checkout, 'release', file), 'release/' + file, stage);
  }
  copyFile(node, 'node/' + platform.node, stage);
  if (process.platform !== 'win32') fs.chmodSync(path.join(stage, 'node', platform.node), 0o755);
  copyFile(path.join(distribution, 'LICENSE'), 'licenses/Node-LICENSE', stage);
  copyFile(path.join(checkout, 'release', platform.launcher), platform.launcher, stage);
  if (process.platform !== 'win32') fs.chmodSync(path.join(stage, platform.launcher), 0o755);
  copyFile(path.join(checkout, 'release', 'README.md'), 'README.md', stage);

  const editor = path.join(checkout, 'prototypes', 'whiteboard-integration');
  const npm = path.join(distribution, platform.npm);
  const npmCache = values['npm-cache'] ? path.resolve(values['npm-cache']) : path.join(work, 'npm-cache');
  const environment = {
    ...process.env, NODE_OPTIONS: '',
    PATH: path.dirname(node) + path.delimiter + process.env.PATH,
    npm_config_userconfig: path.join(work, 'npmrc'),
    npm_config_globalconfig: path.join(work, 'npmrc-global'),
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_cache: npmCache,
  };
  const npmOptions = { cwd: editor, env: environment };
  run(node, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], npmOptions);
  run(node, [npm, 'run', 'build', '--', '--mode', 'packaged'], npmOptions);
  const dist = path.join(editor, 'dist');
  for (const asset of inventory(dist)) copyFile(path.join(dist, asset), 'editor/' + asset, stage);

  const files = Object.fromEntries(inventory(stage).map(file => [file, sha256(path.join(stage, file))]));
  fs.writeFileSync(path.join(stage, 'package-manifest.json'), JSON.stringify({
    format: 1, platform: platformId, sourceCommit, nodeVersion,
    nodeArchive: platform.archive, nodeArchiveSha256: platform.archiveSha256,
    packageUse: 'local-validation', files,
  }, null, 2) + '\n');
  const artifact = packageName + platform.packageExtension;
  run('tar', ['-caf', path.join(delivery, artifact), '-C', delivery, packageName]);
  fs.writeFileSync(path.join(delivery, artifact + '.sha256'), sha256(path.join(delivery, artifact)) + '  ' + artifact + '\n');
  fs.renameSync(delivery, output);
  console.log(JSON.stringify({ output, sourceCommit, platform: platformId, files: Object.keys(files).length }));
} finally {
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
