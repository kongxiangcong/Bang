import { createInterface } from 'node:readline';
import { sourceHarness } from '../../core/src/delivery.ts';
import { BangError, requiredString } from '../../core/src/store.ts';

type ServiceCall = <Result = Record<string, unknown>>(path: string, method?: string, body?: unknown) => Promise<Result>;
type ObjectValue = Record<string, unknown>;
const text = { type: 'string' };
const boolean = { type: 'boolean' };

function tool(name: string, description: string, properties: ObjectValue, required: string[]) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}

const tools = [
  tool('bang_topics', 'List or create topics, or explicitly bind a host session to a topic.', {
    action: { type: 'string', enum: ['list', 'create', 'bind'] }, slug: text, title: text,
    harness: text, session_id: text,
  }, ['action']),
  tool('bang_record_turn', 'Deliver a completed original exchange using the host’s stable native turn ID. Preserve the binding ID if available. Omit the turn ID for watcher-managed Codex sessions when the native ID is unavailable.', {
    topic_id: text, harness: text, session_id: text, source_turn_id: text, binding_id: text,
    user_text: text, assistant_text: text, occurred_at: text, replaces_episode_id: text,
  }, ['harness', 'session_id', 'user_text', 'assistant_text']),
  tool('bang_sync', 'Queue immediate reasoning for saved Episodes.', {
    topic_id: text, session_id: text,
  }, ['topic_id']),
  tool('bang_query_board', 'Read landmarks, conditions, open questions and belief history for a topic.', {
    topic_id: text, query: text, include_superseded: boolean,
  }, ['topic_id']),
  tool('bang_update_epistemic', 'Update only personal mastery, stance or a user-confirmed change in understanding.', {
    topic_id: text, node_id: text, mastery: text, stance: text,
    belief_shift: {
      type: 'object', additionalProperties: false,
      properties: { previous_belief: text, correction: text, trigger_episode_id: text },
      required: ['previous_belief', 'correction', 'trigger_episode_id'],
    },
  }, ['topic_id', 'node_id']),
];

function object(value: unknown): ObjectValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
}

function toolResult(result: ObjectValue, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError };
}

async function runTool(call: ServiceCall, name: string, input: ObjectValue) {
  if (name === 'bang_topics') {
    if (input.action === 'list') return call('/api/topics');
    if (input.action === 'create') return call('/api/topics', 'POST', { slug: input.slug, title: input.title });
    if (input.action === 'bind') {
      const harness = sourceHarness(input.harness ?? process.env.BANG_HARNESS ?? 'codex');
      const hostSession = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
      const sessionId = requiredString(input.session_id ?? (harness === 'codex' ? hostSession : process.env.BANG_SESSION_ID),
        'session_id');
      const topicId = requiredString(input.slug, 'slug');
      return harness === 'codex'
        ? call('/api/codex/bindings', 'POST', { sessionId, topicId, includeActive: sessionId === hostSession })
        : call('/api/delivery/bindings', 'POST', { harness, sessionId, topicId });
    }
    throw new BangError('invalid_action', 'Expected list, create or bind');
  }
  if (name === 'bang_record_turn') return call('/api/delivery/turns', 'POST', input);

  const topic = '/api/topics/' + encodeURIComponent(requiredString(input.topic_id, 'topic_id'));
  if (name === 'bang_sync') {
    const queued = await call<{ jobs: { id: string; status: string }[] }>(`${topic}/sync`, 'POST',
      { sessionId: input.session_id, enqueue: true });
    return { ...queued, job_id: queued.jobs[0]?.id ?? null, status: queued.jobs[0]?.status ?? 'idle' };
  }
  if (name === 'bang_query_board') {
    const parameters = new URLSearchParams();
    if (input.query !== undefined) parameters.set('query', requiredString(input.query, 'query'));
    if (input.include_superseded === true) parameters.set('include_superseded', 'true');
    return call(`${topic}/inspect?${parameters}`);
  }
  return call(`${topic}/epistemic`, 'POST', input);
}

const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export async function serveMcp(call: ServiceCall) {
  function write(message: ObjectValue) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  async function handle(line: string) {
    let request: ObjectValue | undefined;
    try {
      request = object(JSON.parse(line));
    } catch {
      write({ id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
        (request.id !== undefined && typeof request.id !== 'string' && typeof request.id !== 'number')) {
      write({ id: null, error: { code: -32600, message: 'Invalid request' } });
      return;
    }
    const { id, method } = request;
    if (id === undefined) return;
    const params = object(request.params) ?? {};
    function result(value: ObjectValue) {
      write({ id, result: value });
    }
    if (method === 'initialize') {
      const requested = params.protocolVersion;
      return result({
        protocolVersion: typeof requested === 'string' && versions.includes(requested) ? requested : versions[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'bang', version: '2.0.0' },
      });
    }
    if (method === 'ping') return result({});
    if (method === 'tools/list') return result({ tools });
    if (method === 'tools/call') {
      const name = params.name;
      if (typeof name !== 'string' || !tools.some((tool) => tool.name === name) ||
          (params.arguments !== undefined && !object(params.arguments))) {
        write({ id, error: { code: -32602, message: 'Invalid tool name or arguments' } });
        return;
      }
      try {
        result(toolResult(await runTool(call, name, object(params.arguments) ?? {})));
      } catch (error) {
        result(toolResult(error instanceof BangError
          ? { code: error.code, message: error.message }
          : { code: 'bang_error', message: 'Unable to complete the Bang operation' }, true));
      }
      return;
    }
    write({ id, error: { code: -32601, message: 'Method not found' } });
  }

  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    const request = handle(line).finally(() => pending.delete(request));
    pending.add(request);
  }
  await Promise.all(pending);
}
