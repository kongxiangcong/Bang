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

## Completed Windows reference measurement

All six nearest-rank p95 targets passed on source `260e2e2`, which includes
integration `113d7bb`. Each condition used ten discarded warmups and 100 retained
samples. Times below are in milliseconds. The raw observations and recorded
source hashes are committed in [T32-SAMPLES.json](T32-SAMPLES.json).

| Condition | Save p95 (≤ 1,000) | Refresh p95 (≤ 3,000) | History preview p95 (≤ 3,000) | Sample maxima, same order |
|---|---:|---:|---:|---|
| Idle Organizer | 523.6 | 1,165.8 | 816.0 | 1,621.8 / 1,686.0 / 921.0 |
| One Organizer awaiting model | 454.1 | 1,132.2 | 890.2 | 599.8 / 1,244.5 / 1,130.5 |

One idle save took 1,621.8 ms and exceeded one second. All requests succeeded.
Each condition reopened the same stopped 10,000-edit project and checked every
card's frozen ID, geometry, type and final text, every edge, all 3,000 semantic
relations and the 10,000 public operation IDs in revision order. Each ended at
revision 10,110 after its separate measurement saves. The frozen source's
published database occupied 40,665,088 bytes. Its project data occupied
41,117,785 bytes across seven files. After measurement the idle copy used
41,208,881 bytes and the blocked copy used 43,379,761 bytes.

**Reference conditions.** Windows 11 Home China, AMD Ryzen 7 7840H (16 logical
CPUs), 29,734,326,272 bytes RAM, Node v25.8.1, headless Chrome 157.0.8103.52
at 1440×960 with hardware acceleration disabled. The Windows Balanced power
plan was active (381b4222-f694-41f0-9685-ff5bb260df2e). CPU time across the
whole shared system averaged 34.58% busy during the idle run and 28.00% during
the blocked run. Other development activity was possible. This difference in
machine load prevents treating the two conditions as a speedup comparison.

**Peak working sets.** The native Runtime peaked at 253,607,936 bytes idle and
365,383,680 bytes blocked. The largest Chrome process peaked at 2,525,208,576
and 2,535,739,392 bytes respectively. The driver and middleware process peaked
at 139,911,168 and 178,216,960 bytes. These are OS lifetime peaks per process;
a synchronized whole-process-tree memory peak was not measured.

**Compilation and model time.** The headless compiler took 19.54 ms in the last
separate compile observation. Generating and durably publishing revision zero
through the original fresh native owner took 1,014.35 ms. The frontend production
Vite phase reported 22.91 s on the final build used for these samples. The idle
run issued zero model requests. The blocked run held exactly one controlled
loopback model request for 262.09 s, checked its continued connection after
every trial, and issued zero external calls. Real inference time was zero.
The two official runs followed dataset generation with disjoint fresh Chrome
profiles and no concurrent seed generator.

The full local logs are `.scratch/collaborative-whiteboard/39-frozen/generation.jsonl`,
`idle-55zmgS/report.json`, and `blocked-F4eeB0/report.json` under that run directory.
Windows is the measured reference. These timings do not establish Linux or other
hardware performance, real-model latency, arbitrary attachment behavior or a
per-request guarantee.
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
durable files into separate projects for each condition. Both conditions start from the same 10,000-edit history. Each condition then
accumulates its own warmups and samples. Each sample issues a different explicit manual edit. The
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
The optional `pilot` argument is a wiring check on an independently generated or copied partial
history. Its two samples never count toward acceptance.

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


A first actual Chrome regression attempt missed the first textarea: its reported
y coordinate was 1,767 in an 804-pixel viewport. History and edge-drag harnesses
now scroll each real control into view and locate only card body textareas, as the
page also contains unrelated textareas. The drawing test uses the actual canvas
bounds after scrolling. The history edit/undo/reload and edge endpoint drag/draft
recovery/save/reopen regressions both passed after repairing those observations.
At 4,700 actual durable edits, the intermediate idle wiring check completed
all three trials. Its cold save was 1.081 s; measured pilot saves were 0.810 and
0.797 s, refresh 1.930 and 1.965 s, and history 1.221 and 1.167 s. This overlapped
the independent generation job and is retained separately from acceptance.

On the Windows reference machine, 20 direct `whoami.exe /user` invocations averaged
53.41 ms before returning the same process owner identity. The native client now
looks up that SID once per process. It still applies the original directory ACL
on every connection and checks the same project path, epoch and capability. The
4,700-revision blocked pilot completed with one controlled model request and no
external calls. It is a wiring check, not a fair speedup comparison: the inspector
build and concurrent load also changed between development runs.

## Integration verification after measurement

Ticket 26 integration `5fe6358` is merged at `c8e9518`. It changes the shared
native routing and context-preview UI. The combined production build passed
(Vite 21.89 s). All 11 focused public history and Codex-context tests passed.
Actual Chrome verified controlled signed context delivery, hook output, unsynced
and manual fallback behavior and reopen. A fresh copy of the 10,000-edit dataset
also passed three full blocked-condition save/refresh/history smoke trials,
including the complete frozen geometry, text, relation and ordered receipt
checks. Its separate raw report is `39-frozen/blocked-pMkLwG/report.json`.
The 220 formal measurements above retain their original source identity.
