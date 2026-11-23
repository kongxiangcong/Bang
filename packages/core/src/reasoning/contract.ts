import { BangError } from '../store.ts';

type Schema = {
  type?: 'object' | 'string' | 'array' | 'null';
  enum?: readonly string[];
  anyOf?: readonly Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  items?: Schema;
};

const string = { type: 'string' } as const;
const array = (items: Schema): Schema => ({ type: 'array', items });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const oneOf = (values: readonly string[]): Schema => ({ type: 'string', enum: values });
const object = (properties: Record<string, Schema>): Schema => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

export const kinds = ['concept', 'claim', 'question', 'evidence'] as const;
const tags = {
  concept: ['concept', 'principle', 'option', 'artifact'],
  claim: ['hypothesis', 'decision', 'finding'],
  question: ['open_question', 'design_issue'],
  evidence: ['derivation', 'experiment', 'counterexample', 'code_ref'],
} as const;
export const skeletons = [
  'about', 'answers', 'part_of', 'depends_on', 'leads_to', 'supports', 'refutes', 'qualifies', 'supersedes',
] as const;
export const masteries = ['unfamiliar', 'exploring', 'self_reported', 'verified', 'shaky'] as const;
export const stances = ['neutral', 'endorsed', 'skeptical', 'rejected'] as const;
const provenances = ['EXTRACTED', 'INFERRED'] as const;
const layoutHints = ['auto', 'hierarchy', 'flow', 'radial', 'comparison', 'free'] as const;

export type Sources = { source_episodes: string[] };
export type Episode = ReturnType<import('../store.ts').BangStore['getEpisode']>;
type Tag = typeof tags[keyof typeof tags][number];
export type Landmark = Sources & {
  id: string;
  kind: typeof kinds[number];
  tag: Tag | null;
  title: string;
  detail: string;
  conditions: string[];
  event_time: string | null;
};
export type Relationship = Sources & {
  id: string;
  from: string;
  to: string;
  skeleton: typeof skeletons[number];
  predicate: string;
  provenance: typeof provenances[number];
};
export type Mastery = typeof masteries[number];
export type Stance = typeof stances[number];
export type EpistemicHint = Sources & {
  node_id: string;
  mastery: Mastery | null;
  stance: Stance | null;
  quote: { episode_id: string; text: string } | null;
  belief_shift: { previous_belief: string; correction: string; trigger_episode_id: string } | null;
};
export type Cluster = {
  id: string;
  title: string;
  node_ids: string[];
  layout_hint: typeof layoutHints[number] | null;
};
export type SessionDelta = {
  landmarks: Landmark[];
  remove_landmarks: string[];
  relationships: Relationship[];
  remove_relationships: string[];
  epistemic_hints: EpistemicHint[];
};
export type SessionGraph = Pick<SessionDelta, 'landmarks' | 'relationships' | 'epistemic_hints'>;

export type Operation =
  | { op: 'ADD_NODE'; node: Landmark }
  | { op: 'ADD_EDGE'; edge: Relationship }
  | ({ op: 'SUPPLEMENT'; node_id: string; detail: string | null; evidence_id: string | null } & Sources)
  | { op: 'UPDATE_EDGE'; edge: Relationship }
  | { op: 'QUALIFY'; edge: Relationship; conditions: string[] }
  | { op: 'SUPERSEDE'; edge: Relationship; replacement: Landmark }
  | { op: 'CONTEST'; edge: Relationship; question_id: string }
  | { op: 'RESOLVE_QUESTION'; edge: Relationship }
  | { op: 'SHIFT_EPISTEMIC'; state: EpistemicHint }
  | ({ op: 'MANAGE_CLUSTER'; cluster: Cluster } & Sources);
export type Merge = { summary: string; operations: Operation[] };

const strings = array(string);
const sources = { source_episodes: strings };
const landmark = {
  anyOf: kinds.map((kind) => object({
    id: string, kind: oneOf([kind]), tag: nullable(oneOf(tags[kind])),
    title: string, detail: string, conditions: strings, event_time: nullable(string),
    ...sources,
  })),
};
const relationship = object({
  id: string, from: string, to: string, skeleton: oneOf(skeletons), predicate: string,
  provenance: oneOf(provenances), ...sources,
});
const hint = object({
  node_id: string, mastery: nullable(oneOf(masteries)), stance: nullable(oneOf(stances)),
  quote: nullable(object({ episode_id: string, text: string })),
  belief_shift: nullable(object({ previous_belief: string, correction: string, trigger_episode_id: string })),
  ...sources,
});
const cluster = object({
  id: string, title: string, node_ids: strings, layout_hint: nullable(oneOf(layoutHints)),
});
const operationFields = {
  ADD_NODE: { node: landmark },
  ADD_EDGE: { edge: relationship },
  SUPPLEMENT: { node_id: string, detail: nullable(string), evidence_id: nullable(string), ...sources },
  UPDATE_EDGE: { edge: relationship },
  QUALIFY: { edge: relationship, conditions: strings },
  SUPERSEDE: { edge: relationship, replacement: landmark },
  CONTEST: { edge: relationship, question_id: string },
  RESOLVE_QUESTION: { edge: relationship },
  SHIFT_EPISTEMIC: { state: hint },
  MANAGE_CLUSTER: { cluster, ...sources },
} satisfies Record<Operation['op'], Record<string, Schema>>;

export const pass1Schema = object({
  landmarks: array(landmark), remove_landmarks: strings,
  relationships: array(relationship), remove_relationships: strings, epistemic_hints: array(hint),
});
export const pass2Schema = object({
  summary: string,
  operations: array({
    anyOf: Object.entries(operationFields).map(([op, fields]) => object({ op: oneOf([op]), ...fields })),
  }),
});

function matches(value: unknown, schema: Schema): boolean {
  if (schema.anyOf) return schema.anyOf.some((option) => matches(value, option));
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') {
    return typeof value === 'string' && value.trim().length > 0 && (!schema.enum || schema.enum.includes(value));
  }
  if (schema.type === 'array') return Array.isArray(value) && value.every((item) => matches(item, schema.items!));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === schema.required!.length &&
    Object.entries(schema.properties!).every(([key, property]) => Object.hasOwn(record, key) && matches(record[key], property));
}

export function invalidOutput(message: string): never {
  throw new BangError('invalid_model_output', message, 422);
}

export function parseDelta(value: unknown): SessionDelta {
  if (!matches(value, pass1Schema)) invalidOutput('Pass 1 returned an invalid session delta');
  return value as SessionDelta;
}

export function parseMerge(value: unknown): Merge {
  if (!matches(value, pass2Schema)) invalidOutput('Pass 2 returned invalid merge operations');
  return value as Merge;
}

export function safeId(id: string) {
  if (!/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}_.:-]{0,99}$/u.test(id)) {
    invalidOutput('Model returned an invalid landmark, edge or cluster identifier');
  }
}

export function validateLandmark(node: Landmark) {
  safeId(node.id);
  const allowedTags: readonly string[] = tags[node.kind];
  if (node.tag && !allowedTags.includes(node.tag)) invalidOutput('Landmark tag does not match its kind');
}

export function validateSources(item: Sources, allowed: ReadonlyMap<string, Episode>) {
  if (!item.source_episodes.length || item.source_episodes.some((id) => !allowed.has(id))) {
    invalidOutput('Source must reference an available, current Episode in the provided context');
  }
}

function demonstratesMastery(quote: string) {
  const selfReport = /^(?:(?:因为|所以)\s*)?(?:我[^，,。.!?！？]{0,20}(?:理解|明白|懂|掌握|学会)|(?:我)?(?:理解|明白|懂|掌握|学会)(?:了|啦)|(?:because\s+|so\s+)?i\s+(?:(?:now|finally|fully|completely|already|think|can|do|really)\s+)*(?:understand|get it|got it|see why|learned|mastered)|谢谢|感谢|thanks\b|thank you\b)/iu;
  const question = /[?？]\s*$/u;
  const evidence = /[\p{Letter}\p{Number}]\s*(?:=|≈|⇒|→)\s*(?:[\p{Letter}\p{Number}[(]|-\d)|\b(?:because|therefore|thus|if|when|measured|observed|returns|outputs)\b|(?:因为|所以|因此|由于|当.+时|意味着|导致|推出|得到|测得|观察到|输出)/iu;
  return quote.split(/(?<=[。.!?！？；;\n])/u).some((sentence) => {
    if (question.test(sentence)) return false;
    const clauses = sentence.split(/[，,：:]/u).map((clause) => clause.trim());
    return clauses.some((clause) => clause.length >= 10 && !selfReport.test(clause) && evidence.test(clause));
  });
}

export function validateHint(hint: EpistemicHint, allowed: ReadonlyMap<string, Episode>) {
  validateSources(hint, allowed);
  if (hint.quote) {
    const { episode_id, text } = hint.quote;
    if (!hint.source_episodes.includes(episode_id) ||
        !allowed.get(episode_id)?.messages[0].content.includes(text)) {
      invalidOutput('Mastery evidence must quote the user verbatim from a cited Episode');
    }
  }
  if (hint.mastery === 'self_reported' && !hint.quote) {
    invalidOutput('Self-reported mastery requires an exact user quote');
  }
  if (hint.mastery === 'verified' && !demonstratesMastery(hint.quote?.text ?? '')) {
    invalidOutput('Verified mastery requires a demonstrated explanation, derivation or experiment from the user');
  }
  if (hint.belief_shift && !hint.source_episodes.includes(hint.belief_shift.trigger_episode_id)) {
    invalidOutput('Belief shift trigger must reference an Episode cited by the shift');
  }
}
