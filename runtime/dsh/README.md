# DSH current-Session connector — ticket 27

Pinned host: **DSH 0.2.1-rc.2**. Actual native Windows and native Linux/WSL
Session acceptance passed with a **controlled loopback model**. This is actual
Agent/Session/tool/persistence behavior, not mocked host APIs, and not external
service inference. Independent merger review decides the ticket status.

## Activation and authority

`node runtime/dsh/prepare.mjs PROJECT` provisions a project-local Ed25519 trust
anchor, private key, manifest and overlay in `.bang/runtime/dsh`. It does not
launch DSH, edit a host profile, copy credentials or inspect conversations. The
key inherits the Runtime private directory. Load the reviewed overlay with the
supported pinned launcher: `dsh --profile headless --patch ABSOLUTE_OVERLAY
--json -`, or compose it into a reviewed interactive profile. A test must set a
child-only isolated `DSH_HOME` before launch; even help rewrites generated config.

The actual root Agent invokes `bang_enable` after the user requests activation.
`requireInitiator`, live registry/root membership, Session header cwd, and the
observed `turn/start` supply identity and boundary. Model arguments cannot supply
session IDs, paths, cursors, signing keys or timestamps. Multiple topics require
explicit selection; repeated enable preserves the original source and calling
boundary. The installed project scope does not grant another workspace access.
Loading an overlay in a new process does not attach it to this Codex chat or an
existing DSH desktop process. The manifest identity persists across DSH restarts.

Session event/checkpoint listeners are registered through each exact root
Agent's scoped Context. They retain only turn-boundary metadata before enable;
child-Agent events are not a primary discussion. No recent-session lookup or
production `eventAt`, `snapshotEvents`, or `ownEvents` calls exist.

## Completion and lifecycle

The adapter reads only the bound Session through public `sessionQuery.readEvent`
with zero context windows, starting at the durable Runtime cursor. SessionQuery
may internally replay a whole log; Bang only receives the requested range. It
captures a cut before `ctx.sessions.flush(session)` and requires a participating
durability listener. Live events, text streams and `agent/turn-stopping` are not
completion receipts. Only a matching `turn/end` with reason `completed`, user
origin input and a final assistant message without tool calls enters the queue.
Reasoning, tool results, child output and injected `bang-context` user messages
are excluded. Aborted/interrupted/error turns leave visible gaps; missing useful
text leaves a missing-record gap. Positional user/assistant replacements fail
closed until a verified replacement-version mapping exists.

A browser-independent timer handles continuing sessions. A scoped `session/flush`
listener also drains reception before normal headless exit: it awaits the public
`sessionPersistence.flush()` durability barrier, then signs bounded ingestion
batches. That public service barrier drains routed writers without reading other
Session bodies. AsyncLocalStorage distinguishes the timer's own flush callback
from a host checkpoint and prevents recursion/deadlock. A host checkpoint joins
any older timer work and drains all full batches before returning. Persistence
failure cannot advance the Bang cursor. There is no private Session backend or
second board writer.

Signed `session-connect`, `binding-enable`, `binding-status` and `turn-ingest`
use the existing native single writer. Runtime restart, DSH restart and temporary
plugin absence retain authorized replay/deduplication. When DSH is absent, no
independent remote reader is claimed; re-enabling that exact Session recovers
its authorized range. Stopped reception returns before any body query; explicit
resume submits a fresh signed metadata boundary after durability, excluding the
disabled interval. Public queue-control tests cover this boundary.

## Reproducible checks

- `node --test tests/dsh-session-connector.test.mjs tests/completed-turns.test.mjs tests/source-switch.test.mjs`
- `node tests/dsh-session-installed.mjs` is an explicit actual-host acceptance
  script. It creates fresh temp project/home directories, disables real credential
  stores, instructions, unrelated tools, auxiliary model calls and retries, and
  supplies only a nonsecret placeholder to an in-process loopback provider.
  The provider asserts the exact visible tools and never forwards requests.
- Windows defaults to the installed Electron launcher and its official CLI entry.
  Linux sets `BANG_DSH_AUDIT_BINARY` to native Node and
  `BANG_DSH_AUDIT_PREFIX` to JSON `["/absolute/@deepseek-ai/dsh/lib/bin.js"]`.
  Every invocation verifies `--version` equals 0.2.1-rc.2.
- Linux acceptance ran on ext4 as uid65534 (nobody), using the existing official
  pinned package and bundled native ELF helpers; no binary rebuild or new global
  installation. WSL is Linux evidence, not a substitute for Windows acceptance.

## Native evidence — 2026-11-18

Windows 11 / harness Node25.8.1 / installed DSH0.2.1-rc.2 with bundled Node24.21.0;
Ubuntu24.04.4 / WSL2 SchedResearch-R12 / native Node25.8.1 / uid65534:

| Actual-host observation | Windows | Linux |
|---|---|---|
| Initiating root invokes bang_enable twice; calling turn durably received before exit | pass | pass |
| Same persisted Session + fresh Runtime/host retains source identity and deduplicates | pass | pass |
| Plugin unloaded for a completed authorized turn, then re-enabled; persisted catch-up | pass | pass |
| Actual child Agent invokes bang_enable and gets root authorization rejection | pass | pass |
| Injected self-context and child answers excluded from primary stored source | pass | pass |
| Host forcibly killed during provider request; resume records interrupted gap | pass | pass |
| Controlled provider401 yields error gap, later completed turn still received | pass | pass |
| Different cwd cannot bind; exact rejection observed, original sources unchanged | pass | pass |
| Runtime stop/reopen retains seven received root turns | pass | pass |

Each successful native matrix used **22 local requests**, seven received turns,
one interrupted gap and one provider-error gap. No existing credentials, real
external inference, global configuration changes or user's conversations were
used. Retained example projects:

- Windows: `C:/Users/72449/AppData/Local/Temp/bang-dsh-session-native-gCZAcX/project`, Session `session-789a43f4-3884-4468-90e5-3fe2137cf904`.
- Linux: `/tmp/bang-dsh-session-native-yFU0pN/project`, Session `session-6816fbf3-53e4-4a7e-b78e-638d3c260d31`; staged source `/var/tmp/bang-ticket27-native-W9KCzv`.

Windows and Linux public regression before final full-batch hardening each passed
**21 test executions** (the source-switch test imports six ingestion tests, so
those six run twice). The final checkpoint-specific failure/concurrency and
101-turn drainage tests pass after merging `4faf052`.

## Failures retained and corrections

- Initial actual headless run exited successfully after two local provider
  requests but Bang received zero turns: the one-second timer lost the race.
  The public durability checkpoint now drains before exit; actual native tests
  independently observe the persisted queue after the process is gone.
- Real crash recovery uses `reason.kind=interrupted`, which was initially
  mislabeled error. Mapping now retains an interrupted gap.
- A 101-turn checkpoint test initially received only100; a host checkpoint now
  drains successive bounded batches, unlike one ordinary timer tick.
- The controlled child/inject fixture initially omitted public UserMessage IDs;
  it now supplies identified role/user messages. A fixture creation listener
  accidentally returned a disposer (truthy), short-circuiting later listeners;
  it now returns no value. These were fixture failures, not fabricated passes.
- Linux SIGTERM was handled gracefully with exit0. Crash testing now explicitly
  uses SIGKILL. A Linux shell quoting/CRLF setup failure was corrected; accidental
  copied `/runtime` and `/tests` directories were compared byte-for-byte to this
  task's files before removal. No existing Linux project was deleted.
- Earlier preview tests retained missing-module, idle-Agent admission, failed
  terminal labeling and unsupported replacement RED observations. The first
  isolated plugin import could not resolve a bare host package; public raw
  `tools.register` + JSON Schema avoids that undeclared dependency.

## Scope still outside this ticket

No actual external-service inference, Windows10 certification, desktop profile
reload UX, performance benchmark, historical-backfill UI, Organizer execution or
ContextBridge behavior is claimed here. Source replacement is visibly unsupported
rather than silently advancing over it. These limits remain in their owning
cross-ticket/release scope; a controlled model does not invalidate the actual
native SessionConnector evidence above.

Final merged verification (`4faf052`): the combined public suite passes **22/22
on Windows and 22/22 on native Linux**, zero failures/skips, including both
checkpoint regressions. The six imported ingestion tests execute twice as noted
above. No frontend implementation changed; no new build is needed for these
Node-only adapter/tests/documentation changes. `git diff --check` is clean.

## Next-turn context delivery — ticket 29

Run the project-local prepare command again when upgrading from ticket 27. It
retains the connector identity and provisions a distinct Ed25519 ContextBridge
key. A successful root `bang_enable` stores the topic locator for this exact
Session under the Runtime private directory. After process restart the owner
checks the signed current workspace, binding, topic, host instance and Session
on each context call. A stale locator cannot authorize another topic. Loading
the adapter does not authorize an unbound root, child Agent or other cwd.

On DSH 0.2.1-rc.2 the scoped `turn/start` event submits the committed-state cut.
The first `agent/pre-step` containing real user input adds that cut as a sourced
user message to the accepted host decision. Tool continuations do not inject it
again. Only seeing the exact message ID, source and content in the root Session
satisfies the delivery receipt. Acknowledgement persists through the existing
signed owner operation. Model-use status remains unknown. DSH retains earlier
messages in the transcript, so the envelope identifies the current revision and
states that it supersedes earlier whiteboard data. The automatic message is
excluded from completed user input.

The model-visible read-only tool `bang_context_query` retrieves bounded item,
change, withdrawal and source pages from this turn. It never exposes the turn
token or signing key. The native envelope budget is 16 KiB. Delivery has a
1500 ms deadline with up to another 200 ms for recording failure. On timeout
the conversation proceeds with an unsynced notice and manual knowledge-context
fallback. The editor's context status and explicit current-board read are the
user-visible recovery paths. A pre-step that the host rejects cannot produce a
successful delivery receipt. Conversation reception and Organizer configuration
remain separate.

### Native acceptance, 2026-11-18

`node tests/dsh-session-installed.mjs` uses the ticket 27 isolated launchers
and disables credential stores. Both actual Windows 11 and Ubuntu 24.04.4
WSL2 Linux x64 (ext4, uid65534) ran the pinned DSH with a deterministic local
provider. Each run checked 25 model requests, including the ticket 27 recovery
cases, and eight received turns before the final Organizer scenario.

- An ordinary “What should we use?” after an explicit save sent Option B and the
  deletion of the obsolete premise in the model request. The actual DSH final
  text was “Use Option B.” and the persisted receipt recorded revision 2.
- A synthetic host middleware saved a new value after utterance start, before
  step assembly completed. An 18,013-character card exceeded the envelope
  budget. The real model tool round trip read the earlier PINNED_DETAIL value.
  The newer RACED_DETAIL never appeared in the scoped query result.
- A 1.8 s pre-step delay exceeded the delivery deadline. The provider saw the
  unsynced notice, conversation continued, and the owner retained unsynced.
- A controlled Organizer produced a source-linked conclusion. An explicit
  manual premise edit then invalidated it. The next ordinary question sent
  the conclusion ID as withdrawn, omitted it from usable cards, and the actual
  DSH final text returned “Current decision: Option D.”
- Retained Windows project: `C:/Users/72449/AppData/Local/Temp/bang-dsh-session-native-aJYy80/project`.
  Linux: `/tmp/bang-dsh-session-native-Ftitgs/project`, staged in
  `/var/tmp/bang-ticket29-native-p42H7m`.

The provider derives its bounded answer deterministically from the observed
request. This establishes the native transport, tool and response path. It
does not establish the behavior of the external DeepSeek model. No existing
accounts, credentials or external inference were used. Formal model-quality
and Windows 10 acceptance remain open.

The first actual Windows regression failed because the provider received no
board at all. The first WSL staging command expanded a nested shell variable
incorrectly. Both misplaced staging copies were verified by creation time and
recursive file comparison, then relocated intact under
`/var/tmp/bang-ticket29-first-stage-lC88qx`. A script with LF encoding and
an explicit ext4 temp directory completed the native run. Direct WSL launch
as nobody selected the nologin shell, and a PATH-only runuser invocation could
not resolve the executable. An absolute /usr/sbin/runuser invocation corrected
the regression-suite launcher.

Joint public regressions on Windows and Linux both passed 27/27 with zero
skips, using `node --test --test-force-exit tests/dsh-session-connector.test.mjs
tests/context-delivery.test.mjs`. These include foreign scope/replay rejection,
restart, source replacement and independent-key checks.

The final build defers reading the independent bridge key until a bound
root turn so a missing bridge key can degrade without taking down reception.
Both native 25-request matrices passed again after this change. Final retained
projects: Windows `C:/Users/72449/AppData/Local/Temp/bang-dsh-session-native-aSIUfz/project`,
Linux `/tmp/bang-dsh-session-native-qhX8SS/project`.
