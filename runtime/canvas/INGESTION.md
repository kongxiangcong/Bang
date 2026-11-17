# CompletedTurn ingestion — ticket 14

The native owner receives controlled SessionConnector batches independently of browser lifetime. This is source reception and a durable pending queue, not Organizer execution or regenerated-answer knowledge revalidation (tickets 15/21).

## Public connector contract

Provision an Ed25519 connector with `connector-register`, obtain a signed primary-session handshake through `session-connect`, and enable it through `binding-enable` as documented for ticket 13. Binding stores the calling turn ID and the cursor immediately before that turn. Never select the latest log or infer session identity from a filename.

`turn-ingest` accepts `{proof,batch}`. Proof uses the registered signing key and the existing host/version/instance/session/workspace/role/scope/time fields, plus `purpose: "completed-turn-ingestion"`, `sourceId`, and `batchHash` (SHA-256 of UTF-8 `JSON.stringify(batch)`). A browser/session-selection token is not an ingestion capability; an ingestion proof cannot become a session-binding proof. Each retry may obtain a fresh signed proof for the identical batch. No host message text is persisted until the exact binding/session, workspace, topic scope, signature and batch hash pass validation.

Batch: `{sourceId,previousCursor,events,backfillId?}`. Cursors are opaque connector checkpoints, not sortable IDs. The trusted adapter must enumerate the authorized range in order without skipping records, and emit a gap when records are unavailable. Each event has a distinct next cursor. A completed event has `kind: "turn"`, `role: "primary"`, `status: "completed"`, `turnId`, explicit `versionId`, `cursor`, `user: {role:"user",content}`, `assistant: {role:"assistant",channel:"final",content}`, and `sourceHash` (SHA-256 of `JSON.stringify([user.content,assistant.content])`). The first eligible main event must be the calling turn. Same binding/turn/version/hash is idempotent; a reused version with changed text is rejected. Distinct answer versions remain distinct even if their text hashes match.

Tool, reasoning/non-final, non-primary/subagent and Organizer records only leave whitelisted ignore metadata. Incomplete primary turns reject the batch without moving its checkpoint, allowing later completion. Terminal error/interrupted primary turns are excluded and leave visible gaps. Missing records use `{kind:"gap",turnId,cursor,reason:"missing-record"}`. An ignored internal record cannot bypass the calling-turn check. These checks assume the registered adapter truthfully identifies host completion and role; synthetic signing is not evidence of real Codex/DSH completion detection.

SQLite FULL-synchronous transactions atomically write sources, pending queue, ignore/gap metadata, batch receipt, and cursor. No model call runs in this owner queue. Restart replays from persisted cursor; duplicate batches return durable receipts. A source frozen by switching cannot accept new batches; its backlog and end cursor remain available.

Historical data requires `turn-backfill` with a current session capability, `sourceId`, explicit `startTurnId`, `startCursor`, and `confirmHistory:true`. The returned range ends at the original calling-turn boundary. Its ID is included in signed batches; its separate checkpoint never rewinds live reception. The trusted adapter must honor that selected opaque range. Completed ranges reject new batches; exact retries remain idempotent.

## Public inspection

- CLI: `node runtime/canvas/bang.mjs turn-status --project PROJECT` with JSON stdin `{topicId}` returns received, organized, backlog, pending version identities, gaps and ignores.
- CLI `turn-source` with `{topicId,id}` retrieves original whitelisted source text. `turn-ingest` and `turn-backfill` also accept JSON stdin.
- Browser-protected HTTP: `GET /api/canvas/:topic/turns`, `GET /api/canvas/:topic/source?id=...`, `POST /api/canvas/session/ingest`, `POST /api/canvas/session/backfill`. Existing local Origin/Host/browser token checks apply in addition to signed ingestion authority.
- The topic UI polls received/organized/backlog/gaps independently of board refresh and exposes pending version IDs. There is no operation here that claims a source was organized; it remains pending until Organizer execution is implemented.

## Verification and limits (2026-11-18)

Native Windows, Node v25.8.1, packaged lock helper, temporary synthetic projects and controlled signing keys; no real chat bodies, paid model calls or host log scanning. Initial red was `Unknown runtime operation` after a sandbox spawn restriction was bypassed using approved native execution. Subsequent red cases exposed absent gap records, history command and HTTP routes. A fixture used two Date.now calls and intermittently created a 300001 ms proof TTL; fixtures now capture one timestamp while production strict validation stays unchanged.

Commands: `node --test tests/completed-turns.test.mjs tests/topic-binding.test.mjs`; `npm run build --prefix prototypes/whiteboard-integration`; `node tests/completed-turns-browser.mjs`. The public tests cover signature/scope/tamper rejection, first-call boundary, duplicates and version identities, restart, explicit backfill, frozen source, filters/gaps, protected HTTP, and actual process termination after source/queue inserts before cursor update. Crash recovery is observed only through public status and retried delivery, never internal database assertions. Real headless Chrome closes the actual board tab, receives after Runtime restart, then reopens to see two pending sources and a missing-record gap. The browser fixture uses a synthetic trusted connector.

Windows 10, native Linux ingestion, actual Codex/DSH source adapters, model organization, answer regeneration effects and performance benchmark remain unverified here. This ticket does not claim those cross-ticket acceptance criteria.

Final integration verification: merged ticket 35 (`3a16c80`) preserving both CLI command sets. Combined CompletedTurn/binding/Canvas exchange suite: **17 passed**, zero failures/skips. A subsequent focused HTTP/CLI status test passed after adding the actual JSON-stdin CLI assertion. TypeScript/Vite build passed (existing large chunk warning). Three real Chrome scripts passed: completed-turn receive/close/restart/reopen; topic create/select/switch/takeover; standard Canvas exchange. `git diff --check` clean. Source reception remains synthetic connector evidence, not actual host integration.
