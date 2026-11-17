# Project runtime (ticket 04)

`node runtime/canvas/bang.mjs start|status|stop --project DIR` controls one native daemon per canonical project. Existing generate/read/state/commit commands use that daemon; the HTTP adapter also forwards every storage operation. Closing pages/CLI clients does not stop the daemon. `stop` is explicit; there is no startup registration.

Ownership is a held OS lock, not file existence, PID liveness or a heartbeat lease. Windows uses CreateFileW sharing denial: both helper and daemon retain the inherited lock handle. A noninherited Job handle kills the daemon when its helper dies. Linux source uses flock followed by exec with the lock FD retained. Discovery can be stale without granting ownership; acquisition retries never unlink the lock. Workspace identity persists; every successful native owner increments epoch, creates a new instance identity and rotates its random capability. Old capabilities and epochs are rejected.

The loopback-only daemon exposes POST /control with JSON {command,topic,input}; callers need exact Host, matching Origin when present, x-bang-token and x-bang-epoch. The private connection descriptor is `.bang/runtime/connection.json` (not a log). `start/status` omit the daemon token. Runtime directory creation removes inherited Windows ACLs and grants the current SID; POSIX mode is 0700 and descriptors 0600. Symlinked runtime paths are refused. No runtime writes go to the installation directory.

Browser middleware uses a separate memory-only capability. GET /api/canvas/session checks loopback peer, exact local Host, Origin and Sec-Fetch-Site; it returns only browser token and stable workspaceId. Every data/mutation route requires x-bang-browser-token. There are no CORS headers. The canvas-client helper bootstraps this capability; it never receives the daemon token. Local same-user processes remain trusted; this is not a sandbox against a malicious account owner.

## Build and evidence

The prebuilt Windows x64 helper is built from lock-host.c with MinGW GCC (`CC=... node runtime/native/build.mjs`). It needs no compiler at runtime. SHA256: FCBAF4A9CC1075D623AA0AC7F4D6A896FB338F8AB1B792A23EE1B52C4C5FE129. Linux distributors must build/package the Linux helper using GCC before installation; automatic runtime compilation is intentionally absent.

2026-11-18, Windows 11 / Node 25.8.1:

- Red: initial CLI start failed Unknown command; missing browser capability initially returned 200, expected 403.
- Real public-process tests cover repeated start/restart, Chinese/spaced project paths, separate project data/capabilities, daemon/helper death, in-flight request loss and restart save, stale discovery with a live lock, browser Host/Origin/token rejection, and readonly installation/private runtime ACL.
- Existing CLI/HTTP Canvas regression tests are updated to obtain browser capability and stop test daemons before deleting fixtures.
- Failures retained in the implementation record: fetch normalizes Host (raw HTTP probe now used); graceful HTTP stop can precede native lock release (bounded native acquisition retry); Windows generic deny W also denies read (readonly fixture uses precise write rights).

Linux source is implemented but **not native Linux tested**. The only discovered Linux surface is WSL2 SchedResearch-R12, which has neither node nor gcc on PATH; it is not native Ubuntu acceptance. Windows 10 and packaged Linux runtime remain unverified. Ticket 04 stays claimed until required platform acceptance is supplied. Job control here only supervises the daemon; model worker cancellation and descendant policy belong to later executor work. Prepared publication recovery remains ticket 05.
