import type { RouteContext } from '../server.ts';
import { requiredString } from '../store.ts';
import { currentBoard, inspectBoard, readBoard, revisions } from './board.ts';
import type { ReasoningEngine } from './engine.ts';

export async function routeReasoning(engine: ReasoningEngine, context: RouteContext) {
  const { parts, store, request, url, body, json } = context;
  const [api, topics, topicId, action] = parts;
  if (api !== 'api' || topics !== 'topics' || parts.length !== 4) return false;
  if (request.method === 'GET' && (action === 'board' || action === 'inspect')) {
    const topic = store.findTopic(topicId);
    const board = currentBoard(store, readBoard(store, topic.id));
    const query = url.searchParams.get('query');
    const includeSuperseded = url.searchParams.get('include_superseded') === 'true';
    const projection = action === 'inspect' || query !== null
      ? inspectBoard(board, query ?? undefined, includeSuperseded)
      : board;
    return respond({ topic, ...projection, jobs: engine.jobs(topic.id) });
  }
  if (request.method === 'GET' && action === 'jobs') {
    const topic = store.findTopic(topicId);
    return respond({ topicId: topic.id, jobs: engine.jobs(topic.id) });
  }
  if (request.method === 'GET' && action === 'revisions') {
    const topic = store.findTopic(topicId);
    return respond({ topicId: topic.id, revisions: revisions(store, topic.id) });
  }
  if (request.method === 'POST' && action === 'sync') {
    const topic = store.findTopic(topicId);
    const input = await body();
    const session = input.sessionId === undefined ? undefined : requiredString(input.sessionId, 'sessionId');
    return respond(await engine.sync(topic, session));
  }
  if (request.method === 'POST' && action === 'export') {
    return respond(engine.export(store.findTopic(topicId)));
  }
  return false;

  function respond(value: unknown) {
    json(value);
    return true;
  }
}
