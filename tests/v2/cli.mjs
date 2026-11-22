import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../packages/adapters/src/cli.ts', import.meta.url));

export async function createProject(t, environment = {}) {
  const path = await mkdtemp(join(tmpdir(), 'bang-v2-'));
  async function run(args, input, overrides = {}) {
    return new Promise((resolve, reject) => {
      const processArgs = ['--experimental-strip-types', cli, '--project', path, ...args];
      const env = { ...process.env, ...environment, ...overrides };
      const child = execFile(process.execPath, processArgs, { env }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr, { cause: error }));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (parseError) {
            reject(parseError);
          }
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
    });
  }
  t.after(async () => {
    await run(['stop']).catch(() => {});
    await rm(path, { recursive: true, force: true });
  });
  return { path, run };
}
