# Historical board restore — ticket 23

`restore-preview --project DIR --topic ID` accepts JSON stdin `{revision}` and returns the current baseline, target revision and exact preview fingerprint. `restore-version` accepts that result plus `{operationId,author:{kind:"manual",id},intent:"restore-version"}`. Protected HTTP exposes the same POST operations. The history panel displays the historical state before offering an explicit restore button; unsaved drafts block restoration. Success reports a new revision and requires manual refresh. Old revisions remain addressable. Reusing the identical operation returns its original receipt; stale previews and reused identities with different content fail.

The new revision retains historical content, relations, metadata (including source provenance, conditions and uncertainty), geometry, annotations and basis state. It records the selected historical revision and preserves deletion audit history. Current answer-version pointers are never rolled back: historical support that is now superseded remains withdrawn by the common evidence projection. The historical original remains inspectable. Restoration is not a new factual verification.

The existing SQLite transaction atomically freezes pending source work, revokes old task eligibility and conversational authorization, freezes proposal authority, and persists the common prepared publication intent. File replacement/confirmation and crash reconciliation use the existing publisher. A blocked replacement can leave old work safely frozen while recovery is required; it cannot leave an old attempt authorized against the restored board. In-flight transports may finish under their existing bounded lifecycle, but their output cannot publish. No database transaction or owner queue is held for a model wait. New completed turns continue from the unchanged receiving cursor and restored board. Source identities, batch deduplication, original text, current-version pointers and prior processing receipts remain durable.

`organizer-control` with `{topicId,action:"reanalyze",sourceIds:[...]}` explicitly selects frozen **current** sources, without ingestion or old command authorization. The UI offers these source identities by turn/version. Existing Organizer enable/pause/budget policy still applies. A former task is retained as archived (its scheduling uniqueness key becomes `archived:<taskId>`); its `sourceId` and actual CompletedTurn identity remain unchanged. A fresh task receives a new task/attempt/publication identity. Other frozen sources remain frozen. Superseded versions cannot be selected as current support.

Committed undo of a restore compensates affected content and knowledge metadata into the current board, preserves unrelated later geometry, and refuses later conflicting human/knowledge changes. It does not undo queue/source/proposal fencing. Shared source-currentness validation also runs after compensation. Immutable ContextBridge turn snapshots and delivered receipts are untouched; the next utterance sees the restored revision.

No new tables are introduced. Complete backup accepts the explicit frozen/superseded task states, retains archived receipts and freezes imported authority under its existing closed schema. Context-turn and Codex executor backup/security contracts from tickets 22/25 remain intact.

## Evidence

Windows 11, Node 25.8.1, packaged native Runtime/SQLite, real CLI/protected HTTP, actual headless Chrome. Sources and executor responses are synthetic/controlled. No personal conversations, real model call, credentials, global configuration or native binary rebuild.

RED/GREEN: unknown restore operation; old backlog still pending; unsupported selected-source reanalysis; restore compensation failed to preserve historical basis metadata. Each was observed before implementation and now has a passing public regression. A backup assertion initially assumed a `status` field instead of the documented `valid` result and was corrected. Chrome driver initially typed into an offscreen card and later raced page reload; scrolling actual controls into view and waiting for the new page fixed those harness failures. Actual application operations still use real UI/HTTP/Runtime/storage, with no mocked API or injected state.

Initial restore/history suite: **18 passed**. After merging integration `8e462628793537473dfba4efc79a57be63ad0068`, the joint command below passed **89 tests**, no failures/skips. Two additional focused tests passed for immutable pinned context across restore, and old proposal/conversational authorization remaining frozen across restore/undo/reanalysis.

```
node --test --test-force-exit tests/canvas-restore.test.mjs tests/context-delivery.test.mjs tests/canvas-backup.test.mjs tests/human-intent.test.mjs tests/organizer-controls.test.mjs tests/source-versions.test.mjs tests/canvas-history.test.mjs
npm run build --prefix prototypes/whiteboard-integration
node tests/canvas-restore-browser.mjs
```

The crash scenario actually kills the owner after Canvas replacement, reopens through the public Runtime, and verifies one restored revision, frozen backlog and an identical JSON-stdin CLI retry receipt. Tests also cover stale previews, source-currentness, unchanged reception cursor/dedupe, later fresh turns, reanalysis after an old running attempt, preserved task history, backup validation, and compensation conflicts. TypeScript/Vite production build passed with the existing chunk-size warning. Actual Chrome verified historical preview → explicit new revision restore → compensation undo → manual refresh → reload, retaining immutable historical states.

Not claimed: real Codex/DSH model use, Windows 10/Linux full matrix, hardware power-loss persistence, performance acceptance, or automatic factual re-evaluation. Frozen-source selection is covered through public Runtime; its checkbox UI is built but not separately exercised by this Chrome scenario.
