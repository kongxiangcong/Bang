import { sourceHarness } from '../../core/src/delivery.ts';
import { BangError, requiredString } from '../../core/src/store.ts';

export type ServiceCall = <Result = Record<string, unknown>>(path: string, method?: string, body?: unknown) => Promise<Result>;
type Binding = { sourceTool: string; sessionId: string; topicId: string; enabled: boolean; bindingId?: string };

export function hostBinding(input: { harness?: unknown; sessionId?: unknown; transcript?: string; turnId?: string }) {
  const harness = sourceHarness(input.harness ?? process.env.BANG_HARNESS ?? 'codex');
  if (harness !== 'codex') {
    const sessionId = requiredString(input.sessionId ?? process.env.BANG_SESSION_ID, 'Provide the host session ID');
    return { harness, sessionId };
  }
  const hostSession = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
  const sessionId = requiredString(input.sessionId ?? (hostSession || undefined), 'Provide the Codex session ID');
  const includeActive = sessionId === hostSession;
  const transcript = (input.transcript ?? (includeActive && process.env.CODEX_TRANSCRIPT_PATH)) || undefined;
  const turnId = (input.turnId ?? (includeActive && process.env.CODEX_TURN_ID)) || undefined;
  return { harness, sessionId, includeActive, transcript, turnId };
}

export type HostBinding = ReturnType<typeof hostBinding>;

export function bindHost(call: ServiceCall, binding: HostBinding, topicId: string) {
  const endpoint = binding.harness === 'codex' ? '/api/codex/bindings' : '/api/delivery/bindings';
  return call<{ status: string; enabled: boolean; bindingId?: string }>(endpoint, 'POST', { ...binding, topicId });
}

export function unbindHost(call: ServiceCall, { harness, sessionId }: HostBinding) {
  const session = encodeURIComponent(sessionId);
  const endpoint = harness === 'codex' ? `/api/codex/bindings/${session}`
    : `/api/delivery/bindings/${encodeURIComponent(harness)}/${session}`;
  return call(endpoint, 'DELETE');
}

export async function captureBindings(call: ServiceCall): Promise<Binding[]> {
  try {
    return (await call<{ bindings: Binding[] }>('/api/bindings')).bindings;
  } catch (error) {
    if (!(error instanceof BangError) || error.code !== 'not_found') throw error;
    const { bindings } = await call<{ bindings: Omit<Binding, 'sourceTool'>[] }>('/api/codex/bindings');
    return bindings.map((binding) => ({ ...binding, sourceTool: 'codex' }));
  }
}
