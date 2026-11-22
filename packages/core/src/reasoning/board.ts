import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BangError } from '../store.ts';
import type { BangStore } from '../store.ts';
import {
  invalidOutput, safeId, validateHint, validateLandmark, validateSources,
} from './contract.ts';
import type {
  Cluster, Episode, EpistemicHint, Landmark, Merge, Relationship, SessionGraph, Sources,
} from './contract.ts';

type Timestamps = { asserted_at: string; recorded_at: string; invalidated_at?: string };
export type KnowledgeNode = Omit<Landmark, 'tag' | 'event_time'> & Timestamps & {
  tag?: NonNullable<Landmark['tag']>;
  event_time?: string;
  status: 'active' | 'qualified' | 'disputed' | 'superseded' | 'resolved';
  superseded_at?: string;
};
export type KnowledgeEdge = Relationship & Timestamps & { human_locked?: boolean };
export type Knowledge = { topic_id: string; nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; clusters: Cluster[] };
export type BeliefShift = NonNullable<EpistemicHint['belief_shift']> & {
  id: string; shifted_at: string; recorded_at: string;
};
export type EpistemicState = {
  node_id: string;
  mastery?: NonNullable<EpistemicHint['mastery']>;
  stance?: NonNullable<EpistemicHint['stance']>;
  mastery_source_episode_id?: string;
  source_episodes: string[];
  human_locked_fields: ('title' | 'detail' | 'conditions')[];
  belief_history: BeliefShift[];
  updated_at: string;
};
export type Epistemic = { topic_id: string; nodes: EpistemicState[] };
export type Board = {
  revision: number;
  knowledge: Knowledge;
  epistemic: Epistemic;
  layout: { topic_id: string; nodes: Record<string, unknown> };
};
type RevisionRow = { revision: number; knowledge_json: string; epistemic_json: string };

export function readBoard(store: BangStore, topicId: string): Board {
  const row = store.db.prepare(`
    SELECT revision, knowledge_json, epistemic_json FROM topic_revisions
    WHERE topic_id = ? ORDER BY revision DESC LIMIT 1
  `).get(topicId) as RevisionRow | undefined;
  const layout = store.db.prepare('SELECT layout_json FROM topic_layouts WHERE topic_id = ?')
    .get(topicId) as { layout_json: string } | undefined;
  return {
    revision: row?.revision ?? 0,
    knowledge: row ? JSON.parse(row.knowledge_json) as Knowledge : {
      topic_id: topicId, nodes: [], edges: [], clusters: [],
    },
    epistemic: row ? JSON.parse(row.epistemic_json) as Epistemic : { topic_id: topicId, nodes: [] },
    layout: layout ? JSON.parse(layout.layout_json) as Board['layout'] : { topic_id: topicId, nodes: {} },
  };
}

export function publishBoard(directory: string, slug: string, board: Board) {
  const target = join(directory, 'topics', slug);
  const files = ['knowledge.json', 'epistemic.json', 'layout.json'] as const;
  const states = [board.knowledge, board.epistemic, board.layout];
  mkdirSync(target, { recursive: true });
  for (let index = 0; index < files.length; index += 1) {
    const filename = join(target, files[index]);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ ...states[index], revision: board.revision }, null, 2) + '\n', { flag: 'wx' });
      renameSync(temporary, filename);
    } finally {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  return { revision: board.revision, directory: target, files };
}

export function saveRevision(store: BangStore, board: Board, jobId: string, summary: string, createdAt: string) {
  store.db.prepare(`
    INSERT INTO topic_revisions (
      topic_id, revision, trigger_job_id, author, summary, knowledge_json, epistemic_json, created_at
    ) VALUES (?, ?, ?, 'engine', ?, ?, ?, ?)
  `).run(board.knowledge.topic_id, board.revision, jobId, summary,
    JSON.stringify(board.knowledge), JSON.stringify(board.epistemic), createdAt);
}

export function revisions(store: BangStore, topicId: string) {
  return store.db.prepare(`
    SELECT revision, author, summary, created_at FROM topic_revisions WHERE topic_id = ? ORDER BY revision
  `).all(topicId);
}

export function union<T>(left: T[], right: T[]) {
  return [...new Set([...left, ...right])];
}

function discussionTime(ids: string[], allowed: ReadonlyMap<string, Episode>, last = false) {
  const episodes = ids.map((id) => allowed.get(id)!);
  episodes.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.ingestIndex - b.ingestIndex);
  return last ? episodes.at(-1)!.occurredAt : episodes[0].occurredAt;
}

export function validateRelationship(edge: Relationship, from: Landmark['kind'], to: Landmark['kind']) {
  safeId(edge.id);
  if (edge.from === edge.to && edge.skeleton !== 'leads_to') invalidOutput('A relationship requires distinct endpoints');
  const assertion = from === 'claim' || from === 'evidence';
  switch (edge.skeleton) {
    case 'about':
      if (to !== 'concept' || from === 'concept') invalidOutput('About relationships point to a concept');
      break;
    case 'answers':
      if (!assertion || to !== 'question') invalidOutput('An answer must connect a claim or evidence to a question');
      break;
    case 'part_of':
      if (to !== 'concept') invalidOutput('A classification relationship must point to a concept');
      break;
    case 'supports':
    case 'refutes':
    case 'qualifies':
      if (!assertion || to !== 'claim') invalidOutput('The relationship must connect a claim or evidence to a claim');
      break;
    case 'supersedes':
      if (from !== 'claim' || to !== 'claim') invalidOutput('A replacement must connect two claims');
  }
}

function generatedEdgeId(from: string, skeleton: string, to: string) {
  return 'edge-' + createHash('sha256').update(JSON.stringify([from, skeleton, to])).digest('hex');
}

export function applyMerge(base: Board, merge: Merge, allowed: ReadonlyMap<string, Episode>, now: string) {
  const board = structuredClone(base);
  const { knowledge, epistemic } = board;
  const nodes = new Map(knowledge.nodes.map((node) => [node.id, node]));
  const edges = new Map(knowledge.edges.map((edge) => [edge.id, edge]));
  const states = new Map(epistemic.nodes.map((state) => [state.node_id, state]));
  const clusters = new Map(knowledge.clusters.map((cluster) => [cluster.id, cluster]));

  function node(id: string) {
    const found = nodes.get(id);
    if (!found) invalidOutput('Operation references an unknown landmark');
    return found;
  }
  function timestamps(item: Sources) {
    validateSources(item, allowed);
    return { asserted_at: discussionTime(item.source_episodes, allowed), recorded_at: now };
  }
  function addNode(draft: Landmark) {
    validateLandmark(draft);
    if (nodes.has(draft.id)) invalidOutput('ADD_NODE references an existing landmark');
    const { tag, event_time, ...fields } = draft;
    const next: KnowledgeNode = { ...fields, ...timestamps(draft), status: 'active' };
    if (tag) next.tag = tag;
    if (event_time) next.event_time = event_time;
    nodes.set(next.id, next);
  }
  function writeEdge(draft: Relationship, previous?: KnowledgeEdge) {
    validateRelationship(draft, node(draft.from).kind, node(draft.to).kind);
    const times = timestamps(draft);
    if (previous?.human_locked) throw new BangError('locked_edge', 'This relationship is locked by a human', 409);
    edges.set(draft.id, {
      ...previous, ...draft,
      asserted_at: previous?.asserted_at ?? times.asserted_at,
      recorded_at: previous?.recorded_at ?? times.recorded_at,
      source_episodes: union(previous?.source_episodes ?? [], draft.source_episodes),
    });
  }
  function addEdge(draft: Relationship, skeleton = draft.skeleton) {
    if (draft.skeleton !== skeleton) invalidOutput('Relationship skeleton does not match the operation');
    if (edges.has(draft.id)) invalidOutput('ADD_EDGE references an existing relationship');
    writeEdge(draft);
  }
  function shift(hint: EpistemicHint) {
    node(hint.node_id);
    validateHint(hint, allowed);
    const current = states.get(hint.node_id);
    const state: EpistemicState = current ?? {
      node_id: hint.node_id, source_episodes: [], human_locked_fields: [], belief_history: [], updated_at: now,
    };
    const before = JSON.stringify(state);
    if (hint.mastery) {
      state.mastery = hint.mastery;
      if (hint.quote) state.mastery_source_episode_id = hint.quote.episode_id;
      else delete state.mastery_source_episode_id;
    }
    if (hint.stance) state.stance = hint.stance;
    if (hint.belief_shift) {
      const shift = hint.belief_shift;
      if (!state.belief_history.some((previous) => Object.entries(shift).every(([key, value]) =>
        previous[key as keyof typeof shift] === value))) {
        state.belief_history.push({
          ...shift, id: randomUUID(), shifted_at: discussionTime([shift.trigger_episode_id], allowed), recorded_at: now,
        });
      }
    }
    if (hint.mastery || hint.stance || hint.belief_shift) {
      state.source_episodes = union(state.source_episodes, hint.source_episodes);
      if (before !== JSON.stringify(state)) state.updated_at = now;
      states.set(state.node_id, state);
    }
  }

  for (const operation of merge.operations) {
    switch (operation.op) {
      case 'ADD_NODE':
        addNode(operation.node);
        break;
      case 'ADD_EDGE':
        addEdge(operation.edge);
        break;
      case 'UPDATE_EDGE': {
        const previous = edges.get(operation.edge.id);
        if (!previous) invalidOutput('UPDATE_EDGE references an unknown relationship');
        writeEdge(operation.edge, previous);
        break;
      }
      case 'SUPPLEMENT': {
        const target = node(operation.node_id);
        validateSources(operation, allowed);
        target.source_episodes = union(target.source_episodes, operation.source_episodes);
        if (operation.evidence_id) {
          const evidence = node(operation.evidence_id);
          if (target.kind !== 'claim' || evidence.kind !== 'evidence') invalidOutput('Evidence must support a claim');
          const id = generatedEdgeId(evidence.id, 'supports', target.id);
          const previous = edges.get(id);
          if (previous) {
            previous.source_episodes = union(previous.source_episodes, operation.source_episodes);
          } else {
            addEdge({
              id, from: evidence.id, to: target.id, skeleton: 'supports', predicate: 'supports',
              provenance: 'INFERRED', source_episodes: operation.source_episodes,
            });
          }
        }
        if (operation.detail !== null && !states.get(target.id)?.human_locked_fields.includes('detail')) {
          target.detail = operation.detail;
        }
        break;
      }
      case 'QUALIFY': {
        const target = node(operation.edge.to);
        addEdge(operation.edge, 'qualifies');
        if (target.status !== 'superseded') {
          target.status = 'qualified';
          if (!states.get(target.id)?.human_locked_fields.includes('conditions')) {
            target.conditions = union(target.conditions, operation.conditions);
          }
        }
        break;
      }
      case 'SUPERSEDE': {
        if (operation.edge.from !== operation.replacement.id) invalidOutput('Replacement must be the source of its relationship');
        addNode(operation.replacement);
        addEdge(operation.edge, 'supersedes');
        const target = node(operation.edge.to);
        target.status = 'superseded';
        target.superseded_at = discussionTime(operation.edge.source_episodes, allowed, true);
        target.invalidated_at = now;
        break;
      }
      case 'CONTEST': {
        const question = node(operation.question_id);
        if (question.kind !== 'question' || question.status !== 'active') invalidOutput('A dispute requires an open question');
        addEdge(operation.edge, 'refutes');
        const target = node(operation.edge.to);
        if (target.status !== 'superseded') target.status = 'disputed';
        addEdge({
          ...operation.edge, id: generatedEdgeId(operation.edge.id, 'leads_to', question.id),
          to: question.id, skeleton: 'leads_to',
        });
        break;
      }
      case 'RESOLVE_QUESTION':
        addEdge(operation.edge, 'answers');
        node(operation.edge.to).status = 'resolved';
        break;
      case 'SHIFT_EPISTEMIC':
        shift(operation.state);
        break;
      case 'MANAGE_CLUSTER': {
        const { cluster } = operation;
        validateSources(operation, allowed);
        safeId(cluster.id);
        const members = [...new Set(cluster.node_ids)];
        if (members.length < 2) invalidOutput('A cluster requires at least two landmarks');
        for (const member of members) node(member);
        clusters.set(cluster.id, { ...cluster, node_ids: members });
        break;
      }
    }
  }

  knowledge.nodes = [...nodes.values()];
  knowledge.edges = [...edges.values()];
  knowledge.clusters = [...clusters.values()];
  epistemic.nodes = [...states.values()];
  if (JSON.stringify(knowledge) !== JSON.stringify(base.knowledge) ||
      JSON.stringify(epistemic) !== JSON.stringify(base.epistemic)) board.revision += 1;
  return board;
}

function keywords(text: string) {
  return new Set(text.toLowerCase().match(/[\p{Script=Han}]|[\p{Letter}\p{Number}]+/gu) ?? []);
}
function relevance(text: string, query: ReadonlySet<string>) {
  return [...keywords(text)].filter((word) => query.has(word)).length;
}
function describe(node: Landmark | KnowledgeNode) {
  return [node.title, node.detail, ...node.conditions].join(' ');
}

export function contextFor(board: Board, session: SessionGraph) {
  const terms = keywords(session.landmarks.map(describe).join(' '));
  const scored = board.knowledge.nodes.map((node) => ({
    node,
    score: relevance(node.title, terms) * 3 + relevance(describe(node), terms),
  }));
  const primary = new Set(scored.filter(({ score }) => score > 0).sort((a, b) => b.score - a.score)
    .slice(0, 15).map(({ node }) => node.id));
  for (const edge of board.knowledge.edges) {
    if (primary.size >= 25) break;
    if (primary.has(edge.from) || primary.has(edge.to)) {
      primary.add(edge.from);
      primary.add(edge.to);
    }
  }
  const state = new Map(board.epistemic.nodes.map((item) => [item.node_id, item]));
  return {
    blurry: board.knowledge.nodes.map(({ id, kind, title, status }) => ({
      id, kind, title, status, mastery: state.get(id)?.mastery,
    })),
    focused: {
      nodes: board.knowledge.nodes.filter(({ id }) => primary.has(id)),
      edges: board.knowledge.edges.filter(({ from, to }) => primary.has(from) && primary.has(to)),
      epistemic: board.epistemic.nodes.filter(({ node_id }) => primary.has(node_id)),
    },
  };
}

export function inspectBoard(board: Board, query?: string, includeSuperseded = false) {
  const eligible = board.knowledge.nodes.filter((node) => includeSuperseded || node.status !== 'superseded');
  if (!query?.trim()) return board;
  const terms = keywords(query);
  const state = new Map(board.epistemic.nodes.map((item) => [item.node_id, item]));
  const matches = eligible.map((node) => ({
    id: node.id,
    score: relevance(node.title, terms) * 3 + relevance([
      describe(node), ...(state.get(node.id)?.belief_history.flatMap((shift) => [shift.previous_belief, shift.correction]) ?? []),
    ].join(' '), terms),
  })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  const ids = new Set(matches.map(({ id }) => id));
  const allEligible = new Set(eligible.map(({ id }) => id));
  const relations = board.knowledge.edges.filter(({ from, to }) =>
    (ids.has(from) || ids.has(to)) && allEligible.has(from) && allEligible.has(to));
  const related = new Set(relations.flatMap(({ from, to }) => [from, to]));
  return {
    ...board,
    matches: [...ids],
    knowledge: {
      ...board.knowledge,
      nodes: eligible.filter(({ id }) => ids.has(id) || related.has(id)),
      edges: relations,
    },
    epistemic: { ...board.epistemic, nodes: board.epistemic.nodes.filter(({ node_id }) => ids.has(node_id) || related.has(node_id)) },
  };
}
