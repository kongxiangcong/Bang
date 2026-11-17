# Ticket 27 — pinned DSH SessionConnector (preview; acceptance incomplete)

`prepare.mjs PROJECT` provisions a project-local Ed25519 trust anchor, private key,
manifest and reviewed overlay under `.bang/runtime/dsh`. It does not launch DSH,
change its profiles, copy credentials, or inspect chats. The key inherits the
Runtime's private directory. Run with the packaged Node that supports `node:sqlite`.
The manifest authorizes this project and its topics, not other workspaces.

Load the generated overlay with the supported DSH 0.2.1-rc.2 launcher:
`dsh --profile headless --patch ABSOLUTE_OVERLAY --json -` (or compose it into a
reviewed interactive profile). An isolated test must set **child-process-only**
`DSH_HOME` first; headless help also rewrites its generated profile. Never point a
probe at the normal home or copy its credential store. Headless disables managed
GUI credentials by default; GUI sign-in does not establish headless access.

The actual initiating root Agent invokes `bang_enable` after the user's request.
There are no model-provided session IDs, workspace paths, timestamps or cursors.
The host's `requireInitiator`, exact live registry membership, roots membership,
Session header cwd and observed `turn/start` supply identity and boundary. No
recent-session selection or deprecated `eventAt` / `snapshotEvents` / `ownEvents`
is used. Loading the overlay into another process does not activate this Codex
chat or an existing DSH desktop session.

The plugin retains only turn boundary metadata before enable. Once enabled, its
browser-independent timer reads the exact Session through public `readEvent`
with zero context windows from the bound cursor. SessionQuery may internally
load the complete log; the adapter only receives the authorized event bodies.
It captures the cut before `ctx.sessions.flush(session)` and requires the returned
`true` durability-participant receipt before signing batches. Mere live events,
assistant streams, final-looking text and `agent/turn-stopping` are not completion.
Only `turn/end` reason `completed` with user-origin text and a final assistant
message without tool calls enters the queue. Reasoning/tools/injected user text
are excluded; aborted/error/blocked/max-token turns leave gaps. Missing useful
text leaves a missing-record gap. Positional source replacements fail closed;
verified regenerated-answer lineage remains unfinished rather than silently
advancing the cursor over a replacement.

Signed public `session-connect`, `binding-enable`, `binding-status`, and
`turn-ingest` operations use the existing native single writer. Runtime source
cursors provide replay/deduplication after Runtime restart and after re-enabling
the same Session with this persistent manifest. Repeated enable preserves the
original source and calling boundary. Topic selection remains explicit. The
adapter currently has one active Session per plugin instance; takeover UI and
historical backfill are not added by this plugin. It never accepts an unverified
current-session claim from the browser.

## Evidence — Windows 11, Node 25.8.1, 2026-11-18

- Controlled public Runtime tests: `node --test tests/dsh-session-connector.test.mjs`.
  Four tests cover completion/flush, durable queue source content, repeat enable
  and Runtime restart, child/self filtering, default history exclusion, failed
  turns and later successful turns, and fail-closed positional replacement.
- Combined public regression before the final replacement test: 16 passed across
  DSH, completed-turn ingestion and topic binding. Native helper launch initially
  failed with sandbox `spawn UNKNOWN`; authorized native execution passed.
- RED observations retained: missing module; idle Agent incorrectly accepted;
  aborted turns mislabeled missing-record; unsupported replacement accepted.
  Each was fixed before moving to the next slice.
- Installed DSH `0.2.1-rc.2`, bundled Node 24.21.0, actual isolated-home launcher:
  help passed; schema import first failed because an external module could not
  resolve `@deepseek-ai/dsh-tools`. The plugin now uses public raw `tools.register`
  with JSON Schema and explicit argument validation; schema import passed.
- Actual isolated DSH boot with the model runner disabled and a probe waiting for
  `ctx.tools.schemas()` to expose `bang_enable` printed `BANG_DSH_PLUGIN_READY`
  and exited 0. This proves the plugin loads with the shipped tools, SessionQuery
  and persistence services. It does **not** prove any real model conversation.

## Outstanding acceptance

No real user DSH initiating turn, model request, Windows/Linux conversation
matrix, desktop reload, host-exit timing, or actual restarted-Session replay has
been exercised. The host timer is not an independently authenticated remote
Daemon reader: when DSH exits, reception waits for that exact Session to be
re-enabled. Immediate host disposal before the timer tick is not validated;
persisted final turns should be replayable on next enable but this needs a real
host test. Source format replacements deliberately stop reception. There is no
claim that this supplies Organizer execution or context delivery (28/29).

The ticket stays **claimed**, not resolved. A reviewable overlay exists; genuine
acceptance next needs an authorized DSH session with supported authentication,
then an independent Linux DSH installation. No credential/trust bypass or
substitute Codex session can close those gates.

Final integrated verification: merged integration `f181fe1` (Codex connector) into
`9fae3af`; `node --test tests/dsh-session-connector.test.mjs tests/codex-connector.test.mjs tests/completed-turns.test.mjs`
passed **15/15**, zero skipped. `git diff --check` passed. Ticket 16's pending
reception-stop/resume contract must add the metadata-only branch before body reads;
this preview does not claim its not-yet-integrated controls.
