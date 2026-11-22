import {
  appendFileSync, closeSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const privatePaths = [
  '/.bang/bang.db*',
  '/.bang/server.json*',
  '/.bang/credentials.json*',
];

export function workspacePaths(project: string) {
  const root = realpathSync(project);
  const directory = join(root, '.bang');
  return {
    root,
    directory,
    config: join(directory, 'config.json'),
    database: join(directory, 'bang.db'),
    discovery: join(directory, 'server.json'),
  };
}

export function initializeWorkspace(project: string) {
  const paths = workspacePaths(project);
  mkdirSync(paths.directory, { recursive: true });
  closeSync(openSync(paths.database, 'a', 0o600));
  return paths;
}

export function writeWorkspaceDefaults(paths: ReturnType<typeof workspacePaths>) {
  const gitignore = join(paths.root, '.gitignore');
  let existing = '';
  try {
    existing = readFileSync(gitignore, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const missing = privatePaths.filter((entry) => !existing.split(/\r?\n/).includes(entry));
  if (missing.length) {
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    appendFileSync(gitignore, `${separator}\n# Bang local data\n${missing.join('\n')}\n`);
  }
  try {
    writeFileSync(paths.config, JSON.stringify({ auto_watch_project: false }, null, 2) + '\n', {
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
