# Canvas runtime: explicit card saves (tickets 02–03, 06, 11)

Use a disposable/new project. Do not point this development runtime at an existing
user project. Verified on Windows 11 with Node 25.8.1 and native `node:sqlite`.
The legacy companion and original `/` page remain separate.

```powershell
'{"cards":[]}' | node runtime/canvas/bang.mjs generate --project D:/tmp/bang-demo --topic demo
node runtime/canvas/bang.mjs read --project D:/tmp/bang-demo --topic demo
node runtime/canvas/bang.mjs state --project D:/tmp/bang-demo --topic demo
$env:BANG_CANVAS_PROJECT='D:/tmp/bang-demo'
cd prototypes/whiteboard-integration
npm run dev
```

Open `http://127.0.0.1:5180/canvas.html?topic=demo`. The knowledge-card panel creates,
edits and deletes text, file and link cards. Browser-local drafts do not change committed state.
Only **保存** sends operations; the page displays the confirmed revision and operation
identity. Excalidraw shows the committed Canvas. Reload opens that same revision.
There are no model calls or remote resources required for saving.

## Public boundaries

- CLI `generate` bootstraps a topic once; `read` returns standard Canvas; `state`
  returns `{revision,canvas,metadata}`. Reads use SQLite read-only connections and
  check the published Canvas hash; they do not initialize or repair files.
- CLI `commit` consumes a `BoardPatch` JSON from stdin. HTTP GET
  `/api/canvas/:topic` and `/state` expose the same reads; POST
  `/api/canvas/:topic/commit` accepts JSON and returns the same receipt.
- `contract.ts` defines dependency-free DOM-free Canvas and typed patches. Supported
  operations are `create-card`, `edit-card` (text, position and existing resource reference) and `delete-card`. A patch
  carries topic, operationId, baseRevision, manual author, readDependencies, intent
  `explicit-save` and operations. Manual provenance records the actor/operation,
  never a fabricated chat turn. Bootstrap provenance is separately labeled.
- The entire patch is validated against the exact current revision before writing.
  Stale baseline or any invalid operation rejects the entire save. This conservative
  baseline gate intentionally precedes field-aware merge in ticket 07. No incoming
  whole-scene replacement is accepted. Retrying identical operation IDs returns the
  original receipt; reusing an ID with different content is rejected.

Example patch, passed to CLI `commit` or HTTP:

```json
{"operationId":"save-1","topic":"demo","baseRevision":0,"author":{"kind":"manual","id":"local-user"},"readDependencies":[],"intent":"explicit-save","operations":[{"type":"create-card","card":{"id":"idea-1","text":"人工知识","x":0,"y":0,"width":320,"height":180}}]}
```

## Publication and extension seams

One `.bang/board.sqlite` holds topic heads, complete revision snapshots and durable
intent/receipt records. A validated candidate is stored as a prepared intent with
SQLite synchronous FULL. The Canvas is written to a same-directory temporary file,
flushed with fsync, its prior hash checked again, and renamed over the old file.
Only then does a SQLite transaction confirm the head, revision and receipt.
Public reads return a confirmed coherent state or recovery-required error, never
an unconfirmed replacement. Unknown external content is not silently overwritten.

The ticket 04 native project daemon owns publication; CLI and browser requests
use that single writer. See `../native/README.md` for platform evidence and limits. Prepared failure
blocks subsequent writes and preserves recovery material; automated crash recovery,
stronger bootstrap publication and platform durability/fault testing belong to
05. The bootstrap writes its initial file before its metadata, so interruption can
require recovery. Draft persistence/IME belongs to 06; field merge to 07; history
navigation to 12. Standard text, file and link nodes are supported; other node types and edges
are rejected rather than silently discarded. See the
[JSON Canvas specification](https://jsoncanvas.org/spec/1.0/).

## Evidence, 2026-11-18

- `node --test tests/canvas-save.test.mjs tests/canvas-runtime.test.mjs tests/legacy-runtime.test.mjs tests/legacy-http.test.mjs`: 11 passing public CLI/HTTP/compiler and legacy tests. Fresh-process reopen, true manual source, stable idempotent receipt, edit/delete, stale baseline and all-or-nothing patch rejection covered.
- TDD: CLI save failed `Unknown command`, then passed; HTTP save failed 405, then passed. Additional edit/delete/conflict regression passed on its first run (not a separate red cycle). Browser first failed for missing build, then with built old page failed on missing create control before UI implementation.
- `npm run build`: TypeScript and production build pass; existing large-bundle warning.
- `node tests/canvas-save-browser.mjs`: real Chrome mouse/keyboard creates a card, checks revision remains zero before Save, saves, reopens exact text, edits, deletes, and reopens revision 3. Real application HTTP and temporary project disk, no intercepted API or injected scene. Initial driver select-all failed to replace placeholder text; native selectAll command fixed the driver, then passed.
- `node tests/canvas-browser.mjs` and `node tests/legacy-browser.mjs`: prior no-write-on-read and original rectangle gesture/save/reload pass. Ignored local screenshot `canvas-save-browser.png` inspected: two original cards and revision 3 remain after deleting the new card.

Loopback/Chrome execution required leaving the restricted sandbox. All projects
were temporary; no real `.bang` was touched. This proves the narrow local save
path with no configured model. No Linux, Windows 10, physical IME, crash recovery,
concurrent process ownership, performance or real Codex/DSH host acceptance claim.

## Ticket 11 resource-card boundary

`Card` supports standard `text`, `file` and `link` nodes. File references are
project-relative, with forward slashes; links accept only HTTP(S), without URL
userinfo or common credential query parameters. File references are validated
against existing native symlink/junction components on save and on status reads.
Missing files remain valid references. The resource endpoint returns only
availability, never file bytes; links and files are never automatically downloaded.
Hidden path segments, absolute paths, traversal and alternate data streams are
rejected with generic diagnostics. Existing reference replacement with a junction
is reported as blocked. This is not an arbitrary file viewer or upload service.

The details panel uses React text nodes and a scrollable raw `<pre>`, preserving
Markdown, code and formulas exactly, without HTML interpretation or remote embeds.
Canvas labels abbreviate long text for display only; committed raw content is
unmodified. Link navigation requires an explicit click and omits referrer/opener.

Evidence in progress (Windows 11, Node 25.8.1): CLI resource save/reopen test first
failed `Expected string`, then passed. Native junction safety test first failed
because escape references were accepted, then passed after path guards. Restricted
sandbox cannot create junctions (`EPERM`); native rerun covers the actual junction.
Public resource HTTP status covers available → removed/missing → replaced/blocked.
Edit-resource regression passed on its first run (not a separate red cycle).
Real-browser test failed at the missing resource-create button before UI wiring.
## Ticket 06 draft evidence (2026-11-18)

- `npm run build` (companion): passed, existing large-chunk advisory remains.
- `node tests/canvas-draft-browser.mjs`: real headless Chrome / real HTTP middleware / temporary project filesystem. Red: recovery prompt timed out before implementation. Green: explicit recover/discard after reload; text and pointer-up drafts; two pages and two topics isolated; stale save retained original baseline and draft; committed read excludes drafts. Chromium `Input.imeSetComposition` tested unfinished and finalized Chinese composition; this is simulated browser IME, not physical Windows IME.
- Browser test performs DOM inspection and CDP input; no React state injection or API interception. Programmatic reload does not create drafts. Only pointer-end coordinate movement is mapped in this ticket; complete layout operations belong to ticket 09.
- Browser-local recovery uses localStorage by stable Runtime workspace identity, topic and editor identity (`window.name`); document-lifetime Web Locks reject an inherited live editor identity. An existing editor offers its own draft; a newly opened editor can explicitly copy another editor's retained draft from the recovery list. Clearing browser storage removes these local drafts. Cross-version merge is not implemented: recovery retains the original revision, so stale save fails atomically.
- API/CLI regression: `node --test tests/canvas-save.test.mjs tests/canvas-runtime.test.mjs`.
- Untested: physical OS IME, native Windows 10/Ubuntu and real host loop, quota/device-loss durability, cross-origin/port browser storage migration. No user `.bang` data was used.

- Follow-up isolation acceptance: two real temporary workspaces served sequentially at the same HTTP origin stayed isolated. A controlled inherited-window-name fixture on a second Chrome tab was assigned a distinct editor identity. This simulates duplicate-tab identity; actual Chrome Duplicate Tab UI was not exercised. Interrupted pointer gesture then reload produced no recovery draft; successful pointer-end recovery saved the exact moved coordinate.


- Final 06 rerun after native commit 19dcfbb: build and complete draft browser script passed with /api/canvas/session/bootstrap. Build reports a temporary missing readResourceStatus export from ticket04's forward resource route until ticket11 is integrated; this does not affect the tested text draft endpoints. Seven committed-state CLI/HTTP regressions also passed after native integration.



### Ticket 11 final validation, 2026-11-18

- Final integration includes ticket 04 `19dcfbb`, ticket 06 `ae52268`, and integration
  tip `e6d2513`; resource status uses authenticated HTTP → native daemon → store.
- `node --test tests/canvas-resources.test.mjs tests/native-runtime.test.mjs tests/canvas-save.test.mjs tests/canvas-runtime.test.mjs`: **18 passed**. Resources remain complete on fresh CLI reads; file/link edits preserve node kinds; unsafe protocols, URL userinfo, credential query/fragment, traversal, absolute/hidden paths and native junction escapes reject atomically. Available/removed/replaced resources return available/missing/blocked without bytes. OAuth credential-fragment test first failed acceptance, then passed.
- `npm --prefix prototypes/whiteboard-integration run build`: TypeScript and production build passed; existing large-chunk warning remains.
- `node tests/canvas-resources-browser.mjs`: real Chrome input creates file/link/raw cards, recovers an incomplete URL draft, verifies no revision before Save, saves and reopens exact long Markdown/code/formula text, shows missing-file placeholder, verifies inert script text and observes no remote link request. No API interception, injected scene or model mock. Local ignored screenshot `canvas-resources-browser.png` inspected; canvas preview is shortened while the detail panel retains complete raw text.
- `node tests/canvas-draft-browser.mjs`: combined UI regression retains two tabs/topics, workspace isolation, inherited editor identity protection, draft recovery/discard, stale-save preservation, pointer drag and Chromium composition behavior. Physical OS IME is not asserted.
- Only temporary projects were used. File contents are not rendered or downloaded: file cards preserve references and show availability. Markdown/code/formulas are read as raw text, not executed or typeset. No real host/model loop, native Windows 10/Ubuntu, hostile concurrent filesystem race, performance target or complete T22/T30 claim.

- Integration regression initially used a stale assertion that the other workspace
  had no `<details>` elements. Resource details correctly exist there. The test
  now checks absence of other-page draft recovery specifically, and passes. Its
  failure cleanup was hardened to stop the second temporary project daemon and
  close server connections; the interrupted temporary daemon was publicly stopped.
- Integration verification after merging 06: production build and `node tests/canvas-draft-browser.mjs` passed. Combined native/Canvas CLI/HTTP run was 14/15: `project daemon reuses ownership across CLI launches and survives independent clients` failed with `Native runtime startup failed` while the build ran concurrently. Its isolated rerun passed; the intermittent startup failure remains recorded and its cause is not established. Native security and simultaneous-start tests passed in that combined run. Ticket 04's corrected validation commands were preserved.


## Ticket 07 — manual refresh and field-aware saves (2026-11-18)

`edit-card` now carries only changed fields (`text`, `x`, `y`, `file`, `url`).
`baseRevision` identifies the displayed historical snapshot. Optional operation
`fieldRevisions` identifies the persisted historical revision actually read for
individual fields after local saves. Acknowledging a movement never acknowledges
unseen remote text. Deletes compare every object field; retired identities cannot
be reused. All comparisons and publication run within the native single writer.

`POST /api/canvas/:topic/preview` (CLI `preview`, patch on stdin) returns
`headRevision`, comparable `conflicts` with base/current/proposed values, and
`legalOperations`. A conflicting commit returns HTTP 409 with the same preview
and publishes nothing. Resource constraints also apply to offered subsets. Saving
a subset requires a new explicit operation and rechecks against the current head.
No scene replacement endpoint was introduced.

The page distinguishes **显示版本**, **后台头版本**, and **局部确认**. Polling uses
`GET /api/canvas/:topic/head`, which returns only a revision; it does not fetch or
apply a scene. A successful local save updates only the acknowledged local
snapshot and the fields it actually wrote. Failed full saves retain the full
draft. **另存无冲突部分** leaves the remaining edits recoverable, with their original
field baselines. **刷新** offers **保存并刷新 / 保留并合并 / 放弃并刷新**, plus cancel.
Keep-and-merge preserves conflicting edits and their old baseline rather than
silently accepting remote values as their new baseline. Explicit scene updates
retain the Excalidraw viewport.

Validation environment: Windows 11 build 26200, Node v25.8.1,
Chrome 157.0.8103.52. Tests use isolated temporary projects, real native Runtime,
real SQLite/Canvas publication and Chrome CDP mouse/text input. No model or real
Codex/DSH conversation is involved. No browser API interception or injected editor
state is used.

Commands and observed results:

```text
node --test --test-concurrency=1 tests/canvas-runtime.test.mjs tests/canvas-save.test.mjs tests/canvas-resources.test.mjs tests/canvas-conflicts.test.mjs tests/native-runtime.test.mjs tests/legacy-runtime.test.mjs tests/legacy-http.test.mjs
# 30 passed; 0 failed, including the merged native startup regressions.
npm run build --prefix prototypes/whiteboard-integration
# TypeScript + Vite passed; existing large-chunk advisory remains.
node tests/canvas-conflicts-browser.mjs
# Passed: remote status without scene application; stale local save;
# distinct displayed/head/local-ack revisions; atomic conflict; legal subset;
# residual draft recovery; all three refresh choices; actual panned viewport.
node tests/canvas-draft-browser.mjs
# Passed: real two tabs/topics/workspaces, Chromium-simulated IME, drag boundary,
# recovery/discard and genuine same-field save failure. Physical OS IME untested.
node tests/canvas-resources-browser.mjs
node tests/canvas-save-browser.mjs
# Both passed.
node --test tests/canvas-conflicts.test.mjs
# Targeted repeat passed after strengthening the cold Runtime restart assertion.
```

TDD evidence: independent x-only CLI edit initially failed `Expected string`;
HTTP preview initially had no conflicts response; browser initially had no refresh
button; preview initially incorrectly offered a symlink resource operation. Each
was made green through its public boundary. An initial browser launch before the
isolated dist was built timed out; building the entry exposed the expected missing
refresh UI failure. These setup/red failures are not counted as acceptance passes.
The previous draft test's global stale-create rejection assertion was replaced
with genuine same-field competition, since compatible stale creates now succeed.

Coverage is the ticket's T08/T09/T24 save/refresh behavior, not complete cross-host
acceptance. Windows 10, Linux, physical IME, performance targets, semantic relations,
AI read-dependency authorization and end-to-end Codex/DSH loops remain separate
work. Native startup fixes were merged from integration, not duplicated here.

## Ticket 09: manual layout and visual discussion regions

Implemented: width/height, region membership, fixed-position flag and z-order use explicit field patches; standard Canvas array order carries stacking. Layout-only saves preserve knowledge source and existing metadata, with additive field-level edit provenance. Visual grouping creates no semantic edges. Browser drag/resize end in recoverable drafts and require Save. Selected relayout explicitly authorizes only the chosen cards, including fixed cards; other coordinates and layer order remain stable.

The DOM-free layout compiler uses deterministic 320 px width, bounded 120–600 px height and 24 px spacing. It preserves previous positions/sizes, prior array order and unseen nodes when the active input shrinks. Additions occupy available local space; exhaustion returns NO_LOCAL_SPACE and places the new card outside the bounds, with a visible suggestion to enlarge the area or explicitly relayout. Text is never truncated. Region membership is visual grouping; structured region-intent rules remain ticket 15 scope.

2026-11-18 Windows 11 / Node 25.8.1 / installed Chrome, real native Runtime:

- `node --test tests/canvas-layout.test.mjs tests/canvas-relations.test.mjs tests/canvas-conflicts.test.mjs tests/canvas-runtime.test.mjs tests/canvas-save.test.mjs tests/canvas-resources.test.mjs`: 19 passed. CLI/HTTP readback and fresh native Runtime reopen; compiler purity/determinism, fixed geometry, no-space diagnostics, prior stacking/unseen cards, field conflicts and provenance.
- `npm run build --prefix prototypes/whiteboard-integration`: passed; pre-existing large bundle warnings remain.
- `node tests/canvas-layout-browser.mjs`: real Chrome drag, resize handle, group/fix, layer-order reversal, no intermediate durable revision, explicit save/reload, local addition and selected relayout passed; real HTTP and disk, no interception or editor-state injection.
- `node tests/canvas-draft-browser.mjs` and `node tests/canvas-conflicts-browser.mjs`: passed. Draft test initially reused a stale viewport after full reload; fixed it to read the actual current viewport before dragging (local nonoverlap placement changes reload framing). Existing two-tab draft/Chromium IME and manual refresh/viewport coverage retained.

TDD evidence: layout public save first rejected Empty edit, compiler missing geometry and reordered/reduced active context first failed; corresponding slices passed after implementation. Sandboxed native launch failed spawn UNKNOWN; approved native execution passed. No Linux/Windows 10, physical IME, real Codex/DSH or performance/quality claims are made by this ticket.

## Ticket 08 — semantic relation editing

Implemented standard JSON Canvas edges and a semantic projection derived from those exact endpoints. Public `create-relation`, `edit-relation`, `delete-relation` operations share card patch publication, field baselines, conflict preview and explicit save. Edge label, ends, sides and original text survive reopen; blank labels classify as `related`, nonempty labels as `unclassified` (including bidirectional arrows, with no inferred mutual support). Card deletion removes incident relations and metadata in the same prepared publication. `deletionIntents` preserve deleted objects, revision and author; historical identities cannot be reused and a stale baseline cannot recreate a deleted endpoint pair under a fresh identity. Current explicit user creation after reading the deletion remains possible. Edge read dependencies reject stale semantic assumptions.

The Excalidraw bridge reads actual start/end bindings after pointer release; only arrows bound to two knowledge cards become semantic relations. The side panel also supports create, endpoint selection, reverse, label and delete. Edges participate in browser-local draft recovery, field acknowledgements, manual refresh and conflict-preserving merge. This ticket does not implement durable annotation serialization or arbitrary route-point exchange (ticket 10 / export work).

Validation on Windows 11, Node v25.8.1, installed Chrome, Excalidraw 0.18.1:

- TDD red evidence: new relation public test failed `Unknown board operation`; deletion test then failed because a stale fresh-ID edge was accepted; edge dependency test failed `Missing read dependency`. Implementations made each pass. Initial sandbox-only run failed `spawn UNKNOWN`; authorized native-process runs provide the actual results.
- `node --test tests/canvas-relations.test.mjs`: 4 public CLI/HTTP tests pass, including fresh Runtime reopen, cascade atomicity, durable deletion intent, current/stale relation dependencies, endpoint conflict preview, independent label merge, dangling endpoint rejection.
- Combined `canvas-relations`, `canvas-conflicts`, `canvas-save`, `canvas-runtime`, `canvas-resources`, `native-runtime` suites: 29 tests passed before adding the fourth relation test; final relation suite separately passed 4/4.
- `npm --prefix prototypes/whiteboard-integration run build`: TypeScript/Vite pass (existing large bundle advisory remains).
- `node tests/canvas-relations-browser.mjs`: real headless Chrome pointer selection and endpoint drag A→B to A→C, verifies unchanged committed endpoint before save, reload/recover edge draft, explicit save and reopen, public semantic endpoint C, custom original label, reversal, deletion and unbound-arrow non-semantic behavior. Uses read-only scene/viewport inspection to locate mouse coordinates; no API interception or editor state injection. Screenshot `canvas-relations-browser.png` is local evidence, not a committed binary.
- `node tests/canvas-conflicts-browser.mjs` and `node tests/canvas-draft-browser.mjs`: pass existing real-browser manual refresh, conflict/subset, viewport and draft isolation flows against relation-aware helpers.

These are real browser/native Runtime persistence tests with synthetic cards. Next-turn Organizer/host consumption is not yet implemented here; no claim of T03/T04 full real-host acceptance, Win10/Linux validation, physical IME, or model semantic use.


Final integration check: merged relation final `7cb3e38` and integration `034b46c`; the 8 layout/relation public tests and TypeScript/Vite build passed. Both `canvas-layout-browser.mjs` and `canvas-relations-browser.mjs` passed on the combined tree, including actual endpoint drag A→B to A→C. The working tree was clean at the integration check.

## Ticket 12: revision history and committed undo

Public CLI `history`, `history-preview` (stdin `{revision}`), `history-diff`
(stdin `{fromRevision,toRevision}`), and `undo` use the native owner. Protected
browser routes expose the same read-only previews and explicit POST compensation.
Undo requests identify the target revision, operationId, topic, manual author,
and `intent: "undo-committed"`. Only the original author can compensate a revision;
this is the same single-workspace local capability trust boundary as manual save,
not a multi-user login system. Retrying an identical request returns its receipt.

History UI is separate from current page state and input undo. It exposes stable
revision/operation identity, complete committed snapshots and field differences
including content, relation endpoints/semantics, provenance, layout/order and any
persisted editor extras. Committed undo creates a new revision. It reverses only
the affected fields and checks later revisions for conflicting writes (including
change-away-and-back), preserving unrelated later content. Deleted cards and their
cascaded relations/metadata can be restored with the same identities exclusively
through compensation; ordinary create still rejects previously used identities.
Deletion intent audit history remains retained. Graph/resource validation and the
existing prepared/publication transaction apply before confirmation. Full version
restoration and queue invalidation remain ticket 23.

Validation (Windows 11, Node v25.8.1, actual Chrome headless):
- `node --test tests/canvas-history.test.mjs`: 6 public native CLI/HTTP cases passed;
  initial history and undo tests failed with unknown runtime operation before code.
- `npm --prefix prototypes/whiteboard-integration run build`: passed (existing
  large-bundle warning).
- `node tests/canvas-history-browser.mjs`: actual keyboard/pointer save, history
  preview/diff, own committed undo, manual refresh, reload, delete/undo identity
  recovery passed. Local textarea Ctrl+Z restores typing without changing the committed revision. No application state injection.
- Existing save/conflict/relation/layout public regressions: 14 passed.
- No actual model/host integration, Windows 10/Linux, physical IME, accessibility
  audit, 10,000-revision latency or full restore acceptance is claimed here.

Combined with ticket 10 Runtime commit `1570f9d`: 9 history/annotation public tests, build and real Chrome history script passed. Extras sharing a knowledge-card identity compensate in a separate namespace without deleting its provenance; conversion undo restores exact multi-point routes/rotation and copy provenance remains visible in immutable history. An integration typecheck caught the newly extended operation union in the old identity helper; handling create-extra fixed it.

## Ticket 10 — native annotations, explicit conversion and independent copies

Native free shapes/text and unbound connectors persist in `CommittedBoard.editorExtras`
inside the same revision/intention/publication transaction as knowledge edits. They
are excluded from `canvas.nodes`, `canvas.edges` and semantic relations until explicit
conversion; a connector requires two valid knowledge-card bindings. Standard Canvas
is deliberately a degraded view (free drawing, precise bends and rotations omitted),
and the UI says so. Full project export remains a separate ticket.

Each native knowledge shape and bound label carries the same business identity.
Ctrl+D uses the new native container identity for a new card, retaining immutable
`derivedFrom` provenance and preserving the original record. Sidebar and native bound
text edits both reach that card. Unchanged truncated previews retain the complete
source body. Exact native points/rotation and unmapped shapes/text survive reopening.

`create-extra`, `edit-extra` and `delete-extra` operate on individual native elements;
concurrent changes conservatively conflict on the element field, while unrelated
objects still merge. Extra identities have their own overlay namespace, including
when a card visual shares a knowledge identity. Draft recovery, explicit save,
manual keep-and-merge refresh, conflict preview and history all include extras.
There is no scene overwrite endpoint or committed autosave. Capture and rendering
clone nested native data; pointer/text/multipoint gesture guards preserve the previous
completed draft when a subsequent gesture is interrupted. Unsafe native hyperlinks,
invalid geometry/route/binding/style payloads are rejected; incomplete supported
visuals are normalized by the native editor restore boundary.

Validation on Windows 11, Node v25.8.1 and actual headless Google Chrome:
- Red→green CLI/HTTP tests initially failed on unknown extra operation, missing copy
  provenance and accepting an unsafe hyperlink. All are retained as regression cases.
- `node --test --test-concurrency=1 tests/canvas-annotations.test.mjs tests/canvas-history.test.mjs tests/canvas-save.test.mjs tests/canvas-conflicts.test.mjs tests/canvas-relations.test.mjs tests/canvas-layout.test.mjs tests/canvas-resources.test.mjs tests/canvas-runtime.test.mjs`: 31 passed.
- `npm --prefix prototypes/whiteboard-integration run build`: passed; existing large
  bundle warning remains.
- `node tests/canvas-annotations-browser.mjs`: real native rectangle rotation,
  multipoint line and free text, explicit save/reopen with exact angle/points,
  explicit shape/text conversion, Ctrl+D identity/provenance, independent sidebar
  and native double-click text editing, interrupted-gesture draft recovery, and
  same-extra conflict after keep-and-merge refresh. No scene/state injection.
- Actual Chrome regressions passed: `canvas-relations-browser.mjs`,
  `canvas-layout-browser.mjs`, `canvas-history-browser.mjs`,
  `canvas-conflicts-browser.mjs`, `canvas-draft-browser.mjs`,
  `canvas-resources-browser.mjs` (all under `tests/`).
- Intermediate failures exposed mutable scene comparison, in-progress multipoint
  capture, and interrupted pointer capture. Immutable signatures, deep copies and
  explicit gesture lifecycle guards corrected them. Browser harness fixes targeted
  real visible borders/rotation handles and awaited editor/refresh readiness.
- No physical IME, clipboard cross-project transfer, accessibility audit, Windows 10,
  Linux, real model/host roundtrip, full export or performance acceptance is claimed.

## Ticket 13 — Topics and trusted current-session binding

Public native operations: `topics`, `topic-create` (`{name}`),
`connector-register` (`{id,host,versions,publicKey}`), `session-connect`,
`binding-enable`, `binding-status`, `binding-sources`. JSON goes on CLI stdin.
All operations use the existing native owner/capability and one owner queue.
Topic creation invokes the existing board publisher; metadata uses the same
`board.sqlite`. No second writable board or host transcript reader is installed.

`SessionConnector.verifyProof` is the host trust boundary. The supplied signed
adapter verifies Ed25519 proof with an explicitly installed host/version/public
key registration (native administrative capability only, never browser routes).
The private signing key stays in the adapter. A proof is `{connectorId,payload,
signature}`; payload is base64url JSON, signature covers that exact payload string.
Claims: host, version, instanceId, exact sessionId, stable workspaceId, role=primary,
scope (topic IDs or explicit `*`), calling turnId/cursor, nonce, issuedAt/expiresAt
(integer milliseconds, maximum five-minute window). Replay, expired/forged proofs,
unknown host/version, wrong workspace, child agents and organizers fail closed.
No recent-chat lookup exists; bare `verified:true` or session ID is not authority.
Only whitelisted identity/boundary metadata is persisted, never message bodies.

A valid handshake returns an opaque sessionToken; only its hash is persisted.
Use it for binding-enable/status. A connector may launch
`canvas.html#session=<token>`; the UI immediately removes the fragment and keeps
the token in workspace-keyed sessionStorage. Browser capability remains separate;
HTTP session routes expose topics/create-topic/connect/enable/binding, not trust
registration. Session tokens remain valid across daemon restart until a fresh
handshake for that exact host/instance/session rotates them.

Zero topics creates a named default; one auto-selects; several require explicit
selection. Existing binding repeats preserve source identity and initial boundary.
Switching freezes previous source metadata. Takeover first returns old identity,
backlog and a confirmation token; cancellation has no effects. Confirmation is
bound to requester, target, old source metadata/backlog, board revision and owner
epoch, expires in five minutes and is consumed on success. Stale previews fail.
Received cursor/turn counts/backlog are initially empty/zero; ingestion is ticket
14 and real Codex/DSH adapters are tickets 24/27. These are not host acceptance.

Validation on Windows / Node v25.8.1 / Chrome headless (2026-11-18):
- `node --test tests/topic-binding.test.mjs`: seven public Runtime/HTTP scenarios;
  creation and restart, single/multiple selection, concurrent default enable,
  signed proof adversaries/scope, same-session idempotency, stale takeover.
- `npm --prefix prototypes/whiteboard-integration run build`: passed; existing
  large chunk warning remains.
- `node tests/topic-binding-browser.mjs`: real UI creation/default selection,
  controlled precise host identity, takeover preview/cancel/confirm, topic switch
  and reload through real HTTP/native Runtime/SQLite, no fetch interception.
- Native regression selection `browser proxy|split UTF|simultaneous public starts`:
  three passed, preserving capability/origin checks and UTF-8 body handling.
- TDD red evidence: unknown topics/registration operation, unique-topic takeover
  failure and accepted replay; each corrected before proceeding. Browser harness
  initially clicked before operation completion; now waits for enabled controls.
- No real user transcript, paid model, host installation, Linux binding UI,
  screen-reader or full lifecycle/ingestion acceptance is claimed.

## Core review corrections (2026-11-18)

The review's two spec findings are fixed: card deletion checks every relation
actually removed by its cascade against the deletion's persisted baseline (also
when a refresh carries an older field overlay). New, relabeled and reconnected
incident relations therefore block the whole stale save. Acknowledged local
relation changes use explicit relation deletions with their own field baselines,
so the page need not refresh merely to delete a relation it just saved.

A shared pure `operations.ts` now orders creations/rewiring before endpoint
removal and applies card, relation, extra, cascade and stacking changes identically
in the Runtime, browser acknowledgement and keep-and-merge. It does not mutate its
input. Conflict/dependency/provenance and publication logic stay in the Runtime;
draft overlays stay in the browser. Structural dependency groups are validated
against their final graph; a failed rewire cannot leave its endpoint deletion in
the legal subset. Explicitly retained relations cannot be silently cascaded away.
Draft recovery has one parser with existing caller-specific error handling.

Red evidence retained: CLI stale relabel + deletion initially succeeded; HTTP
rewire + deletion initially failed with missing `fromNode`; an explicit relation
edit plus endpoint deletion initially silently removed that relation. Real Chrome
caught two further cases: keep-and-merge grouping lost historical endpoint
baselines, and deletion after a locally acknowledged label edit was over-rejected.
Both have passing regression assertions in `canvas-transaction-browser.mjs`.
The first sandbox run failed with native `spawn UNKNOWN`; authorized native runs
worked. A test-file generator initially used Windows GBK rather than UTF-8; no
product result is inferred from that harness failure.

Validation uses synthetic temporary projects, public CLI/HTTP and real Chrome
pointer/keyboard input, with no API interception or editor state injection.
An initial 33-test public regression suite passed; final additional relation cases
cover new attachments/reconnections, both request orders and safe subset intent.
The TypeScript/production build passed (existing large-chunk warning). Browser
regressions passed for transactions, native relations, layout, conflicts, draft
recovery and annotations. Detailed final commands/results are in the local tracker
`.scratch/collaborative-whiteboard/review-fixes.md`.
No real model/host roundtrip, physical IME, accessibility or performance claim is
made. This correction does not close any later implementation tickets.
## Ticket 05 — recoverable publication (2026-11-18)

Public `recovery-status` and `recover` commands and protected `/api/canvas/:topic/recovery-status` (GET), `/recover` (POST `{expectedHash}`) expose interrupted publication and explicit repair. The browser presents a recovery panel when reading/saving fails. Repair first preserves unknown bytes in a hash-named file beside the Canvas, then completes a pending save or republishes the last committed Canvas. The observed fingerprint must still match; unknown/corrupt content is never silently imported or discarded. This repairs physical publication, not historical version restoration (ticket 23) or external editing merge/import (ticket 35).

Bootstrap and edits now share one protocol: persist SQLite prepared state with FULL synchronous mode; write/fsync a reserved temporary file in the Canvas directory; recheck the baseline hash; atomic rename; confirm topic, immutable revision and operation deduplication together. Linux also fsyncs the directory. Public reads first reconcile known old/new hashes or return `RECOVERY_REQUIRED`/`SAVE_BLOCKED`, never an intermediate state. Old hash retries from durable material; new hash finishes confirmation without applying an operation twice. A confirmed retry returns its original receipt. Native owner retains the OS lock throughout publication. Four bounded attempts with 40ms between retries handle sharing/full-disk failures; the destination is never deleted to make rename work.

Fresh `.bang` roots use the native private-directory boundary (Windows current SID only, Linux 0700); fresh topic directories are 0700 and SQLite/temporary/Canvas/recovery files 0600 on Linux. Existing unrelated project ACLs are not rewritten. Capability tokens remain only in the private connection descriptor, never board state/recovery files. This is not a migration of previously broad data-directory permissions.

Q22 evidence: `tests/canvas-recovery.test.mjs` drives only public CLI/HTTP operations and documented files, actual native daemon kills at prepared/replaced/confirmed for both save and initial generation, fresh-owner reopen, success-receipt durability, unknown/corrupt preservation, fingerprint refusal, real Windows deny-delete sharing handle, and private Linux data. Fault injection replaces only controlled failure sources, not the commit chain: exact-workspace opt-in environment variables `BANG_PUBLICATION_TEST_PROJECT`/`BANG_PUBLICATION_TEST_FAULT`, fixed markers in that workspace, no public fault route or caller-selected write destination. Disk-full and confirm-full are controlled failures, not an actual filled filesystem. `tests/canvas-recovery-browser.mjs` uses real Chrome mouse/input events, protected HTTP, native daemon and filesystem.

TDD failures retained: recovery-status initially rejected Unknown runtime operation; process-kill test initially could not reach the configured prepared phase; HTTP initially lacked the stable RECOVERY_REQUIRED code. Each passed after its corresponding slice. A Python UI edit initially failed decoding UTF-8 under Windows GBK default and was rerun with explicit UTF-8; no partial UI edit resulted.

Validation on Windows 11 / Node 25.8.1: initial recovery/save/history run 21 passed, 1 Linux-only skipped; added real sharing-denial and confirm-full tests 2 passed. Frontend `npm --prefix prototypes/whiteboard-integration run build` passed (existing chunk-size warning). Real headless Chrome recovery, preserved corrupt bytes, edit/save and recovery reopen passed. Ubuntu 24.04.4 WSL2/ext4 with Linux Node 25.8.1, uid 65534: initial recovery suite 13/13 passed, including all process kills and private storage boundaries. Final expanded runs recorded below.

These results establish process-crash recovery on the tested systems, not power-loss durability, filesystem/SQLite cross-file ACID, Windows 10, a standalone Ubuntu release matrix, or actual Codex/DSH host consumption. External programs ignoring the lock can still race the final recheck/rename; arbitrary simultaneous external editing is not promised.

Final expanded Windows command: `node --test tests/canvas-recovery.test.mjs tests/native-runtime.test.mjs tests/canvas-save.test.mjs tests/canvas-history.test.mjs` — **36 passed, 0 failed, 2 Linux-only skipped; 38 total**, 63.5 seconds. Final expanded Linux recovery suite — **14 passed, 0 failed, 1 Windows-only skipped; 15 total**, 33.6 seconds. A final review moved prepared-material validation before both old/new-hash branches; replacement/confirmation/repair regressions were rerun after that change. No power-loss test was performed.

## Ticket 35 — standard Canvas exchange

Public commands: `export-canvas`, `import-preview`, `import-canvas` (JSON stdin for imports); protected HTTP routes use the same names. Preview a supplied `{canvas}` or `{external:true}` for the exact on-disk current.canvas. Confirm the returned preview with `operationId`, `author:{kind:'manual',id:'...'}` and `intent:'explicit-import'`. The returned topic, committed baseline revision, observed byte hash and candidate hash are checked again. An external modification does not become a committed read until explicitly adopted. Imported state applies through the shared operations module and publishes through the existing prepared-intent protocol. Original external bytes are preserved in a hash-named file before replacement; damaged and raced files are left untouched. Concurrent writers outside Bang do not share its lock; this is a checked import, not cross-application serializability.

Standard exchange preserves text/file/link/group nodes, standard color/subpath/group-background fields, exact Markdown, integer geometry, node/edge array order, identities, endpoints, sides, arrow ends and labels. Unsafe paths/URLs remain rejected and resources are not fetched. A group is a visual region. `knowledgeCards(canvas)` returns the shared narrowed knowledge projection; `visualRegions(canvas)` returns groups. Semantic relation projection requires node context and excludes group endpoints. Custom terms remain unclassified; unlabeled edges retain only generic related meaning.

Export strips editor-only extras and lists degradation (free annotations, exact bends, rotations and nonstandard node attributes). It is not a full backup of provenance, history, resources or extras. The editor provides file/JSON input, explicit candidate preview/confirmation, external-change adoption and a downloadable standard file with the degradation report before download. Group backgrounds are retained references, not automatically rendered/downloaded.

Validation (Windows 11, Node 25.8.1, real native daemon, temporary projects; user .bang untouched):
- TDD first `node --test tests/canvas-exchange.test.mjs`: failed at missing `import-preview`; then four exchange tests pass. External race initially returned HTTP 400; corrected RECOVERY_REQUIRED mapping to 409. All four pass including exact four-type roundtrip/reopen, HTTP file adoption/preservation, damaged input, unsafe resources, stale baseline and degradation.
- `node --test tests/canvas-runtime.test.mjs tests/canvas-save.test.mjs tests/canvas-relations.test.mjs tests/canvas-history.test.mjs tests/canvas-exchange.test.mjs`: 24 pass before the fourth exchange case was added.
- `npm run build`: TypeScript and production build pass; existing large-bundle warnings retained.
- `node tests/canvas-exchange-browser.mjs`: real headless Chrome gestures, preview with no revision change, explicit import, visual-region display, byte-content-equivalent downloaded standard JSON, real external file edit then explicit adoption, preserved original, no automatic resource fetch. Initial browser harness selector quoting and reload synchronization failures were fixed and retained here as test-harness failures.
- Not claimed: Windows 10 / Linux exchange browser matrix, real external editor applications, full backup (ticket 36), real model/host consumption, or cross-application simultaneous-write consistency.

Ticket 13 composition with ticket 05/core review: pending bootstrap topics remain
discoverable by name after publication failure; selection reconciles their durable
intent before binding. First binding-created SQLite uses the same Linux 0600 rule.
An added public failure/reopen test initially found zero topics and now passes.
Post-merge frontend build passed; seven binding tests pass. Recovery regressions
passed 14 with one Linux-only skip; the initial combined run retained the new
red topic-discovery test, then the corrected binding suite passed in full.
Both real Chrome binding and publication-recovery scenarios passed after the merge.
- Final integration: merged ticket 13 / `f3ce31f` at `693f9a6`; resolved additive CLI/HTTP/native dispatch conflicts while preserving the single-owner operation queue and session/binding routes. Final combined `node --test tests/canvas-exchange.test.mjs tests/topic-binding.test.mjs`: 11 passed. Final build and `node tests/canvas-exchange-browser.mjs` passed again on the merged tree.

## Ticket 36 — complete project backup and isolated restore

Public CLI commands: `backup-export --project DIR`, `backup-verify --project DIR`
and `backup-restore --project DIR`; the latter two read `{ "backup": PACKAGE }`
from stdin. Protected HTTP provides GET `/api/canvas/project/backup-export` and
POST `backup-verify` / `backup-restore` at the same prefix. The project-level UI is
available even without a selected topic: generate/download a package, select or
paste it, validate, explicitly restore, then open the new project. Single Canvas
exchange remains a separate operation with its own degradation report.

Version 1 is a bounded (48 MiB) JSON package containing a **logical SQLite database
snapshot**, attachment bytes and SHA-256 manifest. The native owner reconciles all
topics, reads all supported persistent tables in one SQLite transaction, and
exports current states, all revisions, confirmed intents, topic names, exact
completed source versions/gaps and editorExtras. It never copies a live database
main file. Current Canvas files are reconstructed from their committed state.
References in old revisions are included even when absent from the current board.
Existing missing resources are enumerated in the package and UI and remain missing
placeholders; the exporter does not claim to recreate missing bytes. Externally
changed Canvas or attachments detected during export cause refusal. This is not a
snapshot guarantee for arbitrary external writers ignoring Bang's owner boundary.

Verification checks the package digest, fixed table/column shapes and constraints,
current revision/hash consistency, standard Canvas and editor extras, exact
attachment manifest membership, hashes, duplicate paths and portable resource
paths. Restoration executes only local fixed schema SQL and parameterized rows,
never SQL supplied by the package. Digests detect corruption, not an untrusted
author's authenticity. Unknown future persistent tables cause explicit exporter
failure so a later feature cannot silently disappear from a backup.

Restoration creates a private, random new project below the authorized project's
`.bang/restored-projects/<uuid>` via an unpublished staging directory and rename;
it never accepts a caller-selected destination or overwrites another project.
It also works in a different empty authorized project using only the package,
with the original project unavailable. The returned `projectPath` is a normal
standalone Runtime root. Browser reopen selects only allocated UUID child paths,
rejects directory links and arbitrary path strings, and uses a fresh workspace
identity. Filesystem-wide project browsing is not added. Nested browser selection
is limited to eight restored projects.

Host registrations, session/proof/takeover capabilities, runtime connection files,
backfill grants and batch authorization receipts are excluded. Bound source
metadata and exact received source bodies remain, but sources are inactive and
old unprocessed queue entries are visibly frozen; no previous host authority or
work is automatically replayed. Ambient `.env`, `.git`, credential/runtime files,
unreferenced project files and browser-local drafts are not harvested. Referenced
attachments must use the existing safe, project-relative resource convention.

Validation (Windows 11, Node 25.8.1, synthetic temporary projects, native daemon):
- Fresh TDD red: first public export failed `Unknown runtime operation`; source
  restoration exposed no frozen count (`undefined !== 1`); a forged active source
  in a rehashed package was initially accepted. Each passed after its slice.
- First real Chrome UI test failed because the backup action was absent. A Windows
  Python helper later stopped on default GBK decoding; rerun used UTF-8. Initial
  browser assertions were strengthened to require a valid restore UUID and a real
  edit/save in the restored workspace with the original unchanged, avoiding a
  false positive from equal board content.
- On merged integration `f7a317c`, `node --test tests/canvas-backup.test.mjs
  tests/completed-turns.test.mjs tests/canvas-exchange.test.mjs
  tests/canvas-history.test.mjs`: **20 passed**, including four backup scenarios.
  Covers multiple topics, removed historical attachments, exact history/extras,
  original project moved offline, restart, signed synthetic source versions/gaps,
  frozen old work/capabilities, protected HTTP, corruption/missing entries,
  unsafe paths, directory junctions and external Canvas refusal.
- Frontend TypeScript/production build and real Chrome final results are recorded
  below after the final UI verification.
- No real host/model calls, Windows 10/Linux backup matrix, physical power loss,
  adversarial same-user filesystem races, large-project performance, archive
  encryption or formats above the explicit package size limit were validated.
  This ticket does not claim historical version restoration (ticket 23) or future
  organizer lifecycle/schema acceptance; those features must extend the snapshot
  registry and add their own restored-state tests when introduced.

Final ticket 36 UI verification on the merged tree:
- `npm --prefix prototypes/whiteboard-integration run build` passed; existing
  chunk-size warnings remain.
- `node tests/canvas-backup-browser.mjs` passed with real Chrome mouse/keyboard,
  package download, independent verification, explicit new-project restore,
  reopen, actual edit/save in that project, original project unchanged and reload.
- `node tests/canvas-exchange-browser.mjs` passed. The already-started
  `node tests/completed-turns-browser.mjs` initially timed out because the new
  frozen count interrupted an existing contiguous status phrase. Moving the
  count to the end preserved that phrasing; rebuild and the same unchanged test
  passed (real close/restart/browser-free receive/reopen).
- One backup browser harness run stalled without diagnostic output. Only its
  owned test process tree was terminated. The harness now bounds each CDP call
  to 15 seconds and closes HTTP connections during cleanup; the subsequent run
  passed. This is retained as a harness failure, not evidence of a product hang.
- Source implementation `62cb5b0`; latest integration `f7a317c` merged at `9a0605c`.
  Subsequent ticket 15 owns adding its future organizer tables/frozen attempt
  states and the corresponding public restore regression before its integration.
## Ticket 15 incremental Organizer

See [Organizer contract and evidence](ORGANIZER.md) for restricted execution, public task receipts, dependency fencing, common publication and controlled-model/browser limits.

