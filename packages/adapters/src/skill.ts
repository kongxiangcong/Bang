import { basename } from 'node:path';
import { BangError } from '../../core/src/store.ts';

type ServiceCall = <Result = Record<string, unknown>>(path: string, method?: string, body?: unknown) => Promise<Result>;

type Topic = { id: string; slug: string; title: string };
type Topics = { topics: Topic[]; activeTopicId: string | null };
type Binding = { sessionId: string; topicId: string; enabled: boolean };
type BindingOptions = {
  sessionId: string;
  transcript?: string;
  turnId?: string;
  includeActive: boolean;
};

async function initialTopic(call: ServiceCall, project: string): Promise<Topic> {
  const title = basename(project).trim() || 'Bang';
  try {
    return await call('/api/topics', 'POST', { name: title });
  } catch (error) {
    if (!(error instanceof BangError) || error.code !== 'invalid_slug') throw error;
    return call('/api/topics', 'POST', { slug: 'topic', title });
  }
}

async function startTopic(call: ServiceCall, project: string) {
  const list = () => call<Topics>('/api/topics');
  const { topics, activeTopicId } = await list();
  const active = topics.find(({ id }) => id === activeTopicId);
  if (active) return active;
  if (topics.length) throw new BangError('no_active_topic', '项目没有活跃专题。');
  try {
    return await initialTopic(call, project);
  } catch (error) {
    if (!(error instanceof BangError) || error.code !== 'topic_exists') throw error;
    const refreshed = await list();
    const selected = refreshed.topics.find(({ id }) => id === refreshed.activeTopicId);
    if (!selected) throw error;
    return selected;
  }
}

async function reasoningConfiguration(call: ServiceCall) {
  try {
    const { status } = await call<{ status: 'configured' | 'unconfigured' | 'invalid' }>('/api/reasoning/configuration');
    return status;
  } catch (error) {
    if (error instanceof BangError && error.code === 'not_found') return 'unknown';
    throw error;
  }
}

export async function startSkill(call: ServiceCall, project: string, options: BindingOptions) {
  const topic = await startTopic(call, project);
  const model = await reasoningConfiguration(call);
  const binding = await call<Binding & { status: string }>('/api/codex/bindings', 'POST', { ...options, topicId: topic.id });
  if (binding.status !== 'bound' || !binding.enabled) {
    throw new BangError('capture_not_ready', 'Codex 会话采集尚未生效。');
  }
  const { bindings } = await call<{ bindings: Binding[] }>('/api/codex/bindings');
  const sessions = bindings.filter(({ topicId, enabled }) => enabled && topicId === topic.id).map(({ sessionId }) => sessionId);
  const { url } = await call<{ url: string }>('/api/auth/exchange', 'POST', { topic: topic.id });
  const modelMessages = {
    configured: '',
    unconfigured: '整理模型尚未配置。',
    invalid: '整理模型配置无效。',
    unknown: '当前服务无法报告整理模型的配置状态。',
  };
  return { status: 'recording', topic, url, sessions, model, message: '正在自动记录。' + modelMessages[model] };
}
