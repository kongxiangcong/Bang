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
