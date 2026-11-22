const bangCommand = /^(?:`|\$\s+)?(?:bang|npm run bang --)\s+(?:bind|unbind|sync|status|stop|serve|open|inspect|ingest|topic|episode|export|import|retry|mcp)\b/iu;
const skillPrompt = /^\s*\$bang(?=\s|$)/u;
const requestPatterns = [
  /(?:请|帮我|麻烦)?(?:用\s*Bang\s*)?(?:绑定|解绑|同步|打开|查看)(?:\s*Bang\s*)?(?:当前会话|这个会话|此会话|会话|(?:这个|当前)?专题|(?:当前)?白板|状态)/iu,
  /(?:请|帮我|麻烦)?(?:把|将|给|在)(?:当前|这个|该)?(?:会话|聊天)(?:[ \t]*)(?:绑定|解绑)/u,
  /(?:请|帮我|麻烦)?(?:把|将|给|在)?(?:当前|这个|该)?(?:Bang\s*)?白板[^\n。！？.!?]{0,30}(?:改为|改成|修改为|编辑|删除|锁定|新增|添加)/iu,
  /(?<![\p{Letter}])(?:please\s+)?(?:bind|unbind|sync|open|show|update|change|delete|lock)\s+(?:the\s+|this\s+|my\s+)?(?:current\s+)?(?:Bang\b|whiteboard\b|board\b|session\b|topic\b)/iu,
];
const directive = /(?:^|[，,：:。.!?]\s*)(?:(?:请|帮我|麻烦)\s*|(?:顺便|另外)\s*(?:请)?|(?:please|also)\s+)/iu;
const startsWithAction = /^(?:(?:用\s*Bang\s*)?(?:把|将|给|在|绑定|解绑|同步|打开|查看)|(?:bind|unbind|sync|open|show|update|change|delete|lock)\b)/iu;
const receiptPatterns = [
  /(?:已经?|成功)(?:帮你|为你|把|将)?(?:[^\n。！？]{0,15})?(?:绑定|解绑|同步|打开|修改|改为|改成|删除|锁定|添加|更新|写入|启动|停止)/u,
  /(?:绑定|解绑|同步|打开|保存|修改|更新|删除|启动|停止)(?:已完成|成功|失败)|(?:当前服务|守护进程|Bang 服务)[^\n。！？]{0,26}(?:监听|运行|就绪|端口|已停止)/iu,
  /(?<![\p{Letter}])(?:I've\s+|I have\s+|already\s+|successfully\s+)?(?:bound|unbound|synced|opened|updated|changed|deleted|locked|saved|started|stopped)\s+(?:the\s+|your\s+|this\s+)?(?:Bang\b|whiteboard\b|board\b|session\b|topic\b|daemon\b)/iu,
  /^(?:完成|已完成|操作成功|Done|Completed)[。.!]?$/iu,
];

export function bangOperationCall(entry: { type?: unknown; name?: unknown; arguments?: unknown }) {
  if (entry.type !== 'function_call' || typeof entry.name !== 'string') return false;
  if (/(?:^|__)bang_(?:topics|record_turn|sync|query_board|update_epistemic)$/u.test(entry.name)) return true;
  if (!/(?:^|__)exec_command$/u.test(entry.name) || typeof entry.arguments !== 'string') return false;
  try {
    const { cmd } = JSON.parse(entry.arguments) ?? {};
    return typeof cmd === 'string' &&
      cmd.split(/\r?\n|\s*(?:&&|\|\||;)\s*/u).some((part) => bangCommand.test(part.trimStart()));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return false;
  }
}

function paragraphs(text: string) {
  // A skill mention on its own line explicitly separates its invocation from the prompt.
  return text.split(/(\r?\n[ \t]*\r?\n+|(?<=^\$bang)\r?\n)/mu);
}

function withoutSections(sections: string[], omit: (section: string) => boolean) {
  let filtered = '';
  for (let index = 0; index < sections.length; index += 2) {
    if (!omit(sections[index])) filtered += (filtered ? sections[index - 1] : '') + sections[index];
  }
  return filtered;
}

function operationRequest(text: string) {
  return skillPrompt.test(text) || bangCommand.test(text.trimStart()) ||
    ((directive.test(text.trimStart()) || (startsWithAction.test(text.trimStart()) && !/[？?]\s*$/u.test(text))) &&
      requestPatterns.some((pattern) => pattern.test(text)));
}

function receipt(text: string) {
  return receiptPatterns.some((pattern) => pattern.test(text.trim()));
}

export function filterCodexExchange(user: string, assistant: string, operationCall = false) {
  const prompts = paragraphs(user);
  const answers = paragraphs(assistant);
  const commanded = prompts.some((part, index) => index % 2 === 0 && operationRequest(part));
  const receipted = answers.some((part, index) => index % 2 === 0 && receipt(part));
  if (!commanded && !(receipted && operationCall)) return { user, assistant };
  const discussion = commanded ? withoutSections(prompts, operationRequest) : user;
  const reply = withoutSections(answers, receipt);
  if (discussion.trim() && reply.trim()) return { user: discussion, assistant: reply };
}
