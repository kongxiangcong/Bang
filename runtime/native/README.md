# Project runtime (ticket 04)

`node runtime/canvas/bang.mjs start|status|stop --project DIR` controls one native daemon per canonical project. Existing generate/read/state/commit commands use that daemon; the HTTP adapter also forwards every storage operation. Closing pages/CLI clients does not stop the daemon. `stop` is explicit; there is no startup registration.

Ownership is a held OS lock, not file existence, PID liveness or a heartbeat lease. Windows uses CreateFileW sharing denial: both helper and daemon retain the inherited lock handle. A noninherited Job handle kills the daemon when its helper dies. Linux source uses flock followed by exec with the lock FD retained. Discovery can be stale without granting ownership; acquisition retries never unlink the lock. Workspace identity persists; every successful native owner increments epoch, creates a new instance identity and rotates its random capability. Old capabilities and epochs are rejected.

The loopback-only daemon exposes POST /control with JSON {command,topic,input}; callers need exact Host, matching Origin when present, x-bang-token and x-bang-epoch. The private connection descriptor is `.bang/runtime/connection.json` (not a log). `start/status` omit the daemon token. Runtime directory creation removes inherited Windows ACLs and grants the current SID; POSIX mode is 0700 and descriptors 0600. Symlinked runtime paths are refused. No runtime writes go to the installation directory.

Browser middleware uses a separate memory-only capability. GET /api/canvas/session/bootstrap checks loopback peer, exact local Host, Origin and Sec-Fetch-Site; it returns only browser token and stable workspaceId. Every data/mutation route requires x-bang-browser-token. There are no CORS headers. The canvas-client helper bootstraps this capability; it never receives the daemon token. Local same-user processes remain trusted; this is not a sandbox against a malicious account owner.

## Build and evidence

The prebuilt Windows x64 helper is built from lock-host.c with MinGW GCC (`CC=... node runtime/native/build.mjs`). It needs no compiler at runtime. SHA256: 9127E4917168CD753CB04A5606DB24F6BBDB222343A15498B8A6D45449FDD16C. Linux distributors must build/package the Linux helper using GCC before installation; automatic runtime compilation is intentionally absent.

2026-11-18, Windows 11 / Node 25.8.1:

- Red: initial CLI start failed Unknown command; missing browser capability initially returned 200, expected 403.
- Real public-process tests cover repeated start/restart, Chinese/spaced project paths, separate project data/capabilities, daemon/helper death, in-flight request loss and restart save, stale discovery with a live lock, browser Host/Origin/token rejection, and readonly installation/private runtime ACL.
- Existing CLI/HTTP Canvas regression tests are updated to obtain browser capability and stop test daemons before deleting fixtures.
- Failures retained in the implementation record: fetch normalizes Host (raw HTTP probe now used); graceful HTTP stop can precede native lock release (bounded native acquisition retry); Windows generic deny W also denies read (readonly fixture uses precise write rights).

Linux source is implemented but **not native Linux tested**. The only discovered Linux surface is WSL2 SchedResearch-R12, which has neither node nor gcc on PATH; it is not native Ubuntu acceptance. Windows 10 and packaged Linux runtime remain unverified. Ticket 04 stays claimed until required platform acceptance is supplied. Job control here only supervises the daemon; model worker cancellation and descendant policy belong to later executor work. Prepared publication recovery remains ticket 05.


Final Windows validation: `node --test tests/native-runtime.test.mjs tests/canvas-runtime.test.mjs tests/canvas-save.test.mjs` — 15/15 passed (8 native, 7 Canvas); `npm --prefix prototypes/whiteboard-integration run build` passed (existing large-chunk warning; resource-status export awaits ticket 11 integration); `node tests/canvas-save-browser.mjs` passed real headless Chrome create/save/reload/edit/delete. Six simultaneous starts converged on one instance/epoch. Split UTF-8 at both HTTP boundaries and valid topic named session passed. No native Linux claim.

## Startup diagnostics follow-up (2026-11-18)

Independent integration runs retained two failures of the first native test at its post-stop `start`: `Native runtime startup failed`; isolated reruns passed. The exact cause remains unconfirmed. No retry of non-contention exits or weakening of OS ownership was added.

Startup failure now reports helper exit/signal and, when available, a fixed startup stage plus a numeric OS or symbolic Node error code. The helper explicitly inherits standard handles so daemon diagnostics reach the launching CLI. Capture retains at most 2048 characters in memory and only emits the structured stage/code, never raw stderr, file contents, project paths, capabilities, or environment. No diagnostic file is written. Setup stages distinguish lock open, Job setup, process creation/resume, identity read/publication, listen, and discovery publication. Resume failure terminates the suspended daemon instead of waiting forever.

The stop/lock path was inspected: HTTP stop can precede handle release; the existing bounded exit-73 acquisition retry remains. The daemon inherits the Windows lock, the supervisor retains its own handle, and Job close kills the supervised daemon. Lock files are never removed or used as proof of ownership. No demonstrated ownership race was found.

Validation retained: sandbox execution failed 14/15 with `spawn UNKNOWN` / loopback `EACCES`; this is distinct from the reported native startup exit. Elevated unchanged baseline passed 15/15. Public CLI corrupt-identity diagnostic test failed with the original generic error, then passed with `exit=1; stage=identity-read; code=INVALID_JSON`; native lock-path setup test failed with missing stage, then uses the rebuilt helper. Twelve immediate stop/start cycles verify fresh epochs, stable workspace identity and retained saved data. The first diagnostic suite passed 17/17. These passes do not erase the original intermittent failure or establish its root cause. Windows 10 and native Linux acceptance remain outstanding.

Final rebuilt-helper validation: `node --test tests/native-runtime.test.mjs tests/canvas-runtime.test.mjs tests/canvas-save.test.mjs` passed 18/18 in 50.6 seconds on Windows 11 / Node 25.8.1, including both diagnostic fixtures and 12 restart cycles. Helper SHA256 above matches the tested binary.

### Discovery publication failure reproduced and bounded

Post-merge validation with `tests/canvas-resources.test.mjs` added failed 20/21: helper-death restart emitted `exit=1; stage=discovery-publish; code=EPERM` at native-runtime test line 56. This failure is retained, not replaced by earlier green runs. The original pre-diagnostic post-stop failure cannot be conclusively equated with it because its stage/code was discarded.

A deterministic Windows public CLI fixture opens the old connection descriptor with ReadWrite sharing but denies delete sharing. Restart failed with that same discovery-publication EPERM before the fix. This establishes a reproducible replacement-sharing failure mechanism; the process that held the file during the spontaneous failure remains unidentified.

The native owner now retries only atomic metadata rename on Windows EPERM/EBUSY/EACCES for up to two seconds, yielding 50ms between attempts. Both identity and discovery metadata use this policy. The destination is never deleted, and the helper/daemon retain OS ownership throughout. Persistent failures still report the final stage/code; other errors fail immediately. Discovery replacement has a separate stage from temporary-file writing. No helper-exit retry was added beyond existing lock-contention handling. A 1.8-second sharing fixture changed from red to green; an 8-second sharing fixture checks bounded refusal rather than indefinite retry. All tests use disposable projects and no model work.

After the bounded replacement fix, merged integration validation: `node --test tests/native-runtime.test.mjs tests/canvas-runtime.test.mjs tests/canvas-save.test.mjs tests/canvas-resources.test.mjs` passed 23/23 in 59.8 seconds, including transient recovery, persistent refusal, 12 restart cycles and helper-death recovery. Integration base included `517037f`. No remaining Windows failure in this bounded run; no claim of universal flake elimination.
