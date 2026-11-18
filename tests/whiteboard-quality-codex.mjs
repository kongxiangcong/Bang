import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Keep the production adapter's argv and stdout protocol intact. Record only
// the synthetic test prompt, final candidate messages and terminal metadata.
const [mode, executable, evidence, caseId, ...args] = process.argv.slice(2);
const modelCall = args[0] === 'exec';
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const emit = event => console.log(JSON.stringify(event));
let input = '';
if (modelCall) {
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
}
const record = modelCall ? path.join(evidence, 'candidate-' + randomUUID() + '.jsonl') : null;
function save(event) {
  fs.appendFileSync(record, JSON.stringify(event) + '\n', {mode: 0o600});
}
if (modelCall) {
  save({
    kind: 'prompt',
    time: new Date().toISOString(),
    prompt: input,
    schemaSha256: hashFile(args[args.indexOf('--output-schema') + 1]),
    catalogSha256: hashFile(path.resolve('models.json'))
  });
}

if (mode === 'real') {
  const child = spawn(executable, args, {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  child.stdin.on('error', () => {});
  child.stdin.end(modelCall ? input : undefined);
  child.stderr.pipe(process.stderr);
  let line = '';
  let bytes = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    if (!record) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > 4 * 1024 * 1024) return;
    line += chunk;
    let newline;
    while ((newline = line.indexOf('\n')) !== -1) {
      capture(line.slice(0, newline));
      line = line.slice(newline + 1);
    }
  });
  child.on('error', error => {
    if (record) save({kind: 'launch-error', code: error.code});
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    if (record) {
      if (line && bytes <= 4 * 1024 * 1024) capture(line);
      save({kind: 'exit', code, signal, captureLimitExceeded: bytes > 4 * 1024 * 1024});
    }
    process.exitCode = code ?? 1;
  });
} else {
  if (args[0] === '--version') console.log('codex-cli 0.169.0-alpha.11.1');
  else if (args[0] === 'login') console.error('Logged in using controlled fixture');
  else if (args[0] === 'debug') emit({models: [{slug: 'gpt-6.1-sol'}]});
  else if (modelCall) {
    const {completedTurns: [turn]} = JSON.parse(input.slice(input.lastIndexOf('\n') + 1));
    const common = {conditions: [], uncertainty: '受控结果，仅验证运行路径', sources: [turn.id]};
    const card = (id, text) => ({type: 'create-card', id, text, ...common});
    const relation = (id, fromNode, toNode) => (
      {type: 'create-relation', id, fromNode, toNode, kind: 'support', label: '支持', ...common}
    );
    let changes = [card(turn.versionId === 'v1' && ['Q05', 'Q17', 'Q20'].includes(caseId) ? 'prior' : 'result', turn.assistant.content)];
    if (caseId === 'Q17' && turn.versionId === 'v1') {
      changes.push(card('dependent', '结论仅在样本随机时成立'), relation('depends-on-prior', 'prior', 'dependent'));
    }
    if (caseId === 'Q09') {
      changes = [{type: 'supplement-card', id: 'deadline', ...common, conditions: ['补充测试项']}];
    }
    if (caseId === 'Q15') {
      changes = [card('result', '受控存储依据'), relation('storage-support', 'result', 'storage')];
    }
    if (mode === 'controlled-failure') changes[0].sources = ['deliberately-invalid-source'];
    const output = {type: 'item.completed', item: {type: 'agent_message', text: JSON.stringify({version: 1, changes})}};
    const terminal = {type: 'turn.completed', usage: {input_tokens: 42, output_tokens: 17}};
    for (const event of [output, terminal]) {
      capture(JSON.stringify(event));
      emit(event);
    }
    save({kind: 'exit', code: 0, signal: null});
  }
}

function capture(line) {
  if (!line.trim()) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    save({kind: 'invalid-jsonl'});
    return;
  }
  if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
    save({kind: 'candidate', text: event.item.text});
  } else if (event.type === 'turn.completed') {
    save({kind: 'completed', usage: event.usage});
  } else if (event.type === 'turn.failed' || event.type === 'error') {
    save({kind: event.type});
  }
}
