import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { text as readStream } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Discovery } from '../../core/src/server.ts';
import { probeService, readDiscovery, requestService, startServer } from '../../core/src/server.ts';
import { BangError, requiredString } from '../../core/src/store.ts';
import { workspacePaths } from '../../core/src/workspace.ts';
import { codexCapture } from './codex-watcher.ts';

const args = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (args[index + 1] === undefined || args[index + 1].startsWith('--')) {
    throw new BangError('missing_argument', `${name} requires a value`);
  }
  return args.splice(index, 2)[1];
}

function flag(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function ensureService(project: string, port?: number) {
  const paths = workspacePaths(project);
  const existing = readDiscovery(paths);
  if (existing && (await probeService(existing))?.ready) return existing;

  const daemon = spawn(process.execPath, [
    '--experimental-strip-types',
    fileURLToPath(import.meta.url),
    '--project', paths.root, 'serve', '--foreground',
    ...(port === undefined ? [] : ['--port', String(port)]),
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  let failure: Error | undefined;
  daemon.on('error', (error) => { failure = error; });
  daemon.unref();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const discovered = readDiscovery(paths);
    if (discovered && (await probeService(discovered))?.ready) return discovered;
    if (failure) throw failure;
    if (daemon.exitCode !== null && daemon.exitCode !== 0) {
      throw new BangError('start_failed', 'Bang service failed to start. Run bang serve --foreground for details.');
    }
    await delay(50);
  }
  throw new BangError('start_timeout', 'Bang service did not become ready.');
}

async function call(service: Discovery, path: string, method = 'GET', body?: unknown) {
  const response = await requestService(service, path, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new BangError(String(result.code), String(result.message), response.status);
  }
  return result;
}

function startBrowser(url: string) {
  const [command, ...parameters] = process.platform === 'darwin'
    ? ['open', url]
    : process.platform === 'win32'
      ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
      : ['xdg-open', url];
  return new Promise<void>((resolve, reject) => {
    const browser = spawn(command, parameters, { stdio: 'ignore', windowsHide: true });
    browser.once('error', reject);
    browser.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not open browser. Open ${url}`));
    });
  });
}

async function main() {
  const project = option('--project') ?? process.cwd();
  const portArgument = option('--port');
  const port = portArgument === undefined ? undefined : Number(portArgument);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new BangError('invalid_port', 'Port must be an integer between 0 and 65535.');
  }
  const command = args.shift();
  if (command === 'help' || command === '--help' || command === undefined) {
    console.log('bang [--project <dir>] init | topic list/create/switch/archive | episode record/list/get | ingest | bind | unbind | sync | inspect | export | serve | stop | status | open');
    return;
  }
  if ((command === 'serve' || command === 'start') && flag('--foreground')) {
    const runtime = await startServer(project, { port, ...codexCapture() });
    if (runtime.owned) {
      process.once('SIGINT', () => void runtime.close());
      process.once('SIGTERM', () => void runtime.close());
    }
    print({ running: true, pid: runtime.discovery.pid, port: runtime.discovery.port });
    return;
  }
  if (command === 'sync' || command === 'inspect' || command === 'export' ||
      (command === 'status' && args.includes('--topic'))) {
    const topic = option('--topic');
    const service = await ensureService(project, port);
    const selected = requiredString(topic ?? (await call(service, '/api/topics')).activeTopicId, 'topic');
    const endpoint = `/api/topics/${encodeURIComponent(selected)}`;
    if (command === 'sync') return print(await call(service, `${endpoint}/sync`, 'POST', { sessionId: option('--session') }));
    if (command === 'export') return print(await call(service, `${endpoint}/export`, 'POST'));
    if (command === 'status') return print(await call(service, `${endpoint}/jobs`));
    const query = option('--query');
    const parameters = new URLSearchParams();
    if (query) parameters.set('query', query);
    if (flag('--include-superseded')) parameters.set('include_superseded', 'true');
    return print(await call(service, `${endpoint}/inspect?${parameters}`));
  }
  if (command === 'status' || command === 'stop') {
    const paths = workspacePaths(project);
    const discovered = readDiscovery(paths);
    const health = discovered && await probeService(discovered);
    if (command === 'status') {
      if (!discovered || !health) return print({ running: false });
      return print({ running: true, ready: health.ready, pid: discovered.pid, port: discovered.port,
        ...(health.ready ? await call(discovered, '/api/codex/bindings') : {}),
      });
    }
    if (!health && !existsSync(paths.database)) return print({ running: false, unverifiedSessions: [] });
    const service = discovered && health ? discovered : await ensureService(project, port);
    const result = await call(service, '/api/stop', 'POST');
    for (let attempt = 0; attempt < 100 && readDiscovery(paths)?.token === service.token; attempt += 1) {
      await delay(25);
    }
    if (readDiscovery(paths)?.token === service.token) {
      throw new BangError('stop_timeout', 'Bang service did not stop.');
    }
    return print(result);
  }
  if (['init', 'serve', 'start'].includes(command)) {
    const service = await ensureService(project, port);
    return print({ running: true, pid: service.pid, port: service.port, projectRoot: service.project_root });
  }
  if (command === 'open') {
    const topic = option('--topic');
    const urlOnly = flag('--url');
    const service = await ensureService(project, port);
    const result = await call(service, '/api/auth/exchange', 'POST', { topic });
    if (!urlOnly) await startBrowser(String(result.url));
    return print(urlOnly ? result : { opened: true });
  }
  if (command === 'bind' || command === 'unbind') {
    const hostSession = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
    const sessionId = requiredString(option('--session') ?? (hostSession || undefined), 'Codex session. Provide --session');
    const service = await ensureService(project, port);
    if (command === 'unbind') {
      return print(await call(service, `/api/codex/bindings/${encodeURIComponent(sessionId)}`, 'DELETE'));
    }
    const fromHost = sessionId === hostSession;
    const topicId = requiredString(option('--topic'), 'topic');
    const transcriptOption = option('--transcript');
    const turnOption = option('--turn');
    const transcript = (transcriptOption ?? (fromHost && process.env.CODEX_TRANSCRIPT_PATH)) || undefined;
    const turnId = (turnOption ?? (fromHost && process.env.CODEX_TURN_ID)) || undefined;
    return print(await call(service, '/api/codex/bindings', 'POST', {
      topicId, sessionId, transcript, turnId, includeActive: fromHost,
    }));
  }
  if (command === 'topic') {
    const action = args.shift();
    const service = await ensureService(project, port);
    if (action === 'list') return print(await call(service, '/api/topics'));
    if (action === 'create') {
      const title = option('--title');
      const description = option('--description');
      const name = requiredString(args.shift(), 'topic name');
      const input = title === undefined ? { name, description } : { slug: name, title, description };
      return print(await call(service, '/api/topics', 'POST', input));
    }
    if (action === 'switch' || action === 'archive') {
      const topic = requiredString(args.shift(), 'topic');
      return print(await call(service, `/api/topics/${encodeURIComponent(topic)}/${action}`, 'POST'));
    }
    throw new BangError('unknown_command', 'Expected topic list, create, switch or archive.');
  }
  if (command === 'episode' || command === 'ingest') {
    const action = command === 'ingest' ? 'record' : args.shift();
    const topic = option('--topic');
    const service = await ensureService(project, port);
    if (action === 'record') {
      const file = option('--file');
      const replaces = option('--replaces');
      const content = file === undefined ? await readStream(process.stdin) : await readFile(file, 'utf8');
      function parseInput(value: string) {
        let input: unknown;
        try {
          input = JSON.parse(value);
        } catch {
          throw new BangError('invalid_json', 'Expected an Episode JSON object');
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw new BangError('invalid_json', 'Expected an Episode JSON object');
        }
        return {
          ...input,
          ...(topic === undefined ? {} : { topicId: topic }),
          ...(replaces === undefined ? {} : { replacesEpisodeId: replaces }),
        };
      }
      if (file?.endsWith('.jsonl')) {
        const requests = content.split(/\r?\n/).filter((line) => line.trim()).map(parseInput);
        const results = [];
        for (const request of requests) results.push(await call(service, '/api/episodes', 'POST', request));
        return print({ results });
      }
      return print(await call(service, '/api/episodes', 'POST', parseInput(content)));
    }
    const selected = topic ?? (await call(service, '/api/topics')).activeTopicId;
    const id = requiredString(selected, 'topic');
    const endpoint = `/api/topics/${encodeURIComponent(id)}/episodes`;
    if (action === 'list') {
      const session = option('--session');
      return print(await call(service, session ? `${endpoint}?session=${encodeURIComponent(session)}` : endpoint));
    }
    if (action === 'get') {
      const episode = requiredString(args.shift(), 'Episode ID');
      return print(await call(service, `${endpoint}/${encodeURIComponent(episode)}`));
    }
    throw new BangError('unknown_command', 'Expected episode record, list, or get.');
  }
  throw new BangError('unknown_command', `Unknown command ${command}`);
}

await main().catch((error) => {
  const code = error instanceof BangError ? error.code : 'bang_error';
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ code, message }));
  process.exitCode = 1;
});
