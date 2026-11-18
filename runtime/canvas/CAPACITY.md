# Retained history capacity — ticket 38

The public Runtime/JSON-stdin CLI exposes `history-capacity`, `maintenance-preview`
and `maintenance-confirm`; protected same-origin HTTP exposes the same operations.
The history panel shows database size, a 256 MiB warning threshold, revision storage,
and separately reported model attempts/tokens. Missing usage is explicitly counted.
The capacity refresh button also works after no-change Organizer attempts.

History grows with retained knowledge and sources. There is no automatic history,
source, attachment or user-file deletion. **Lossless compaction** and **complete
archive copy** are explicit preview/confirm actions. Compaction rewrites retained
snapshots into compressed history, deduplicates confirmed publication material,
removes only the publisher's reserved scratch files when no publication is pending,
and runs SQLite VACUUM. It preserves history, identity reuse fences, committed undo,
current answer pointers, source bodies and pinned ContextBridge records. An archive
is a downloaded copy; it does not remove the project. Preview validates the actual
archive and confirmation rejects changed database or attachment material. The
existing complete-backup format still has a 48 MiB expanded package limit; an
oversized package is rejected at preview. This is not unlimited archival storage.

## Storage contract

No tables or columns are added. `revisions.state` accepts existing plain snapshots
or `bang-history-v1` envelopes. New envelopes contain compressed checkpoints or
compressed field deltas against the previous revision, choosing the smaller encoding.
Every 64th revision is a checkpoint, limiting reconstruction to 63 deltas. JSON key
order and Unicode code units are preserved, including their effect on published
Canvas hashes. Newly introduced identities remain searchable without expanding all
history. Prepared publication material remains a complete standalone snapshot;
confirmation stores its state as an immutable revision reference in the same SQLite
transaction. Recovery still completes the existing prepared-file-confirm protocol.

All history, conflict baseline, undo, restore, context-change indexing and export
readers use the shared reconstruction seam. Logical backups expand both history
and confirmed intent references into the original closed schema; their existing
authority-freezing and restore validation remain unchanged. Old plain snapshots
remain readable and are converted only by explicit compaction or ordinary new saves.

Publication diagnostics use two reserved files, each at most 8 KiB; records contain
only timestamp, event and revision, never prompts or source text. These diagnostics
are disposable, separate from durable history. Native worker scratch continues to
be removed after confirmed process exit. Unexpected external Canvas copies remain
preserved under the existing recovery policy and are not silently cleaned.

## Validation

Windows 11 Home China, Node v25.8.1, AMD Ryzen 7 7840H, 29,734,326,272 bytes RAM.
Public Runtime/CLI/protected HTTP use actual packaged native ownership and SQLite.
Actual headless Chrome exercises preview/cancel/confirm, archive download and
verification, old revision preview and reload. No real model, personal conversation,
credential, global configuration or native binary change is involved.

RED/GREEN: unknown capacity/maintenance operations; archive confirmation initially
accepted changed attachment bytes. Public regressions now cover those boundaries,
64-revision checkpoint crossing, Unicode history, immutable preview, backup,
stale-preview rejection, actual reserved scratch reclamation, user-file retention
and undo after reopen. The first string-prefix delta attempt produced only
checkpoints for leading revision-number changes; the retained assertion led to
field deltas. A failed build first found a missing worktree dependency junction;
using the existing shared dependencies fixed it without reinstalling packages.

`node --test tests/history-capacity.test.mjs tests/canvas-history.test.mjs tests/canvas-backup.test.mjs tests/canvas-restore.test.mjs tests/context-delivery.test.mjs`
passed 45 public tests before the final additional attachment-preview test; the
capacity suite then passed all three tests. This includes real kill/reopen restore
and independent ContextBridge authority coverage. Final integration checks and the
10,000-turn run results are recorded below when completed.

`node tests/history-stress.mjs <report-path>` is the reproducible T19 driver. It
submits 10,000 distinct signed CompletedTurns, retries all 100 deliveries for dedup,
and configures 100-turn Organizer batches. The controlled native worker creates one
knowledge card per batch, citing its selected source; all 100 sources receive durable
processing receipts. This produces 100 revisions, 100 cards, zero edges and zero
attachments, with 100 native worker attempts and **zero real model calls**. It writes
real worker scratch, verifies exit/cleanup, samples file counts, checks rotated log
bounds, reopens revisions across checkpoints, compacts explicitly, and validates a
complete archive containing all sources. It is not ticket 39's separate 1,000-node /
3,000-edge / 10,000-revision latency benchmark and makes no p95 claim.

An initial changing-single-card workload failed at the third batch: the second
semantic edit had withdrawn self-read dependent evidence, so the controlled worker
incorrectly attempted to recreate an identity absent from the safe context. That
failure remains in the local report; evidence validity was not weakened. The workload
was corrected to incremental unique cards. An unoptimized source-detail lookup also
showed growth (100 turns: 6.316 s; 1,000: 77.635 s; 2,000: 196.955 s). The lookup now
uses the existing binding/turn index instead of reading every unrelated topic source
for each selected batch member. Multiple-version, namespace, backfill and recovery
semantics are regression-tested separately. Timings include native calls and runtime
setup; other validation was active, so these are observed throughput, not a frozen
latency comparison.


## Integration checks

Merged ticket 34 at `6070d03` (integration `d375b70`): build and 17 public
reorganization/capacity tests passed; actual Chrome maintenance rerun passed.
Merged ticket 37 at `14183c2` (integration `4faf052`): build and 15 public
legacy-migration/backup/capacity tests passed. Additive CLI/HTTP routing and legacy
deletion-intent fences are retained. No shared dependency target was removed.
The source identity optimization separately passed 28 tests spanning answer
versions, namespaces, historical backfill, actual publication kill and reopen.
The three final capacity tests additionally prove that explicitly compacting an
expanded restored 71-revision database reduces its actual file bytes and preserves
revision 64, and removes a 32,768-byte previewed publisher scratch file while
retaining an unrelated user notes file.

The unoptimized comparison was intentionally ended after 4,900 received and
organized turns (zero backlog), with its last periodic sample at 4,000 turns /
563.290 seconds / 6 files. This is **not** a completed T19 run. Its disposable
native owner was paused/stopped explicitly; the first failed workload owner was
also stopped. The optimized complete run's first part overlapped this comparison
and test/build activity, so observed timings must not be used as a fair speedup or
p95 result. Source hashes in the complete report identify the starting executable
sources; final persistence checks reopen under the latest merged code.


A subsequent optimized run still failed after 5,300 turns had durably organized:
its public caller hit the unchanged five-second Runtime request deadline. The
failure report and starting source hashes are retained; it is not acceptance.
Review then found `finishOrganizer` invoking full-topic `turnStatus` inside each
selected source's `.some` callback (100 full scans per batch). Final code reuses
one source-currentness/pending snapshot within the existing owner queue and one
connection for batch source detail reads. The scalar public source lookup still
uses the same reader and exact namespace/version semantics. No timeout was raised
for ingestion, status or normal saves. Seven targeted replacement, namespace,
restore and actual-kill regressions passed after each optimization stage.
An intermediate batch-connection run was intentionally ended at 2,600 organized
turns to rerun cleanly with the repeated-scan fix; its partial measurements are
retained separately, not called a complete run.


## Completed T19 evidence

The final full source pipeline received and organized **10,000** distinct completed
turns with zero backlog, 100 controlled native attempts, 100 Organizer revisions,
100 cards, zero edges and zero attachments. The 10,000th-turn checkpoint was
326.871 seconds after setup began (about 30.59 completed turns/second for this
specific batched workload). Its unchanged five-second normal-request bound did not
fail. Some status calls were close to that bound (maximum recorded 4.980 s); this
is not evidence of a latency guarantee or the ticket 39 performance target.

| Observation | Actual result |
| --- | --- |
| Files at 100, 1,000, …, 10,000 completed turns | 6 at every sample |
| History at Organizer revision 100 | 101 rows: 99 deltas, 2 checkpoints |
| Encoded revision bytes / corresponding expanded JSON bytes | 204,497 / 11,407,081 |
| Database before / after explicit compaction | 13,606,912 / 12,034,048 bytes |
| Actual database space reclaimed | 1,572,864 bytes (1.5 MiB) |
| Worker scratch / publisher scratch remaining | none |
| Complete archive verified after compaction | 101 revisions, 10,000 sources, no attachments |
| Real model calls / synthetic reported tokens | 0 / 0 |

After stop/reopen, revision 1 and the checkpoint-boundary revision 64 retained
expected text and the first source retained its original answer. Compaction and
complete archive verification preserved those histories and source counts.

The driver's initial final assertion incorrectly expected two diagnostic files:
101 publication records were only **8,071 bytes**, below the unchanged 8,192-byte
rotation limit. The full pipeline and archive had already completed successfully;
that assertion failure remains in `38-stress-final-report.json`. Two additional
explicit public **manual layout saves**, clearly separate from the model rounds,
then crossed the limit. Actual files were 81 and 8,152 bytes; stop/reopen still
showed 10,000 organized sources and revision 64 correctly. The additional complete
archive verified 103 revisions (bootstrap + 100 Organizer + 2 manual), all 10,000
sources and zero attachments. `38-stress-final-verification.json` records that
supplement as passed. The reproducible driver now includes those two explicit
rotation-validation saves instead of assuming the round batches fill the log.

Local raw reports are retained under `.scratch/collaborative-whiteboard/`:
`38-stress-failure-self-dependency.json`, `38-stress-unoptimized-partial.json`,
`38-stress-optimized-report.json` (5,300-turn caller timeout),
`38-stress-batched-partial.json`, `38-stress-final-report.json`, and
`38-stress-final-verification.json`. They are intentionally not source artifacts.
The final source pipeline used the `14183c2` integration tree plus the subsequently
committed source-reading optimization; exact codec/ingestion/Organizer/Runtime
and controlled-worker SHA-256 values are in its report. The final four capacity
regressions pass, including legacy JSON key ordering through restore/backup.

This establishes the stated Windows synthetic batched capacity scenario, not
10,000 model calls, 10,000 publication revisions, real model quality, both real
host integrations, arbitrary attachment growth, cross-platform behavior, full
power-loss behavior, screen-reader/zoom coverage, or unbounded archival capacity.
