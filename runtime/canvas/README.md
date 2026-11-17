# Canvas runtime: explicit text-card saves (tickets 02–03)

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
edits and deletes text cards. Its in-memory edits do not change committed state.
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
  operations are `create-card`, `edit-card` (text only) and `delete-card`. A patch
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

Synchronous publication prevents interleaving within one process. **Do not run
competing writers** until ticket 04 adds native project ownership. Prepared failure
blocks subsequent writes and preserves recovery material; automated crash recovery,
stronger bootstrap publication and platform durability/fault testing belong to
05. The bootstrap writes its initial file before its metadata, so interruption can
require recovery. Draft persistence/IME belongs to 06; field merge to 07; history
navigation to 12. Text-only standard Canvas is intentionally enforced; other types
and edges are rejected rather than silently discarded. See the
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

## Ticket 06 draft evidence (2026-11-18)

- `npm run build` (companion): passed, existing large-chunk advisory remains.
- `node tests/canvas-draft-browser.mjs`: real headless Chrome / real HTTP middleware / temporary project filesystem. Red: recovery prompt timed out before implementation. Green: explicit recover/discard after reload; text and pointer-up drafts; two pages and two topics isolated; stale save retained original baseline and draft; committed read excludes drafts. Chromium `Input.imeSetComposition` tested unfinished and finalized Chinese composition; this is simulated browser IME, not physical Windows IME.
- Browser test performs DOM inspection and CDP input; no React state injection or API interception. Programmatic reload does not create drafts. Only pointer-end coordinate movement is mapped in this ticket; complete layout operations belong to ticket 09.
- Browser-local recovery uses localStorage by topic and editor identity (`window.name`). An existing editor offers its own draft; a newly opened editor can explicitly copy another editor's retained draft from the recovery list. Clearing browser storage removes these local drafts. Cross-version merge is not implemented: recovery retains the original revision, so stale save fails atomically.
- API/CLI regression: `node --test tests/canvas-save.test.mjs tests/canvas-runtime.test.mjs`.
- Untested: physical OS IME, native Windows 10/Ubuntu and real host loop, quota/device-loss durability, cross-origin/port browser storage migration. No user `.bang` data was used.
