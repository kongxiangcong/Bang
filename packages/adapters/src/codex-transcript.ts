import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { open, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BangError } from '../../core/src/store.ts';
import { bangOperationCall } from './codex-filter.ts';

export const chunkSize = 128 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

type JsonObject = Record<string, unknown>;
type TranscriptRow = { type?: unknown; timestamp?: unknown; payload?: JsonObject };

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

export function parseRow(line: Buffer): TranscriptRow | undefined {
  try {
    const row = object(JSON.parse(decoder.decode(line)));
    if (row) return { type: row.type, timestamp: row.timestamp, payload: object(row.payload) };
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error;
  }
}

export async function readChunk(file: FileHandle, offset: number, length = chunkSize) {
  const bytes = Buffer.allocUnsafe(Math.min(length, chunkSize));
  const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
  return bytes.subarray(0, bytesRead);
}

export function* completeLines(bytes: Buffer, start: number) {
  for (let index = 0, end = bytes.indexOf(10); end !== -1; index = end + 1, end = bytes.indexOf(10, index)) {
    yield { offset: start + index, next: start + end + 1, bytes: bytes.subarray(index, end) };
  }
}

export async function transcriptMeta(file: FileHandle, root: string, expectedId?: string) {
  const prefix = await readChunk(file, 0);
  const line = completeLines(prefix, 0).next().value;
  if (!line) return;
  const row = parseRow(line.bytes);
  const meta = row?.payload;
  if (row?.type !== 'session_meta' || typeof meta?.id !== 'string' ||
      (expectedId !== undefined && meta.id !== expectedId) ||
      (meta.session_id != null && meta.session_id !== meta.id) ||
      typeof meta.source !== 'string' || !['cli', 'vscode', 'appServer'].includes(meta.source) ||
      meta.forked_from_id || meta.parent_thread_id || meta.parent_session_id || meta.agent_nickname ||
      meta.originator === 'bang-organizer' || meta.bang_internal === true ||
      typeof meta.cwd !== 'string' || await realpath(meta.cwd).catch(() => undefined) !== root) return;
  return {
    id: meta.id,
    offset: line.next,
    signature: createHash('sha256').update(line.bytes).digest('hex'),
    startedAt: timestamp(meta.timestamp ?? row.timestamp),
  };
}

export function sessionsDirectory() {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
}

export async function* sessionFiles(directory: string): AsyncGenerator<{ name: string; path: string }> {
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) yield* sessionFiles(path);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) yield { name: entry.name, path };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function locateTranscript(id: string, supplied?: string) {
  let path = supplied;
  if (!path) {
    const matches = [];
    for await (const candidate of sessionFiles(sessionsDirectory())) {
      if (candidate.name.endsWith(`-${id}.jsonl`) || candidate.name === `${id}.jsonl`) {
        matches.push(candidate.path);
      }
    }
    if (matches.length !== 1) {
      throw new BangError('codex_transcript_not_found', 'Expected one local Codex transcript for this session', 404);
    }
    path = matches[0];
  }
  return realpath(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new BangError('codex_transcript_not_found', 'Codex transcript does not exist', 404);
  });
}

function timestamp(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return;
  return new Date(value).toISOString();
}

export async function bindingBoundary(file: FileHandle, firstOffset: number) {
  const { size } = await file.stat();
  let lineOffset = firstOffset;
  let active: { id: string; offset: number; at?: string } | undefined;
  let pending: Buffer = Buffer.alloc(0);
  for (let offset = firstOffset; offset < size;) {
    const chunk = await readChunk(file, offset, size - offset);
    if (chunk.length === 0) break;
    const bytes = Buffer.concat([pending, chunk]);
    for (const line of completeLines(bytes, lineOffset)) {
      lineOffset = line.next;
      const row = parseRow(line.bytes);
      const entry = row?.payload;
      if (row?.type !== 'event_msg' || typeof entry?.turn_id !== 'string') continue;
      if (entry.type === 'task_started') {
        active = { id: entry.turn_id, offset: line.offset, at: timestamp(row.timestamp) };
      }
      if ((entry.type === 'task_complete' || entry.type === 'turn_aborted') && active?.id === entry.turn_id) {
        active = undefined;
      }
    }
    offset += chunk.length;
    pending = bytes.subarray(bytes.length - (offset - lineOffset));
  }
  return { active, lineOffset };
}

export type ActiveTurn = {
  id: string;
  at: string;
  users: string[];
  eventUsers: string[];
  bangOperation?: boolean;
  final?: string;
  finalAt?: string;
};

function messageText(entry: JsonObject, type: string, accept: (index: number) => boolean) {
  if (!Array.isArray(entry.content)) return '';
  return entry.content.flatMap((part, index) => {
    const content = object(part);
    return content?.type === type && typeof content.text === 'string' && accept(index) ? [content.text] : [];
  }).join('\n');
}

export function consumeRow(active: ActiveTurn | undefined, row: TranscriptRow | undefined): {
  active?: ActiveTurn;
  complete?: { id: string; at: string; user: string; assistant: string; assistantAt: string; bangOperation?: boolean };
  ended?: string;
} {
  const entry = row?.payload;
  const at = timestamp(row?.timestamp);
  if (!entry || !at) return { active };

  if (row.type === 'event_msg' && entry.type === 'task_started' && typeof entry.turn_id === 'string') {
    return { active: { id: entry.turn_id, at, users: [], eventUsers: [] } };
  }
  if (!active) return {};
  if (row.type === 'response_item' && bangOperationCall(entry)) active.bangOperation = true;
  if (row.type === 'response_item' && entry.type === 'message' && entry.role === 'user') {
    const metadata = object(entry.internal_chat_message_metadata_passthrough);
    const items = metadata?.content_item_metadata;
    if (metadata?.turn_id === active.id && Array.isArray(items)) {
      const user = messageText(entry, 'input_text', (index) =>
        object(object(items[index])?.provenance)?.type === 'user');
      if (user) active.users.push(user);
    }
  }
  if (row.type === 'event_msg' && entry.type === 'user_message' && typeof entry.message === 'string') {
    active.eventUsers.push(entry.message);
  }
  if (entry.phase === 'final_answer') {
    let final = '';
    if (row.type === 'response_item' && entry.type === 'message' && entry.role === 'assistant') {
      final = messageText(entry, 'output_text', () => true);
    }
    if (row.type === 'event_msg' && entry.type === 'agent_message' && typeof entry.message === 'string') {
      final = entry.message;
    }
    if (final) {
      active.final = final;
      active.finalAt = at;
    }
  }
  if (row.type !== 'event_msg' || entry.turn_id !== active.id) return { active };
  if (entry.type === 'turn_aborted') return { ended: active.id };
  if (entry.type !== 'task_complete') return { active };
  const user = (active.users.length ? active.users : active.eventUsers).join('\n\n');
  if (!user.trim() || !active.final?.trim() ||
      (typeof entry.last_agent_message === 'string' && entry.last_agent_message !== active.final)) {
    return { ended: active.id };
  }
  return {
    ended: active.id,
    complete: { id: active.id, at: active.at, user, assistant: active.final, assistantAt: active.finalAt ?? at,
      bangOperation: active.bangOperation },
  };
}

export async function openTranscript(path: string) {
  const file = await open(path, 'r');
  try {
    if (!(await file.stat()).isFile()) {
      throw new BangError('codex_transcript_not_found', 'Codex transcript is not a regular file', 404);
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
