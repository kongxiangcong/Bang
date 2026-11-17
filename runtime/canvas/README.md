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
