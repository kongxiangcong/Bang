import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('.', import.meta.url));
const home = homedir();
const skills = join(home, '.agents', 'skills');
const skill = join(skills, 'bang');
const releases = join(home, '.local', 'share', 'bang', 'releases');
const launcherName = 'launch.mjs';
const installMetadata = /\n<!-- Bang source install: ([\w-]+) ([a-f0-9]{64}) -->\n$/u;
const launcher = `import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const skill = readFileSync(new URL('SKILL.md', import.meta.url), 'utf8');
const installation = ${installMetadata}.exec(skill);
if (!installation) throw new Error('Bang installation metadata is missing. Rerun node install.mjs.');
const entry = Buffer.from(installation[1], 'base64url').toString('utf8');
await import(pathToFileURL(entry).href);
`;

function metadata(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function checksum(content, entry) {
  return createHash('sha256').update(content).update(entry).digest('hex');
}

function installation() {
  const directory = metadata(skill);
  if (!directory || (directory.isDirectory() && readdirSync(skill).length === 0)) return { state: 'empty' };
  if (directory.isDirectory()) {
    const document = join(skill, 'SKILL.md');
    const launch = join(skill, launcherName);
    if (metadata(document)?.isFile() && metadata(launch)?.isFile()) {
      const content = readFileSync(document, 'utf8');
      const marker = installMetadata.exec(content);
      if (marker && checksum(content.slice(0, marker.index), marker[1]) === marker[2] &&
          readFileSync(launch, 'utf8') === launcher) {
        return { state: 'managed', content };
      }
    }
  }
  return { state: 'custom' };
}

function shellArgument(value) {
  return process.platform === 'win32'
    ? "'" + value.replaceAll("'", "''") + "'"
    : "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function install() {
  const previous = installation();
  if (previous.state === 'custom') {
    console.log(`已保留现有 Bang 技能 ${skill}`);
    return;
  }
  const template = readFileSync(join(source, 'skills', 'bang', 'SKILL.md'), 'utf8');
  if (!template.includes('{{BANG_ENTRY}}')) throw new Error('Bang skill template is missing its entry placeholder.');
  const interpreter = process.platform === 'win32' ? '& ' : '';
  const command = `${interpreter}${shellArgument(process.execPath)} --experimental-strip-types ${shellArgument(join(skill, launcherName))}`;
  const document = template.replaceAll('{{BANG_ENTRY}}', () => command);
  mkdirSync(skills, { recursive: true });
  mkdirSync(releases, { recursive: true, mode: 0o700 });
  const release = mkdtempSync(join(releases, 'bang-'));
  let staged;
  let published = false;
  try {
    // Each daemon keeps the source files from its own launch, including lazy imports.
    for (const workspace of ['adapters', 'core']) {
      const path = join('packages', workspace);
      mkdirSync(join(release, path), { recursive: true });
      cpSync(join(source, path, 'package.json'), join(release, path, 'package.json'));
      cpSync(join(source, path, 'src'), join(release, path, 'src'), { recursive: true });
    }
    const releaseEntry = join(release, 'packages', 'adapters', 'src', 'cli.ts');
    const entry = Buffer.from(releaseEntry).toString('base64url');
    staged = mkdtempSync(join(skills, '.bang-'));
    writeFileSync(join(staged, launcherName), launcher);
    writeFileSync(join(staged, 'SKILL.md'),
      `${document}\n<!-- Bang source install: ${entry} ${checksum(document, entry)} -->\n`);
    const check = spawnSync(process.execPath, [
      '--experimental-strip-types', join(staged, launcherName), 'help',
    ], { encoding: 'utf8' });
    if (check.error) throw check.error;
    if (check.status !== 0) throw new Error(check.stderr.trim() || 'Bang runtime check failed.');

    const current = installation();
    if (current.state !== previous.state || current.content !== previous.content) {
      throw new Error('Bang skill changed during installation. Rerun node install.mjs.');
    }
    // On update SKILL.md publishes both the refreshed instructions and the release pointer.
    if (previous.state === 'managed') {
      renameSync(join(staged, 'SKILL.md'), join(skill, 'SKILL.md'));
    } else {
      renameSync(staged, skill);
    }
    published = true;
    console.log(`已安装 Bang 技能 ${skill}`);
  } finally {
    if (staged) rmSync(staged, { recursive: true, force: true });
    if (!published) rmSync(release, { recursive: true, force: true });
  }
}

try {
  install();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
