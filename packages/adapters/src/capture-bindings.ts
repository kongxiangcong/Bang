import { BangError } from '../../core/src/store.ts';

type ServiceCall = <Result>(path: string) => Promise<Result>;
type Binding = { sourceTool: string; sessionId: string; topicId: string; enabled: boolean; bindingId?: string };

export async function captureBindings(call: ServiceCall): Promise<Binding[]> {
  try {
    return (await call<{ bindings: Binding[] }>('/api/bindings')).bindings;
  } catch (error) {
    if (!(error instanceof BangError) || error.code !== 'not_found') throw error;
    const { bindings } = await call<{ bindings: Omit<Binding, 'sourceTool'>[] }>('/api/codex/bindings');
    return bindings.map((binding) => ({ ...binding, sourceTool: 'codex' }));
  }
}
