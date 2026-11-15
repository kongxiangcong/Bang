import fs from 'node:fs/promises';

const [command = 'context', ...args] = process.argv.slice(2);
const base = process.env.BANG_URL ?? 'http://127.0.0.1:5180';
async function request(route, body) {
  const response = await fetch(`${base}/api/bang/${route}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? response.statusText);
  return result;
}
function summary(session) {
  return { id: session.id, generation: session.generation, visibleCount: session.visibleCount, totalMessages: session.messages?.length, eventIds: session.events?.map(event => event.id), duplicate: session.duplicate ?? false, url: base };
}
function context(session) {
  const elements = session.scene?.elements?.filter(element => !element.isDeleted) ?? [];
  return {
    ...summary(session),
    mode: session.mode,
    roundsPerUpdate: session.roundsPerUpdate,
    messages: session.messages.slice(0, session.visibleCount),
    nextMessageId: `m${String(session.messages.length + 1).padStart(3, '0')}`,
    appliedEventIds: session.scene?.appliedEventIds ?? [],
    pendingEvents: session.events.filter(event => !session.scene?.appliedEventIds?.includes(event.id)),
    objects: elements.filter(element => element.customData?.bangNode || element.customData?.bangGroup || element.customData?.bangRelation).map(element => ({
      id: element.id, x: element.x, y: element.y,
      text: element.type === 'text' ? element.text : elements.find(label => label.containerId === element.id)?.originalText,
      ...element.customData,
    })),
  };
}
try {
  let result;
  if (command === 'context') result = context(await request('session'));
  else if (command === 'status') result = summary(await request('session'));
  else if (command === 'next') result = summary(await request('next', {}));
  else if (command === 'reset') {
    const idAt = args.indexOf('--id'), everyAt = args.indexOf('--every');
    result = summary(await request('reset', {
      mode: args.includes('--empty') ? 'empty' : 'replay',
      ...(idAt >= 0 ? { id: args[idAt + 1] } : {}),
      ...(everyAt >= 0 ? { roundsPerUpdate: Number(args[everyAt + 1]) } : {}),
    }));
  } else if (command === 'submit') {
    if (!args[0]) throw Error('用法：node bang.mjs submit <event.json>');
    result = summary(await request('submit', JSON.parse(await fs.readFile(args[0], 'utf8'))));
  } else if (command === 'help' || command === '--help') {
    result = { commands: ['context', 'status', 'next', 'reset [--empty] [--id topic] [--every 2]', 'submit <event.json>'], environment: { BANG_URL: base } };
  } else throw Error(`未知命令：${command}`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.cause?.code === 'ECONNREFUSED' ? `Bang 未运行：先在此目录执行 npm run dev -- --port 5180` : error.message);
  process.exitCode = 1;
}
