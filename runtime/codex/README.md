# Codex source adapter — ticket 24 (partial, not accepted)

Pinned executable/server protocol: **0.169.0-alpha.11.1**. The PATH CLI 0.130.0 is rejected. This implementation is a candidate for receiving completed turns; it does not enable an Organizer or context delivery. Ticket 24 remains **claimed** until normal host trust and real completed-turn reception on the required surfaces are demonstrated.

## Implementation and public boundaries

`CodexSessionConnector` accepts a trusted host transport and independently registered Ed25519 key. `register`, `enable(UserPromptSubmit, {scope, topicId?, confirmation?})`, and `poll(topicId, sourceId)` use only the public Bang Runtime commands from tickets 13/14. The installer, not a browser request, owns the private key. No `verified:true` shortcut exists. Test transport is an external host substitute, not real Codex evidence.

The reviewed project hook accepts only the exact explicit user prompt `Bang: enable current session`. Other prompts and Stop events return `{}` before opening host state or reading the installation manifest. On activation it requires the host's `CODEX_THREAD_ID` to equal the hook `session_id`, a primary exact thread, pinned version, paginated history and canonical matching workspace. It binds the hook's `turn_id`, even when UserPromptSubmit runs before that turn is persisted. Host hook/environment identity availability remains a real-validation gate; missing fields fail closed.

The public stored-history API is read through a separate `app-server --stdio` process. It never calls start/resume/fork/list-thread methods. This is **not live desktop attachment**. The transport allows only exact-thread metadata and exact-turn items. `thread/read` returns a `preview` in its full host response: the transport immediately drops it along with all non-whitelisted fields; it is never printed or persisted. Earlier history is not requested as items. Metadata pagination searches only the already-known thread for the exact authorized boundary, with a bounded page count. No rollout parser or latest-chat lookup is implemented.

`completed` plus finite `completedAt` is required before reading turn items. The actual independent reader reports an active subagent turn as `interrupted` with `completedAt:null`, so that projection and Stop are explicitly insufficient. Completed user text and exactly one `final_answer` become the signed batch; reasoning, tool output, commentary and async deliveries are excluded. Ambiguous multiple-user/final, non-text user content, absent phase, missing boundary and unsupported versions fail closed. Terminal error/interrupted with a completion timestamp leaves a gap, without reading its items. Actual terminal timestamp behavior is not yet validated against a trusted real hook.

Runtime's source/cursor/queue transaction is the only durable progress authority. Cursors retain turn/final identity and content hash. Restart re-derives the host's public page anchor, repeats the boundary safely, detects reused final identities with changed text, and accepts distinct final IDs. A changed answer at the latest checkpoint is revisited; discovering regeneration of arbitrary older turns is not yet implemented. Missing already-received boundaries report unavailable rather than silently skipping. Explicit history-backfill UI/adapter enumeration is not provided by this ticket's current implementation.

The native owner starts a 10-second asynchronous watcher outside its publication queue. `codex-watch` adds an exact source, `codex-watch-status` exposes waiting/idle/unavailable status. Keys and watcher metadata are fixed files in the private `.bang/runtime` directory; no raw host response cache is written. Owner stop closes the reader and prevents a new owner from being spawned by in-flight polling. Inactive source bindings are checked before opening a reader. This watcher does not implement ticket 16 stop/re-enable interval policy yet.

## Concrete normal-trust review procedure

Preparation is explicit and does not install or trust a host hook:

```powershell
node D:/dsh-proj/Bang/runtime/codex/prepare.mjs D:/dsh-proj/Bang/.scratch/codex-24-acceptance
```

It provisions one project-local Bang key, registers its public key and writes `.scratch/codex-hook-review/hooks.json` and human-readable `command.txt` under that acceptance workspace. It never copies Codex credentials or edits global Codex configuration. Existing preparation is not overwritten. The Windows command uses an encoded PowerShell invocation to preserve literal paths; `command.txt` shows exactly what the encoding runs. Review `hook.mjs`, `connector.mjs`, `transport.mjs`, `watch.mjs`, and the generated command/config together. Use final integrated source paths before trusting; changing definitions requires review again.

After reviewing those files, install **only in the isolated acceptance project**, preserving any existing project hooks (the prepared acceptance project has none):

```powershell
New-Item -ItemType Directory -Force D:/dsh-proj/Bang/.scratch/codex-24-acceptance/.codex
Copy-Item -LiteralPath D:/dsh-proj/Bang/.scratch/codex-24-acceptance/.scratch/codex-hook-review/hooks.json -Destination D:/dsh-proj/Bang/.scratch/codex-24-acceptance/.codex/hooks.json
& $env:CODEX_APP_RUNTIME_CLI_PATH -C D:/dsh-proj/Bang/.scratch/codex-24-acceptance
```

In that native CLI test session, use normal project trust and `/hooks` review; approve the exact generated UserPromptSubmit command. Desktop's documented equivalent is Review hooks / Settings > Hooks, but the installed desktop UI and discovery are not verified here. Do not use `--dangerously-bypass-hook-trust`, `--trust`, or change global config to skip review. The user's normal host trust decision is the remaining human action, not permission to read unrelated sessions.

Once trusted, submit exactly `Bang: enable current session`, then two short ordinary prompts. Check `bang.mjs codex-watch-status --project ...` and `turn-status`/`turn-source` for the exact binding, calling turn and original final answers. Close all browser tabs, continue, restart Bang, and verify cursor/replay. Native CLI evidence must be labeled CLI; it does not prove existing desktop activation. Multiple-topic/takeover selection currently returns a clear message; the adapter accepts the standard explicit selection/confirmation inputs but the simple hook entry does not yet present that UI.

## Actual evidence, 2026-11-18

- Windows 11 x64 build 26200; Node 25.8.1. `$env:CODEX_APP_RUNTIME_CLI_PATH --version` confirmed 0.169.0-alpha.11.1. `app-server generate-ts --out .scratch/codex-protocol` generated the exact local public types used, including Thread, Turn, MessagePhase and pagination. Generated schemas are temporary investigation artifacts, not vendored dependencies.
- `app-server daemon version` and `app-server proxy` initialization failed at the default control socket with Windows **OS 10050**, both sandboxed and approved unsandboxed. No daemon start/restart/config changes followed.
- Actual `app-server --stdio` initialization and exact `thread/read {includeTurns:false}` succeeded. Subagent metadata had `parentThreadId`; root independently ran the same probe and confirmed the primary current thread (`source:vscode`, `parentPresent:false`, exact ID match, paginated, status:notLoaded). No unrelated thread was requested, and no response text was printed/stored. This is a working public persisted-metadata route, not live-session attachment or completed-turn acceptance.
- Actual metadata-only `thread/turns/list` for this active subagent returned `interrupted`, null completion time, zero items. This failure of live-status inference is retained and drives waiting behavior.
- Five controlled-host/public native Runtime tests passed on Windows. The earlier 4-test adapter plus ingestion/binding combination passed **17 tests**. Initial reds: missing module, missing terminal gap, silently changed reused final ID, and prompt hook preceding persistence. A test-edit command failed on Windows GBK decoding; UTF-8 was made explicit and tests rerun.
- Same **5 controlled-host tests passed** on real Linux Node 25.8.1 and packaged ELF helper, Ubuntu 24.04.4 WSL2 `SchedResearch-R12`, ext4 `/var/tmp/bang-ticket24-controlled-20261118`, uid nobody, using the existing ticket04 Node installation. This is Linux process/adapter evidence with synthetic Codex, not a Linux real-host demonstration or standalone Ubuntu release acceptance. Initial non-escalated WSL enumeration was denied; approved isolated run succeeded.
- Concrete preparation was executed in `D:/dsh-proj/Bang/.scratch/codex-24-acceptance`, creating private Bang key/registration and review files only. Disabled hook with a sentinel prompt returned `{}` even for a nonexistent project path. Daemon then stopped. **No host hooks installed or trusted, no paid/model request, no actual completed chat ingestion**, no credentials copied, no global config modified.

Remaining gates: normal hook trust/execution on pinned native host, correct host environment identity, actual complete/interrupt/regenerate/paging durability semantics, Windows/Linux real source samples, installed Ubuntu and Windows 10 matrix, historical backfill/older regeneration policy, full lifecycle stop/re-enable integration, and next-turn context delivery in its separate ticket. Source and controlled results do not close these gates.

Primary references: [official hooks](https://learn.chatgpt.com/docs/hooks) for review and unstable transcript/Stop semantics; [public App Server](https://learn.chatgpt.com/docs/app-server) for read-only paginated stored history. Local generated version-pinned types, rather than latest docs alone, determined this implementation's field names. Prior read-only reports: `native-host-exploration.md` and `executor-readiness.md` in the task's visualization directory; new observations above supersede only their missing public-read route, not their real-acceptance limits.
