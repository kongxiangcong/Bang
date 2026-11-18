import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {runtimeOperation} from '../runtime/native/runtime.mjs';
import {deliverContext} from '../runtime/native/context-bridge.mjs';
import {CODEX_VERSION} from '../runtime/codex/executor-config.mjs';
import {STRUCTURE_RULES} from '../runtime/canvas/structure-rules.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const baseline = path.join(repo, 'baselines/whiteboard-v1');
const wrapper = fileURLToPath(new URL('./whiteboard-quality-codex.mjs', import.meta.url));
const dimensions = ['retention', 'conditions', 'relations', 'structure', 'humanRewrite', 'localStability'];
const blockers = ['lostHumanModification', 'fabricatedEvidence', 'withdrawnPremiseUsed'];
const modes = ['plan', 'controlled', 'controlled-failure', 'real'];
const [mode, out, ...options] = process.argv.slice(2);
if (!modes.includes(mode) || !out || (mode === 'plan' && options.length)
    || (mode === 'real' && options.length !== 1)
    || (mode === 'controlled-failure' && options.length !== 1)) {
  throw Error('Usage: node tests/whiteboard-quality.mjs plan|controlled|controlled-failure|real NEW_OUTPUT [CASE_IDS... | REAL_APPLICABILITY_FILE]');
}
const output = path.resolve(out);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = (dir, name, value) => fs.writeFile(
  path.join(dir, name + '.json'), JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600}
);
const manifest = await readJson(path.join(baseline, 'manifest.json'));
const fixtureHashes = {};
for (const name of ['quality-cases.json', 'scoring.md']) {
  fixtureHashes[name] = hash(await fs.readFile(path.join(baseline, name)));
  assert.equal(fixtureHashes[name], manifest.fixtureHashes[name], 'Frozen input changed: ' + name);
}
const {cases} = await readJson(path.join(baseline, 'quality-cases.json'));
assert.equal(cases.length, 20);
assert.equal(new Set(cases.map(item => item.id)).size, 20);
for (const domain of ['learning', 'meeting', 'comparison', 'research']) {
  assert.equal(cases.filter(item => item.domain === domain && item.runs === 3).length, 5);
}
const selected = mode.startsWith('controlled') && options.length
  ? cases.filter(item => options.includes(item.id)) : cases;
if (mode.startsWith('controlled') && options.length && selected.length !== options.length) {
  throw Error('Case selection contains an unknown or repeated ID');
}
const schedule = selected.flatMap(item => Array.from({length: item.runs}, (_, run) => ({
  key: item.id + '-r' + (run + 1), caseId: item.id, domain: item.domain, run: run + 1
})));

const applicabilityTemplate = {
  reviewer: '',
  cases: Object.fromEntries(cases.map(item => [
    item.id, Object.fromEntries(dimensions.map(dimension => [dimension, {applicable: null, reason: ''}]))
  ]))
};
const shaFiles = [
  'runtime/native/runtime.mjs', 'runtime/codex/executor.mjs', 'runtime/codex/executor-config.mjs',
  'runtime/codex/result-schema.mjs', 'runtime/canvas/organizer.mjs', 'runtime/canvas/contract.ts',
  'runtime/canvas/layout.ts', 'runtime/canvas/structures.ts', 'runtime/canvas/mixed-structures.ts',
  'runtime/canvas/structure-rules.mjs', 'tests/whiteboard-quality.mjs', 'tests/whiteboard-quality-codex.mjs'
];
const sourceHashes = Object.fromEntries(await Promise.all(shaFiles.map(async file => [
  file, hash(await fs.readFile(path.join(repo, file)))
])));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();

let applicabilityBytes;
let realExecutable;
let realAuthHome;
if (mode === 'real') {
  applicabilityBytes = await fs.readFile(options[0]);
  const preregistration = JSON.parse(applicabilityBytes);
  assert.ok(preregistration.reviewer?.trim(), 'A reviewer must preregister applicability');
  for (const {id} of cases) {
    for (const dimension of dimensions) {
      const entry = preregistration.cases?.[id]?.[dimension];
      assert.equal(typeof entry?.applicable, 'boolean', id + ' ' + dimension + ' applicability missing');
      if (!entry.applicable) assert.ok(entry.reason?.trim(), id + ' ' + dimension + ' needs N/A justification');
    }
  }
  realExecutable = process.env.BANG_QUALITY_REAL_BINARY;
  realAuthHome = process.env.BANG_QUALITY_AUTH_HOME;
  assert.ok(realExecutable && path.isAbsolute(realExecutable)
    && !/\.(cmd|bat|ps1)$/i.test(realExecutable) && (await fs.stat(realExecutable)).isFile(),
    'Real mode requires an explicit absolute BANG_QUALITY_REAL_BINARY for the Codex executable');
  assert.ok(realAuthHome && path.isAbsolute(realAuthHome) && (await fs.stat(realAuthHome)).isDirectory(),
    'Real mode requires an explicit absolute BANG_QUALITY_AUTH_HOME');
}

await fs.mkdir(output, {mode: 0o700}); // Make accidental overwrite or incomplete-run replacement impossible.
await write(output, 'plan', {
  mode, generatedAt: new Date().toISOString(),
  sourceCommit, sourceHashes, fixtureHashes, schedule,
  host: {platform: process.platform, arch: process.arch, release: os.release(), node: process.version},
  sourceHost: 'isolated-signed-frozen-fixture',
  executor: {model: 'gpt-6.1-sol', cli: CODEX_VERSION, real: mode === 'real',
    seed: mode === 'real' ? null : 'deterministic-fixture',
    proxyEnabled: mode === 'real' && process.env.BANG_QUALITY_INHERIT_PROXY === '1'},
  compiler: {version: STRUCTURE_RULES.compiler, rulesRevision: STRUCTURE_RULES.revision},
  ...(applicabilityBytes ? {applicabilitySha256: hash(applicabilityBytes)} : {})
});
if (applicabilityBytes) {
  await fs.writeFile(path.join(output, 'applicability.json'), applicabilityBytes, {flag: 'wx', mode: 0o600});
} else {
  await write(output, 'applicability', applicabilityTemplate);
}
await write(output, 'scoring-form', {
  instructions: 'Independent reviewer uses frozen scoring.md and quality-cases.json. Complete applicability before seeing output. Scores are 0/1/2 or N/A as preregistered. An unsuccessful or absent run prevents a pass.',
  reviewer: '',
  runs: schedule.map(item => ({
    ...item, outputRevision: null, sourceIds: [],
    scores: Object.fromEntries(dimensions.map(dimension => [dimension, {score: null, justification: ''}])),
    blockingFailures: Object.fromEntries(blockers.map(blocker => [blocker, {observed: null, justification: ''}]))
  }))
});
const connectors = 'frozen-quality-fixture';
const waiting = new Set(['running', 'retry']);
const successful = new Set(['committed', 'no-change']);
const timeLimit = mode === 'real' ? 90000 : 12000;

async function executeSchedule() {
  const summaries = [];
  for (const entry of schedule) {
    const item = selected.find(item => item.id === entry.caseId);
    const dir = path.join(output, entry.key);
    await fs.mkdir(dir);
    const result = await runCase(dir, item, entry);
    await write(dir, 'result', result);
    summaries.push({key: entry.key, status: result.status, errors: result.errors});
    console.log(JSON.stringify(summaries.at(-1)));
  }
  await write(output, 'index', {scheduled: schedule.length, evidenceKind: mode, runs: summaries});
  if (summaries.some(item => item.status !== 'captured')) process.exitCode = 1;
}

async function runCase(dir, item, entry) {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'bang-q43-'));
  const older = previousVersion(item.id);
  const errors = [];
  let stage = 'start';
  let topicId;
  const control = (command, input) => runtimeOperation(project, command, undefined, input);
  const board = (command, input) => runtimeOperation(project, command, topicId, input);
  const organizer = () => control('organizer-status', {topicId});
  const versions = () => control('turn-status', {topicId});
  let before, after, reopened, afterIngest;
  try {
    process.env.BANG_ORGANIZER_CODEX = JSON.stringify({
      version: 1, executable: process.execPath, model: 'gpt-6.1-sol',
      prefixArgs: [wrapper, mode, realExecutable ?? '', dir, item.id],
      authHome: realAuthHome ?? project,
      inheritProxy: process.env.BANG_QUALITY_INHERIT_PROXY === '1' && mode === 'real'
    });
    const source = await bindFrozenSource(control, entry.key);
    topicId = source.topicId;
    await control('organizer-configure', {
      limits: {callsPerHour: older ? 2 : 1, timeoutMs: timeLimit, batchSize: 1, concurrency: 1}
    });
    stage = 'prepare';
    await prepareBoard(item.id, topicId, board, dir);
    await control('organizer-enable', {topicId});
    const checkedOutput = {item, run: entry.run, topicId};
    if (older) {
      stage = 'ingest-v1';
      await source.ingest(older.user, older.assistant, 'v1');
      const prior = await awaitTerminal(organizer, 1);
      const oldState = await board('state');
      const oldVersions = await versions();
      await write(dir, 'prior-version', {organizer: prior, versions: oldVersions, board: oldState});
      assert.ok(successful.has(prior.tasks[0]?.status), 'Earlier organizer task did not complete');
      const oldId = oldVersions.versions[0].id;
      if (!Object.values(oldState.metadata).some(value => value.knowledge?.sources?.includes(oldId))) {
        errors.push({stage, message: 'Earlier organizer output left no prior source-backed object to invalidate'});
      }
      await control('organizer-control', {topicId, action: 'pause'});
    }
    before = await board('state');
    await write(dir, 'before', {...checkedOutput, board: before, context: await board('knowledge-context')});

    stage = 'ingest-frozen-turn';
    const receipt = await source.ingest(item.turns[0].text, item.turns[1].text, older ? 'v2' : 'v1');
    if (older) {
      afterIngest = await board('state');
      await write(dir, 'version-transition', {
        receipt, board: afterIngest, context: await board('knowledge-context'), versions: await versions()
      });
      await control('organizer-control', {topicId, action: 'resume'});
    } else {
      await write(dir, 'ingestion', receipt);
    }

    stage = 'await-organizer';
    const status = await awaitTerminal(organizer, older ? 2 : 1);
    const finalTask = status.tasks.at(-1);
    if (!successful.has(finalTask?.status)) {
      errors.push({stage, message: 'Frozen organizer task did not complete', code: finalTask?.error?.code ?? status.pauseReason});
    } else {
      stage = 'controlled-host-context';
      const delivery = await source.deliverNext();
      await write(dir, 'next-turn-context', delivery);
      assert.equal(delivery.ack.status, 'delivered');
      assert.equal(delivery.envelope.revision, (await board('state')).revision);
      if (mode === 'controlled' && older) {
        assert.ok(delivery.envelope.withdrawn.some(card => card.id === 'prior'));
        assert.ok(!delivery.envelope.cards.some(card => card.id === 'prior'));
      }
    }
  } catch (failure) {
    errors.push({stage, message: failure.message, code: failure.code});
  } finally {
    // Reopen an isolated project with all executors disabled, including after
    // a failed attempt. Capture the full public state available at each point.
    delete process.env.BANG_ORGANIZER_CODEX;
    if (topicId) {
      try {
        after = await captureBoard(board, control, topicId);
        await write(dir, 'after', after);
      } catch (failure) {
        errors.push({stage: 'capture', message: failure.message, code: failure.code});
      }
    }
    try {
      await control('stop');
      if (after) {
        reopened = await captureBoard(board, control, topicId);
        await write(dir, 'reopened', reopened);
        assert.deepEqual(reopened.board, after.board, 'CommittedBoard changed after stop/reopen');
        assert.deepEqual(reopened.versions, after.versions, 'Source history changed after stop/reopen');
        assert.deepEqual(reopened.context, after.context, 'Active knowledge changed after stop/reopen');
      }
    } catch (failure) {
      errors.push({stage: 'reopen', message: failure.message, code: failure.code});
    }
    try {
      await control('stop');
      await fs.rm(project, {recursive: true, force: true, maxRetries: 8, retryDelay: 50});
    } catch (failure) {
      errors.push({stage: 'cleanup', message: failure.message, code: failure.code});
    }
  }
  if (mode === 'controlled' && after?.board && !errors.length) {
    try {
      verifyIntegrity(item.id, before, after, afterIngest);
    } catch (failure) {
      errors.push({stage: 'controlled-integrity', message: failure.message});
    }
  }
  return {
    ...entry, topicId, errors, status: errors.length ? 'incomplete' : 'captured',
    revision: after?.board.revision ?? null,
    sourceIds: after?.versions.versions.map(version => version.id) ?? [],
    semanticScore: null
  };
}

async function bindFrozenSource(control, sessionId) {
  const {workspaceId} = await control('start');
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  await control('connector-register', {
    id: connectors, host: connectors, versions: ['1'], publicKey: publicKey.export({format: 'pem', type: 'spki'})
  });
  function proof(extra = {}) {
    const issuedAt = Date.now();
    const payload = Buffer.from(JSON.stringify({
      host: connectors, version: '1', instanceId: 'independent-quality-project', sessionId, workspaceId,
      role: 'primary', scope: ['*'], turnId: 'frozen-turn', cursor: 'c0',
      issuedAt, expiresAt: issuedAt + 300000, nonce: randomUUID(), ...extra
    })).toString('base64url');
    return {connectorId: connectors, payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url')};
  }
  const binding = await control('binding-enable', await control('session-connect', proof()));
  const bridgeId = 'quality-context';
  const bridge = generateKeyPairSync('ed25519');
  await control('context-register', {
    id: bridgeId, host: connectors, versions: ['1'], publicKey: bridge.publicKey.export({format: 'pem', type: 'spki'})
  });
  let cursor = 'c0';
  return {
    topicId: binding.topic.id,
    async deliverNext() {
      let envelope;
      const turnId = 'after-frozen-turn';
      const calls = [];
      const ack = await deliverContext({
        async call(command, input) {
          const data = {topicId: binding.topic.id, turnId, ...input};
          const request = proof({purpose: command, turnId, cursor, bridgeId, requestHash: hash(JSON.stringify(data))});
          request.signature = sign(null, Buffer.from(request.payload), bridge.privateKey).toString('base64url');
          const trace = {command, outcome: input.outcome, elapsedMs: null};
          calls.push(trace);
          const started = performance.now();
          try {
            return await control(command, {...data, proof: request});
          } catch (failure) {
            trace.error = {code: failure.code, message: failure.message};
            throw failure;
          } finally {
            trace.elapsedMs = Math.round(performance.now() - started);
          }
        },
        deliver({envelope: value, envelopeHash}) {
          envelope = value;
          return {accepted: true, envelopeHash};
        }
      });
      return {host: 'controlled-host-delivery', envelope, ack, calls};
    },
    async ingest(user, assistant, versionId) {
      const next = versionId === 'v1' ? 'c1' : 'c2';
      const batch = {
        sourceId: binding.source.id, previousCursor: cursor,
        events: [{
          kind: 'turn', role: 'primary', status: 'completed', turnId: 'frozen-turn', versionId, cursor: next,
          user: {role: 'user', content: user}, assistant: {role: 'assistant', channel: 'final', content: assistant},
          sourceHash: hash(JSON.stringify([user, assistant]))
        }]
      };
      const receipt = await control('turn-ingest', {
        batch, proof: proof({purpose: 'completed-turn-ingestion', sourceId: binding.source.id, batchHash: hash(JSON.stringify(batch))})
      });
      cursor = next;
      assert.equal(receipt.received, 1);
      return receipt;
    }
  };
}

function previousVersion(id) {
  return {
    Q05: {user: '记录当前关于磁铁的断言。', assistant: '所有金属都能被磁铁吸引。'},
    Q17: {user: '记录研究结论的前提和依赖关系。', assistant: '样本随机。结论仅在样本随机时成立。'},
    Q20: {user: '记录试验状态。', assistant: '试验成功。'}
  }[id];
}

async function prepareBoard(id, topicId, board, dir) {
  const card = (id, text, x = 0, y = 0, extra = {}) => ({
    type: 'create-card', card: {id, text, x, y, width: 320, height: 120, ...extra}
  });
  let step = 0;
  async function save(operations) {
    const request = {
      operationId: randomUUID(), topic: topicId, baseRevision: (await board('state')).revision,
      author: {kind: 'manual', id: 'quality-editor'}, readDependencies: [], intent: 'explicit-save', operations
    };
    const receipt = await board('commit', request);
    await write(dir, 'manual-save-' + (++step), {request, receipt});
  }
  if (id === 'Q09') {
    await save([card('deadline', '截止时间为周五')]);
    await save([{type: 'edit-card', id: 'deadline', text: '截止时间为下周二'}]);
  } else if (id === 'Q14') {
    await save([
      card('evidence', '测试支持'), card('a', '方案A', 400), card('b', '方案B', 800), card('c', '方案C', 1200),
      {type: 'create-relation', edge: {id: 'test-support', fromNode: 'evidence', toNode: 'a', kind: 'support', label: '测试支持'}}
    ]);
    await save([{type: 'edit-relation', id: 'test-support', toNode: 'c'}]);
  } else if (id === 'Q15') {
    await save([
      card('storage', '区域一：比较存储', 20, 30, {regionId: 'storage-region', zIndex: 1}),
      card('network', '区域二：比较网络', 820, 430, {regionId: 'network-region', zIndex: 2}),
      card('network-detail', '网络比较项', 1220, 670, {regionId: 'network-region', zIndex: 3})
    ]);
  }
}

async function awaitTerminal(getStatus, count) {
  const deadline = Date.now() + timeLimit + 10000;
  do {
    const state = await getStatus();
    if (state.pauseReason || state.tasks.length >= count && state.tasks.every(task => !waiting.has(task.status))) {
      return state;
    }
    await delay(150);
  } while (Date.now() < deadline);
  throw Error('Public Organizer attempt did not settle within the capture window');
}

async function captureBoard(board, control, topicId) {
  const versions = await control('turn-status', {topicId});
  return {
    board: await board('state'),
    context: await board('knowledge-context'),
    contextStatus: await board('context-status'),
    organizer: await control('organizer-status', {topicId}),
    proposals: await board('proposals'),
    versions,
    sources: await Promise.all(versions.versions.map(version => control('turn-source', {topicId, id: version.id})))
  };
}

function verifyIntegrity(id, before, after, afterIngest) {
  const {board, context, versions, organizer} = after;
  assert.ok(organizer.tasks.every(task => task.process?.exitConfirmed), 'Native supervision did not confirm CLI exit');
  assert.ok(versions.versions.some(version => version.current && version.processing === 'organized'), 'No organized current source');
  if (id === 'Q09') {
    assert.equal(board.canvas.nodes.find(node => node.id === 'deadline')?.text, '截止时间为下周二');
    assert.ok(board.metadata.deadline.knowledge.conditions.includes('补充测试项'));
  } else if (id === 'Q14') {
    assert.deepEqual(board.canvas.edges.find(edge => edge.id === 'test-support'),
      before.canvas.edges.find(edge => edge.id === 'test-support'));
    assert.equal(board.canvas.edges.find(edge => edge.id === 'test-support').toNode, 'c');
  } else if (id === 'Q15') {
    const network = state => state.canvas.nodes.filter(node => node.regionId === 'network-region');
    assert.equal(network(before).length, 2);
    assert.deepEqual(network(board), network(before));
    assert.deepEqual(board.canvas.edges.filter(edge => edge.id === 'storage-support')
      .map(edge => [edge.fromNode, edge.toNode]), [['result', 'storage']]);
  } else if (afterIngest) {
    const [old, current] = versions.versions;
    assert.deepEqual([old.current, current.current], [false, true]);
    assert.equal(afterIngest.metadata.prior.basis.status, 'needs-review');
    assert.equal(context.knowledgeCards.some(node => node.id === 'prior'), false);
    if (id === 'Q17') assert.equal(afterIngest.metadata.dependent.basis.status, 'needs-review');
    assert.equal(after.sources.find(entry => entry.id === old.id).currentVersionId, 'v2');
  }
}

if (mode === 'plan') {
  console.log(JSON.stringify({output, planned: schedule.length, executed: 0}));
} else {
  // Fresh process-only configuration never changes any installed Codex setup.
  for (const key of ['BANG_ORGANIZER_ENDPOINT', 'BANG_ORGANIZER_NATIVE', 'BANG_ORGANIZER_DSH',
    'BANG_ORGANIZER_CODEX']) delete process.env[key];
  await executeSchedule();
}
