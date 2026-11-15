import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {createCompanionView} from '../../runtime/companion/whiteboard.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function parseConversation(markdown) {
  const lines = markdown.split(/\r?\n/);
  const starts = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\\?##\s+(You|ChatGPT)\s*[·•]/);
    if (match) starts.push({ index, role: match[1] === 'You' ? 'user' : 'assistant' });
  });
  let round = 0;
  return starts.map((start, index) => {
    if (start.role === 'user') round++;
    const end = starts[index + 1]?.index ?? lines.length;
    return {
      id: `m${String(index + 1).padStart(3, '0')}`,
      role: start.role,
      round,
      text: lines.slice(start.index + 1, end).join('\n').trim(),
      startLine: start.index + 1,
      endLine: end,
    };
  });
}

export function graphFromEvents(events) {
  const groups = new Map(), nodes = new Map(), relations = new Map();
  for (const { changes = {} } of events) {
    for (const value of changes.upsertGroups ?? []) groups.set(value.id, value);
    for (const value of changes.upsertNodes ?? []) nodes.set(value.id, value);
    for (const value of changes.upsertRelations ?? []) relations.set(value.id, value);
    for (const id of changes.removeNodeIds ?? []) nodes.delete(id);
    for (const id of changes.removeRelationIds ?? []) relations.delete(id);
  }
  return { groups: [...groups.values()], nodes: [...nodes.values()], relations: [...relations.values()] };
}

function validateEvent(input, previousEvents, messages) {
  if (!input?.id || !input.goal || !input.changes) throw Error('event 需要 id、goal 和 changes');
  const event = structuredClone(input);
  const changes = event.changes;
  for (const key of ['upsertGroups', 'upsertNodes', 'upsertRelations', 'removeNodeIds', 'removeRelationIds']) {
    changes[key] ??= [];
    if (!Array.isArray(changes[key])) throw Error(`${key} 必须是数组`);
  }
  const messageMap = new Map(messages.map(message => [message.id, message]));
  for (const group of changes.upsertGroups) {
    if (!group.id || !group.title || !group.goal || !['loose', 'hierarchy', 'radial', 'sequence'].includes(group.relation)) {
      throw Error('group 需要 id、title、goal 和合法 relation');
    }
  }
  for (const node of changes.upsertNodes) {
    if (!node.id || !node.groupId || typeof node.text !== 'string' || typeof node.explanation !== 'string' || !node.sources?.length) {
      throw Error('node 需要 id、groupId、text、explanation 和 sources');
    }
    node.sources = node.sources.map(source => {
      const message = messageMap.get(source.messageId);
      if (!message) throw Error(`来源 ${source.messageId} 尚未进入讨论`);
      const startLine = source.startLine ?? message.startLine;
      const endLine = source.endLine ?? message.endLine;
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < message.startLine || endLine > message.endLine || startLine > endLine) {
        throw Error(`来源 ${source.messageId} 的行号超出消息范围 ${message.startLine}–${message.endLine}`);
      }
      return { ...source, startLine, endLine };
    });
  }
  const graph = graphFromEvents([...previousEvents, event]);
  const groupIds = new Set(graph.groups.map(group => group.id));
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  if (graph.nodes.some(node => !groupIds.has(node.groupId))) throw Error('节点引用了不存在的 group');
  if (graph.relations.some(relation => !relation.id || !nodeIds.has(relation.from) || !nodeIds.has(relation.to))) {
    throw Error('关系端点不存在；删除节点时一并删除关联关系');
  }
  return event;
}

export function createBangStore({ projectRoot = defaultRoot } = {}) {
  const directory = path.join(projectRoot, '.bang');
  const sessionPath = path.join(directory, 'sessions', 'pim.json');
  const plansPath = path.join(directory, 'fixtures', 'pim-plans.json');
  let sequence = Promise.resolve();
  async function write(session) {
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(`${sessionPath}.tmp`, JSON.stringify(session, null, 2));
    await fs.rename(`${sessionPath}.tmp`, sessionPath);
    return session;
  }
  async function fresh(options = {}) {
    const messages = options.mode === 'empty' ? [] : parseConversation(await fs.readFile(path.join(projectRoot, 'PIM架构探索讨论.md'), 'utf8'));
    return {
      schema: 1,
      id: options.id ?? (options.mode === 'empty' ? 'discussion' : 'pim'),
      generation: crypto.randomUUID(),
      mode: options.mode === 'empty' ? 'empty' : 'replay',
      messages,
      replayMessageCount: messages.length,
      visibleCount: 0,
      roundsPerUpdate: options.roundsPerUpdate ?? 2,
      events: [],
      scene: null,
    };
  }
  async function read() {
    try { return JSON.parse(await fs.readFile(sessionPath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      let session;
      try { session = await fresh(); }
      catch (missing) {
        if (missing.code !== 'ENOENT') throw missing;
        session = await fresh({ mode: 'empty' });
      }
      return write(session);
    }
  }
  function transact(operation) {
    const result = sequence.then(async () => operation(await read()));
    sequence = result.catch(() => {});
    return result;
  }
  return {
    path: sessionPath,
    read: () => transact(session => session),
    reset: (options = {}) => transact(async () => {
      if (options.roundsPerUpdate !== undefined && (!Number.isInteger(options.roundsPerUpdate) || options.roundsPerUpdate < 1)) throw Error('roundsPerUpdate 必须是正整数');
      return write(await fresh(options));
    }),
    next: () => transact(async session => {
      if (session.visibleCount >= session.replayMessageCount) return session;
      session.visibleCount++;
      const message = session.messages[session.visibleCount - 1];
      const finished = session.visibleCount === session.replayMessageCount;
      if (message.role === 'assistant' && (message.round % session.roundsPerUpdate === 0 || finished)) {
        const plans = JSON.parse(await fs.readFile(plansPath, 'utf8'));
        const events = Array.isArray(plans) ? plans : plans.events;
        for (const input of events.filter(event => event.throughRound <= message.round)) {
          if (session.events.some(event => event.id === input.id)) continue;
          const event = validateEvent(input, session.events, session.messages.slice(0, session.visibleCount));
          session.events.push(event);
        }
      }
      return write(session);
    }),
    saveScene: (snapshot) => transact(async session => {
      if (snapshot.generation !== session.generation) return { stale: true, generation: session.generation };
      if (!Array.isArray(snapshot.elements) || !Array.isArray(snapshot.appliedEventIds)) throw Error('scene 需要 elements 和 appliedEventIds');
      const { generation, ...scene } = snapshot;
      session.scene = scene;
      return write(session);
    }),
    submit: (payload) => transact(async session => {
      if (session.events.some(event => event.id === payload.event?.id)) return { ...session, duplicate: true };
      if (session.visibleCount < session.replayMessageCount) throw Error('先完成原文回放，或 reset --empty 后开始新的讨论');
      let nextLine = Math.max(0, ...session.messages.map(message => message.endLine)) + 1;
      let round = Math.max(0, ...session.messages.map(message => message.round));
      const used = new Set(session.messages.map(message => message.id));
      for (const incoming of payload.messages ?? []) {
        if (!['user', 'assistant'].includes(incoming.role) || typeof incoming.text !== 'string') throw Error('message 需要 role 和 text');
        const id = incoming.id ?? `m${String(session.messages.length + 1).padStart(3, '0')}`;
        if (used.has(id)) throw Error(`消息 id 重复：${id}`);
        used.add(id);
        if (incoming.role === 'user') round++;
        const startLine = nextLine;
        const endLine = startLine + incoming.text.split(/\r?\n/).length - 1;
        session.messages.push({ id, role: incoming.role, text: incoming.text, round: Math.max(1, round), startLine, endLine });
        nextLine = endLine + 1;
      }
      session.visibleCount = session.messages.length;
      const input = { ...payload.event, throughRound: payload.event?.throughRound ?? round };
      const event = validateEvent(input, session.events, session.messages);
      session.events.push(event);
      return write(session);
    }),
  };
}

export function createBangMiddleware(options) {
  const store = createBangStore(options);
  const views=new Map();
  return async (request, response, next) => {
    const url=new URL(request.url, 'http://localhost');
    const route = url.pathname;
    if (!route.startsWith('/api/bang/')) return next();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const topic=url.searchParams.get('topic');
      let view;
      if(topic){if(!views.has(topic))views.set(topic,createCompanionView({projectRoot:options?.projectRoot??defaultRoot,topic}));view=views.get(topic)}
      if (request.method === 'GET' && route === '/api/bang/session') {
        response.end(JSON.stringify(await (view??store).read()));
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};
      if (request.method !== 'POST') { response.statusCode = 405; response.end(JSON.stringify({ error: 'Method not allowed' })); return; }
      const actions = {
        '/api/bang/next': () => store.next(),
        '/api/bang/reset': () => store.reset(body),
        '/api/bang/scene': () => (view??store).saveScene(body),
        '/api/bang/submit': () => store.submit(body),
      };
      if(view&&route!=='/api/bang/scene')throw Error('后台专题不支持重播或手动提交');
      if (!actions[route]) { response.statusCode = 404; response.end(JSON.stringify({ error: 'Unknown Bang route' })); return; }
      response.end(JSON.stringify(await actions[route]()));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: error.message }));
    }
  };
}
