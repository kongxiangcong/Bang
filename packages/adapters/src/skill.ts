import { basename } from 'node:path';
import { BangError } from '../../core/src/store.ts';

type ServiceCall = <Result = Record<string, unknown>>(path: string, method?: string, body?: unknown) => Promise<Result>;

type Topic = { id: string; slug: string; title: string; status: 'active' | 'archived' };
type Topics = { topics: Topic[] };
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

async function startTopic(call: ServiceCall, project: string, boundTopicId?: string, selector?: string) {
  const list = () => call<Topics>('/api/topics');
  let { topics } = await list();
  if (boundTopicId !== undefined) {
    const topic = topics.find(({ id }) => id === boundTopicId);
    if (!topic) throw new BangError('topic_not_found', '当前会话绑定的专题不存在。', 404);
    return { topic };
  }

  if (!topics.length && selector === undefined) {
    try {
      return { topic: await initialTopic(call, project) };
    } catch (error) {
      if (!(error instanceof BangError) || error.code !== 'topic_exists') throw error;
      ({ topics } = await list());
    }
  }

  const active = topics.filter(({ status }) => status === 'active');
  if (selector !== undefined) {
    const identified = topics.find(({ id }) => id === selector) ?? topics.find(({ slug }) => slug === selector);
    if (identified?.status === 'archived') throw new BangError('topic_archived', '指定的专题已归档。', 409);
    if (identified) return { topic: identified };
  }
  const candidates = selector === undefined ? active : active.filter(({ title }) => title === selector);
  if (candidates.length === 1) return { topic: candidates[0] };
  if (candidates.length > 1) {
    return {
      status: 'choose_topic' as const,
      candidates,
      message: selector === undefined ? '请选择要记录的专题。' : '存在同名专题，请按专题标识选择。',
    };
  }
  if (selector !== undefined) throw new BangError('topic_not_found', `没有找到专题「${selector}」。`, 404);
  throw new BangError('no_active_topic', '项目没有活跃专题。');
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

export async function startSkill(call: ServiceCall, project: string, { topic: selector, ...options }: BindingOptions & { topic?: string }) {
  const current = await call<{ bindings: Binding[] }>('/api/codex/bindings');
  const existing = current.bindings.find(({ sessionId, enabled }) => sessionId === options.sessionId && enabled);
  const selection = await startTopic(call, project, existing?.topicId, selector);
  if (selection.status === 'choose_topic') return selection;
  const { topic } = selection;
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
