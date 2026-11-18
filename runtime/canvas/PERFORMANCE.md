# Frozen large-board performance

Ticket 39 uses the reference dataset and conditions from `baselines/whiteboard-v1/`.
The generator submits all 10,000 frozen text edits to a native owner over its
authenticated public control interface. Every save independently commits a durable
revision through the normal prepared/file-replacement/confirmation path. Revision
zero is the compiler's bootstrap. The 1,000 nodes and 3,000 directed relations have
no attachments. A fresh owner verifies each card's expected text before resuming
an interrupted generation. The JSONL progress records and free-space checks run
every 50 revisions. Creating a file named `pause-generation` beside the progress
log requests a graceful pause. Remove that marker before resuming.

## Reproduce

Build the production frontend in `prototypes/whiteboard-integration` with
`npm run build`. From the repository root use an empty directory on a drive with
at least 4 GiB available.

```powershell
node tests/performance-generate.mjs D:/path/to/t32 10000
node tests/performance-browser.mjs D:/path/to/t32 idle
node tests/performance-browser.mjs D:/path/to/t32 blocked
```

The browser driver verifies the generation owner has stopped before copying its
durable files into separate projects for each condition. Every measured sample
therefore starts from the same 10,000-edit history plus that condition's preceding
warmups and samples. Each sample issues a different explicit manual edit. The
browser driver measures from the protected save request to its parsed commit
receipt. It then clicks Refresh, checks the displayed revision, the changed native
label and the complete 5,000-element Excalidraw scene, and waits through a painted
frame. History selection traverses independent historical revisions, using the
actual preview button. Its GET-to-frame timing includes immutable snapshot, diff
and restore-fingerprint delivery and rendering. Both render timings use the
browser's resource start time. All snapshot text remains available in the page.
The measured save excludes editing time. The history timing excludes opening the
history list and choosing a revision.

Each condition executes ten warmups followed by 100 samples and uses the 95th
sorted measurement. One Organizer in the blocked condition holds a real request
open at a controlled loopback model boundary. The driver checks this throughout,
counts requests, and records the elapsed blocked time separately. Real inference
time is zero. No user project, credentials or external provider are involved.
Output includes the 110 rows, failures, memory samples and per-process peak
working sets on Windows. Per-process peaks can occur at different times.
The optional `pilot` argument is a wiring check on an independently generated
ten-revision board. Its two samples never count toward acceptance.

## Measurements during development

- The first 70 public revisions took 89.523 seconds, with 1.505 s at revision 50.
  That run reopened an authenticated client session per operation. The generator
  now reuses one authenticated session. Browser samples still use the production
  HTTP middleware. Later generation rates are throughput observations with
  changing code and competing development workloads.
- A 50-save CPU profile on the full board found whole-document clones and repeated
  historical reconstruction on the current head. The current snapshot supplies
  current-head conflict checks, older field baselines still reconstruct history,
  and only privately owned working copies receive mutable edits. Node and edge
  IDs are indexed for repeated endpoint validation and evidence comparisons.
  Recorded 50-save profile durations were 12.857 s, 9.665 s, then 7.701 s.
  CPU profiles are diagnostic runs outside the frozen latency measurement.
- The lossless delta writer compares keys in order in one traversal. Deletes,
  additions, order changes and exact checkpoint replay preserve the original
  snapshot and Canvas hash. The reader parses its checkpoint only once while
  applying up to 63 deltas. A partial SQLite index locates prepared publications.
  Durable sync and recovery checks remain on the normal publication path.
- The relation inspector originally expanded 3,000 pairs of 1,000 endpoint
  options. The inspector now pages relation editors, cards and history controls
  while the drawing always receives the whole scene. All items retain their
  original indices. Snapshot text uses independently laid out chunks.
- An early ten-revision actual Chrome pilot under concurrent seed generation
  measured history at 3.114, 3.068 and 3.193 s, above target even at this short
  history. Detailed preview now returns snapshot, adjacent diff and the existing
  restore fingerprint from one read. The previous public history and restore
  operations keep their existing return shapes. The public regression first
  failed because the detailed result had no diff and passed after implementation.
- A controlled restart at durable revision 2,001 made the in-flight generator
  receive a connection failure. The progress log retains it. The next run read
  and checked the durable head before continuing.

The initial build attempt read UTF-8 source with the machine's GBK Python
default and did not apply the planned change. The source was subsequently
updated with UTF-8 and rebuilt. Sandbox denial for the local dependency junction
was resolved with the scoped permission. Chrome uses its own fresh local profile;
all runtime projects and raw reports stay outside tracked source.
