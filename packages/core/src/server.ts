import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { BangError, BangStore, requiredString } from './store.ts';
import { ReasoningEngine } from './reasoning/engine.ts';
import { routeReasoning } from './reasoning/routes.ts';
import { initializeWorkspace, writeWorkspaceDefaults } from './workspace.ts';
import { serveWhiteboard } from './whiteboard.ts';

const host = '127.0.0.1';
const defaultPort = 4318;
const token = () => randomBytes(32).toString('base64url');

export type Discovery = {
  pid: number;
  port: number;
  token: string;
  started_at: string;
  project_root: string;
};

type ProjectPaths = ReturnType<typeof initializeWorkspace>;
type LifecycleContext = { store: BangStore; paths: ProjectPaths };
export type RouteContext = LifecycleContext & {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  parts: string[];
  body: () => Promise<Record<string, unknown>>;
  json: (value: unknown, status?: number) => void;
};
type RuntimeOptions = {
  port?: number;
  route?: (context: RouteContext) => boolean | Promise<boolean>;
  onStart?: (context: LifecycleContext) => void | (() => void | Promise<void>)
    | Promise<void | (() => void | Promise<void>)>;
  onStop?: (context: LifecycleContext, stoppedAt: number) => Promise<{ unverifiedSessions: string[] }>;
};

function readDiscoveryFile(file: string) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function parseDiscovery(raw: string | undefined, project: string): Discovery | undefined {
  if (!raw) return;
  try {
    const data = JSON.parse(raw) as Partial<Discovery> | null;
    if (data && data.project_root === project && Number.isSafeInteger(data.pid) &&
        Number.isSafeInteger(data.port) && data.port! > 0 && data.port! <= 65535 &&
        typeof data.started_at === 'string' && typeof data.token === 'string' &&
        /^[\w-]{43}$/.test(data.token)) {
      return data as Discovery;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}

export function readDiscovery(paths: ProjectPaths) {
  return parseDiscovery(readDiscoveryFile(paths.discovery), paths.root);
}

export function requestService(service: Discovery, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${service.token}`);
  return fetch(`http://${host}:${service.port}${path}`, { ...init, headers, redirect: 'error' });
}

export async function probeService(service: Discovery) {
  try {
    const response = await requestService(service, '/api/health', { signal: AbortSignal.timeout(500) });
    if (!response.ok) return;
    const health = await response.json() as {
      pid: number; project_root: string; version: string; ready: boolean;
    };
    if (health.pid === service.pid && health.project_root === service.project_root) return health;
  } catch {
    return undefined;
  }
}

function writeDiscovery(path: string, service: Discovery) {
  const candidate = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    writeFileSync(candidate, JSON.stringify(service) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(candidate, path);
  } finally {
    try {
      unlinkSync(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

async function readBody(request: IncomingMessage) {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new BangError('invalid_content_type', 'Expected application/json', 415);
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 8 * 1024 * 1024) {
      request.resume();
      throw new BangError('body_too_large', 'Request exceeds 8 MiB', 413);
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  throw new BangError('invalid_json', 'Expected a JSON object');
}

function listen(server: Server, port: number) {
  return new Promise<number>((resolve, reject) => {
    function onError(error: Error) {
      server.off('listening', onListening);
      reject(error);
    }
    function onListening() {
      server.off('error', onError);
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Unable to determine bound loopback port'));
    }
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function listenAvailable(server: Server, preferred: number) {
  for (let port = preferred; port <= 65535; port += 1) {
    try {
      return await listen(server, port);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No loopback port available');
}

export async function startServer(project: string, options: RuntimeOptions = {}) {
  const paths = initializeWorkspace(project);
  const store = new BangStore(paths.database);
  const lifecycle = { store, paths };
  const reasoning = new ReasoningEngine(store, paths);
  const bearer = token();
  const tickets = new Map<string, { topic: string; expires: number }>();
  const sessions = new Map<string, number>();
  let service: Discovery;
  let ready = false;
  let teardown: void | (() => void | Promise<void>);
  let closing: Promise<void> | undefined;
  let reasoningClosing: Promise<void> | undefined;
  let stopping: Promise<{ unverifiedSessions: string[] }> | undefined;

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');

    function json(value: unknown, status = 200) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    }

    try {
      const address = `${host}:${service.port}`;
      const origin = `http://${address}`;
      if (request.socket.remoteAddress !== host || request.headers.host !== address ||
          (request.headers.origin !== undefined && request.headers.origin !== origin)) {
        throw new BangError('invalid_origin', 'Invalid loopback request', 403);
      }
      const target = request.url ?? '/';
      if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
        throw new BangError('invalid_path', 'Invalid request path');
      }
      const url = new URL(target, origin);
      let parts: string[];
      try {
        parts = url.pathname.split('/').slice(1).map(decodeURIComponent);
      } catch {
        throw new BangError('invalid_path', 'Invalid request path');
      }
      const method = request.method;
      const authenticatedCli = request.headers.authorization === `Bearer ${bearer}`;
      const cookieName = `bang_session_${service.port}`;
      if (method === 'GET' && url.pathname === '/api/auth/exchange') {
        const supplied = url.searchParams.get('token') ?? '';
        const ticket = tickets.get(supplied);
        tickets.delete(supplied);
        if (!ticket || ticket.expires <= Date.now() || !ready) {
          throw new BangError('invalid_exchange', 'Browser exchange is invalid or expired', 401);
        }
        const session = token();
        for (const [id, expires] of sessions) {
          if (expires <= Date.now()) sessions.delete(id);
        }
        const maxAge = 12 * 60 * 60;
        sessions.set(session, Date.now() + maxAge * 1000);
        response.writeHead(303, {
          Location: ticket.topic ? `/?topic=${encodeURIComponent(ticket.topic)}` : '/',
          'Set-Cookie': `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
        });
        response.end();
        return;
      }
      const cookie = request.headers.cookie?.split(/;\s*/).find((entry) => entry.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      const session = cookie ? sessions.get(cookie) : undefined;
      const site = request.headers['sec-fetch-site'];
      const authenticatedBrowser = session && session > Date.now() &&
        (site === undefined || site === 'same-origin' || site === 'none');
      if (!authenticatedCli && !authenticatedBrowser) {
        throw new BangError('unauthorized', 'Authorization required', 401);
      }
      if (method === 'GET' && url.pathname === '/api/health') {
        return json({ pid: service.pid, project_root: paths.root, version: '2.0.0', ready });
      }
      if (method === 'POST' && url.pathname === '/api/stop') {
        if (!authenticatedCli) throw new BangError('unauthorized', 'CLI authorization required', 401);
        if (!stopping && !ready) throw new BangError('starting', 'Bang is starting', 503);
        stopping ??= stop(Date.now());
        try {
          const result = await stopping;
          if (!response.destroyed) json({ running: false, ...result });
        } finally {
          const shutdown = () => void close().catch((error) => console.error(error));
          if (response.writableFinished || response.destroyed) shutdown();
          else response.once('finish', shutdown).once('close', shutdown);
        }
        return;
      }
      if (!ready) throw closing || stopping
        ? new BangError('service_stopping', 'Bang is stopping', 503)
        : new BangError('starting', 'Bang is starting', 503);

      let body: ReturnType<typeof readBody> | undefined;
      const read = () => body ??= readBody(request).then((input) => {
        if (!ready) throw new BangError('service_stopping', 'Bang is stopping', 503);
        return input;
      });
      if (method === 'POST' && url.pathname === '/api/auth/exchange') {
        if (!authenticatedCli) throw new BangError('unauthorized', 'CLI authorization required', 401);
        const { topic } = await read();
        const selected = topic === undefined ? '' : store.findTopic(requiredString(topic, 'topic')).slug;
        const now = Date.now();
        for (const [id, value] of tickets) {
          if (value.expires <= now) tickets.delete(id);
        }
        const id = token();
        tickets.set(id, { topic: selected, expires: now + 60_000 });
        return json({ url: `${origin}/api/auth/exchange?token=${id}` });
      }
      if (url.pathname === '/api/topics') {
        if (method === 'GET') return json(store.listTopics());
        if (method === 'POST') return json(store.createTopic(await read()), 201);
      }
      if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'topics') {
        if (parts[3] === 'switch') return json(store.switchTopic(parts[2]));
        if (parts[3] === 'archive') return json(store.archiveTopic(parts[2]));
      }
      if (method === 'POST' && url.pathname === '/api/episodes') {
        const result = store.recordEpisode(await read());
        return json(result, result.status === 'recorded' ? 201 : 200);
      }
      if (parts[0] === 'api' && parts[1] === 'topics' && parts[3] === 'episodes') {
        if (method === 'POST' && parts.length === 4) {
          const result = store.recordEpisode({ ...await read(), topicId: parts[2] });
          return json(result, result.status === 'recorded' ? 201 : 200);
        }
        if (method === 'GET' && parts.length === 4) {
          return json({ episodes: store.listEpisodes(parts[2], url.searchParams.get('session') ?? undefined) });
        }
        if (method === 'GET' && parts.length === 5) {
          return json(store.getEpisode(parts[2], parts[4]));
        }
      }
      const context = { ...lifecycle, request, response, url, parts, body: read, json };
      if (options.route && await options.route(context)) return;
      if (await routeReasoning(reasoning, context)) return;
      if (method === 'GET' && serveWhiteboard(url.pathname, response)) return;
      throw new BangError('not_found', 'Route not found', 404);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
      } else if (error instanceof BangError) {
        json({ code: error.code, message: error.message }, error.status);
      } else {
        console.error(error);
        json({ code: 'internal_error', message: 'Internal server error' }, 500);
      }
    }
  });

  async function stop(stoppedAt: number) {
    ready = false;
    store.endCapture(stoppedAt);
    reasoningClosing ??= reasoning.close();
    return await options.onStop?.(lifecycle, stoppedAt) ?? { unverifiedSessions: [] };
  }

  function close() {
    closing ??= (async () => {
      ready = false;
      try {
        await Promise.allSettled([reasoningClosing ??= reasoning.close(), teardown?.(), stopping]);
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
        try {
          store.transaction(() => {
            if (readDiscovery(paths)?.token === bearer) unlinkSync(paths.discovery);
          });
        } finally {
          store.close();
        }
      }
    })();
    return closing;
  }

  try {
    const port = await listenAvailable(server, options.port ?? defaultPort);
    service = {
      pid: process.pid, port, token: bearer, started_at: new Date().toISOString(), project_root: paths.root,
    };
    // Compare and publish while holding SQLite's writer lock. Concurrent starts can
    // probe outside the lock, but only one can publish the observed discovery state.
    while (true) {
      const observed = readDiscoveryFile(paths.discovery);
      const previous = parseDiscovery(observed, paths.root);
      if (previous && await probeService(previous)) {
        await close();
        return { discovery: previous, close, owned: false };
      }
      const claimed = store.transaction(() => {
        if (readDiscoveryFile(paths.discovery) !== observed) return false;
        writeWorkspaceDefaults(paths);
        writeDiscovery(paths.discovery, service);
        return true;
      });
      if (claimed) break;
    }
    teardown = await options.onStart?.(lifecycle);
    reasoning.start();
    ready = true;
    return { discovery: service, close, owned: true };
  } catch (error) {
    await close();
    throw error;
  }
}
