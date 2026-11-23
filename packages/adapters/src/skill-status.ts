type ServiceCall = <Result>(path: string, method?: string, body?: unknown) => Promise<Result>;
type Topic = { id: string; slug: string; title: string; status: 'active' | 'archived' };
type CaptureBinding = { sessionId: string; topicId: string; enabled: boolean };
type Episode = { id: string; sourceTool: string; sessionId: string; turnId: string };
type Job = { status: string; episodeIds: string[]; revision: number | null };

export async function capturingBindings(call: ServiceCall) {
  const { bindings } = await call<{ bindings: CaptureBinding[] }>('/api/codex/bindings');
  return bindings.filter(({ enabled }) => enabled);
}

export async function skillStatus(call: ServiceCall) {
  const [{ topics }, bindings] = await Promise.all([
    call<{ topics: Topic[] }>('/api/topics'),
    capturingBindings(call),
  ]);
  const rows = await Promise.all(topics.map(async ({ id, slug, title, status }) => {
    const endpoint = `/api/topics/${encodeURIComponent(id)}`;
    const [{ jobs }, { url }] = await Promise.all([
      call<{ jobs: Job[] }>(`${endpoint}/jobs?latest_success=true`),
      call<{ url: string }>('/api/auth/exchange', 'POST', { topic: id }),
    ]);
    const { episodes } = await call<{ episodes: Episode[] }>(`${endpoint}/episodes`);
    const sessions = status === 'active'
      ? bindings.filter(({ topicId }) => topicId === id).map(({ sessionId }) => sessionId)
      : [];
    const turnCount = new Set(episodes.map(({ sourceTool, sessionId, turnId }) =>
      JSON.stringify([sourceTool, sessionId, turnId]))).size;
    // An older running daemon may return the entire jobs list.
    const latest = jobs.findLast(({ status }) => status === 'done');
    const through = latest && episodes.find(({ id }) => id === latest.episodeIds.at(-1));
    const latestReasoning = latest && through ? {
      sessionId: through.sessionId,
      sourceTool: through.sourceTool,
      throughEpisodeId: through.id,
      throughTurnId: through.turnId,
      revision: latest.revision,
    } : null;
    return { topic: { id, slug, title }, url, sessions, turnCount, latestReasoning };
  }));
  const message = rows.some(({ sessions }) => sessions.length)
    ? '白板服务已启动。'
    : '白板服务已启动，当前无会话正在采集。';
  return { status: 'ready', message, topics: rows };
}
