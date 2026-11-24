import { randomUUID } from 'node:crypto';
import { filterExchange } from './capture-filter.ts';
import type { RouteContext } from './server.ts';
import { BangError, episodeTimestamp, requiredString } from './store.ts';
import type { BangStore, EpisodeInput } from './store.ts';

type DeliveryBinding = {
  harness: string;
  session_id: string;
  topic_id: string;
  binding_id: string;
  started_at: number;
  ended_at: number | null;
  rebound: number;
};

type StoppedInterval = Omit<DeliveryBinding, 'rebound' | 'ended_at'> & { ended_at: number };
type DeliveryPreparation = { result: { status: string; [key: string]: unknown } }
  | { episode: EpisodeInput; stopped: boolean };

type WatcherBinding = {
  harness: string;
  session_id: string;
  topic_id: string;
  enabled: number;
};

function deliverySummary(binding: DeliveryBinding) {
  return {
    sourceTool: binding.harness,
    sessionId: binding.session_id,
    topicId: binding.topic_id,
    enabled: binding.ended_at === null,
    bindingId: binding.binding_id,
  };
}

export function sourceHarness(value: unknown) {
  return requiredString(value, 'harness').trim().toLowerCase();
}

function deliveryBinding(store: BangStore, harness: string, session: string) {
  return store.db.prepare('SELECT * FROM delivery_bindings WHERE harness = ? AND session_id = ?')
    .get(harness, session) as DeliveryBinding | undefined;
}

function stoppedInterval(store: BangStore, bindingId: string, harness: string, session: string) {
  return store.db.prepare('SELECT * FROM stopped_delivery_intervals WHERE binding_id = ? AND harness = ? AND session_id = ?')
    .get(bindingId, harness, session) as StoppedInterval | undefined;
}

function captureBindings(store: BangStore) {
  const watcher = store.db.prepare('SELECT harness, session_id, topic_id, enabled FROM adapter_cursors ORDER BY session_id')
    .all() as WatcherBinding[];
  const delivery = store.db.prepare(`
    SELECT * FROM delivery_bindings AS delivery WHERE NOT EXISTS (
      SELECT 1 FROM adapter_cursors WHERE harness = delivery.harness AND session_id = delivery.session_id
    ) ORDER BY session_id, harness
  `).all() as DeliveryBinding[];
  return {
    bindings: [
      ...watcher.map((binding) => ({
        sourceTool: binding.harness, sessionId: binding.session_id, topicId: binding.topic_id, enabled: binding.enabled === 1,
      })),
      ...delivery.map(deliverySummary),
    ],
  };
}

function openDeliveryInterval(store: BangStore, harness: string, session: string, topic: string, rebound: boolean) {
  store.db.prepare(`
    INSERT INTO delivery_bindings (harness, session_id, topic_id, binding_id, started_at, rebound)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(harness, session_id) DO UPDATE SET
      topic_id = excluded.topic_id, binding_id = excluded.binding_id, started_at = excluded.started_at,
      ended_at = NULL, rebound = excluded.rebound
  `).run(harness, session, topic, randomUUID(), Date.now(), Number(rebound));
}

function closeDeliveryInterval(store: BangStore, harness: string, session: string) {
  store.db.prepare('UPDATE delivery_bindings SET ended_at = ? WHERE harness = ? AND session_id = ? AND ended_at IS NULL')
    .run(Date.now(), harness, session);
}

function bindDelivery(store: BangStore, input: Record<string, unknown>, watcherHarnesses: readonly string[]) {
  const harness = sourceHarness(input.harness);
  if (watcherHarnesses.includes(harness)) throw new BangError('invalid_harness', 'Use the watcher binding for this harness');
  const session = requiredString(input.sessionId, 'sessionId');
  const topic = store.findTopic(requiredString(input.topicId, 'topicId'));
  if (topic.status === 'archived') throw new BangError('topic_archived', 'Topic is archived', 409);
  const prior = deliveryBinding(store, harness, session);
  if (prior && prior.ended_at === null && prior.topic_id !== topic.id) {
    throw new BangError('session_already_bound', 'Unbind this session before selecting another topic', 409);
  }
  if (!prior || prior.ended_at !== null) openDeliveryInterval(store, harness, session, topic.id, Boolean(prior));
  return { status: 'bound', ...deliverySummary(deliveryBinding(store, harness, session)!) };
}

function unbindDelivery(store: BangStore, harness: string, session: string, watcherHarnesses: readonly string[]) {
  if (watcherHarnesses.includes(harness)) throw new BangError('invalid_harness', 'Use the watcher binding for this harness');
  if (!deliveryBinding(store, harness, session)) {
    throw new BangError('binding_not_found', 'Session is not bound', 404);
  }
  closeDeliveryInterval(store, harness, session);
  return { status: 'unbound', ...deliverySummary(deliveryBinding(store, harness, session)!) };
}

function verifyWatchedTurn(store: BangStore, watcher: WatcherBinding, input: Record<string, unknown>) {
  const managed = { status: 'watcher_managed', topicId: watcher.topic_id };
  if (input.source_turn_id === undefined || input.replaces_episode_id !== undefined) return managed;
  const turnId = requiredString(input.source_turn_id, 'source_turn_id');
  const original = store.findOriginalEpisode(watcher.topic_id, watcher.harness, watcher.session_id, turnId);
  if (!original) return managed;
  const exchange = filterExchange(requiredString(input.user_text, 'user_text'), requiredString(input.assistant_text, 'assistant_text'));
  return exchange && original.messages[0].content === exchange.user && original.messages[1].content === exchange.assistant
    ? { status: 'duplicate', episode: original }
    : managed;
}

export function prepareDelivery(store: BangStore, input: Record<string, unknown>): DeliveryPreparation {
  const harness = sourceHarness(input.harness);
  const session = requiredString(input.session_id, 'session_id');
  const suppliedInterval = input.binding_id === undefined ? undefined : requiredString(input.binding_id, 'binding_id');
  const binding = deliveryBinding(store, harness, session);
  const watcher = store.db.prepare(`
    SELECT harness, session_id, topic_id, enabled FROM adapter_cursors WHERE harness = ? AND session_id = ?
  `).get(harness, session) as WatcherBinding | undefined;
  const stopped = suppliedInterval && !watcher ? stoppedInterval(store, suppliedInterval, harness, session) : undefined;
  const interval = stopped ?? binding;
  const topicId = watcher?.topic_id ?? interval?.topic_id;
  const inactive = { result: { status: 'capture_inactive' } };
  if (watcher ? !watcher.enabled : ((!stopped && binding && binding.ended_at !== null) ||
      (suppliedInterval !== undefined && interval?.binding_id !== suppliedInterval))) return inactive;

  const suppliedTopic = input.topic_id === undefined ? undefined
    : store.findTopic(requiredString(input.topic_id, 'topic_id'));
  if (topicId && suppliedTopic && suppliedTopic.id !== topicId) {
    throw new BangError('binding_topic_mismatch', 'The session is bound to a different topic', 409);
  }
  const topic = topicId ? store.findTopic(topicId) : suppliedTopic;
  if (topic?.status === 'archived') return inactive;
  if (watcher) return { result: verifyWatchedTurn(store, watcher, input) };

  if (!topicId) {
    const available = store.listTopics().topics.filter(({ status }) => status === 'active');
    if (!suppliedTopic && available.length > 1) return { result: { status: 'topic_selection_required', topics: available } };
    return inactive;
  }
  const occurredAt = input.occurred_at === undefined ? undefined : episodeTimestamp(input.occurred_at);
  const completedAt = input.completed_at === undefined ? undefined : episodeTimestamp(input.completed_at);
  const completed = completedAt === undefined ? undefined : Date.parse(completedAt);
  const occurred = occurredAt === undefined ? undefined : Date.parse(occurredAt);
  if (stopped && (completed === undefined || completed >= stopped.ended_at)) return inactive;
  if (interval && ((occurred !== undefined && occurred < interval.started_at) ||
      (completed !== undefined && completed < interval.started_at))) return inactive;
  if (completed !== undefined && ((occurred !== undefined && completed < occurred) || completed > Date.now())) return inactive;
  if (binding?.rebound && !occurredAt && !suppliedInterval) return { result: { status: 'capture_interval_required' } };
  const turnId = requiredString(input.source_turn_id, 'source_turn_id');
  const exchange = filterExchange(requiredString(input.user_text, 'user_text'), requiredString(input.assistant_text, 'assistant_text'));
  if (!exchange) return { result: { status: 'skipped_operation' } };
  const timestamp = occurredAt ?? completedAt ?? new Date().toISOString();
  return { stopped: Boolean(stopped), episode: {
    topicId, sourceTool: harness, sessionId: session, turnId,
    replacesEpisodeId: input.replaces_episode_id,
    messages: [
      { role: 'user', timestamp, content: exchange.user },
      { role: 'assistant', timestamp: completedAt ?? timestamp, content: exchange.assistant },
    ],
  } };
}

export async function routeDelivery({ store, request, url, parts, body, json }: RouteContext, watcherHarnesses: readonly string[] = []) {
  if (request.method === 'GET' && url.pathname === '/api/bindings') {
    json(captureBindings(store));
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/delivery/bindings') {
    json(bindDelivery(store, await body(), watcherHarnesses));
    return true;
  }
  if (request.method === 'DELETE' && parts.length === 5 &&
      parts[0] === 'api' && parts[1] === 'delivery' && parts[2] === 'bindings') {
    json(unbindDelivery(store, sourceHarness(parts[3]), requiredString(parts[4], 'sessionId'), watcherHarnesses));
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/delivery/turns') {
    const delivery = prepareDelivery(store, await body());
    const result = 'result' in delivery ? delivery.result : store.recordEpisode(delivery.episode);
    json(result, result.status === 'recorded' ? 201 : 200);
    return true;
  }
  return false;
}
