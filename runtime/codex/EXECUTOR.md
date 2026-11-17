# Codex Organizer executor — ticket 25

Status: partial / claimed. Windows actual isolated-model publication and UI passed. Linux actual CLI capability/authentication failures and controlled process behavior passed; Linux model-service connectivity and an independent Linux login remain missing. This does not establish the current-chat connector (24), context bridge (26), or full release matrix.

## Owner configuration and boundary

Before starting the native project Runtime, explicitly set `BANG_ORGANIZER_CODEX` to JSON:

```json
{"version":1,"executable":"ABSOLUTE/PATH/TO/codex","authHome":"ABSOLUTE/AUTHORIZED/CODEX_HOME","model":"gpt-6.1-sol","inheritProxy":false}
```

The supported executable reports exactly `codex-cli 0.169.0-alpha.11.1`. The selected model must exist in that binary's bundled catalog. No model/provider fallback occurs. Optional `prefixArgs` supports an owner-vetted native launcher; it is not accepted from browser/HTTP/control requests. The adapter and executable are trusted local code, not a sandbox for arbitrary supplied executables. Simultaneous native and Codex executor configurations are rejected.

The native supervisor launches the Node adapter in its private attempt directory. It retains Windows Job / Linux process-group ownership over the actual CLI and descendants. Task input travels as JSON over stdin, never in a shell command or argument. The adapter gives only the configured `CODEX_HOME` path to Codex's supported auth chain; Bang never opens, copies, returns or logs credential files. `login status` checks recognition before model dispatch; later expired-token/provider failures remain separately classified. A recognized login does not promise connectivity or entitlement.

`inheritProxy:true` explicitly passes only HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY and lowercase equivalents from the owner environment. Values stay in child environment, not arguments, task receipts or logs. Other arbitrary environment, API-key variables, runtime capabilities, NODE_OPTIONS and tool PATH remain excluded. This option was necessary for the measured Windows environment. It does not make a Windows localhost proxy accessible inside WSL.

Execution uses `--ignore-user-config --ignore-rules --ephemeral --sandbox read-only --strict-config --json --output-schema`, an explicit model, disabled browser/computer/shell/image/agent/plugin/app/memory/hook/search capabilities, no approval escalation, no project/skill instruction injection, and a per-attempt model catalog. That catalog retains the bundled selected model but removes apply-patch capability, experimental tools and tool search. An empty `.git` marker stops parent-project discovery; log/schema/catalog files stay in attempt scratch and are cleaned by the supervisor. Read-only alone is not the tool restriction.

Actual pinned CLI wire audits on Windows and Linux sent **zero tools** to a controlled loopback provider with an isolated empty auth home. This tests the real CLI request construction, not a mocked argv assertion. The provider deliberately returns an error and performs no inference. A future CLI/catalog/policy change requires another audit; arbitrary third-party wrappers and hostile local administrators are outside this trusted-adapter contract.

## Results, controls and errors

The closed output grammar supports card creation/edit/supplement and relation creation/deletion, with source/conditions/uncertainty. The common Coordinator still owns source versions, read dependencies, manual authority, structure semantics, compilation and the sole publisher. No current-board path or write capability is sent to the model. Empty candidates acknowledge a turn without a new revision.

Only a successful terminal turn with a JSON final message is accepted. Unexpected tool items, malformed results and mixed failed/success terminal events cannot publish. Available input/output token counts become task usage. Captured stdout/stderr remain bounded in memory; raw provider output, reasoning and prompts are not ordinary diagnostics. Native error envelopes contain only allowlisted codes and optional fixed stage/reason enums. Authentication and service budget failures pause without automatic retries; native timeout/cancel/epoch fences and the project budget remain the existing common lifecycle. Cancellation is bounded native process cleanup and revocation of publication; no remote billing reversal is promised.

Public operations remain `organizer-enable`, `organizer-status`, `organizer-control`, `organizer-configure` and their protected HTTP routes. The existing UI displays task state, error code, usage and commit revision. A configured executor is not represented as a verified live login/model connection.

## Reproducible checks

```text
node --test tests/codex-executor.test.mjs tests/native-organizer.test.mjs tests/organizer-controls.test.mjs
node tests/codex-capability-audit.mjs
node --test --test-name-pattern="actual pinned Codex" tests/codex-executor-auth.test.mjs
npm run build --prefix prototypes/whiteboard-integration
```

Capability/auth tests use `BANG_CODEX_AUDIT_BINARY` (or the desktop binary for the audit). The authorization test always creates a fresh empty auth home and makes no model request. Default test-suite runs skip that actual-binary test unless opted in.

`tests/codex-executor-real.mjs` is an explicit opt-in, cost-bearing acceptance command, never a default test: it uses the exact configured actual binary and supported existing auth, creates one isolated source turn, verifies its JSONL terminal completion, and allows at most one Organizer attempt in a disposable project. Its signing adapter is explicitly an isolated acceptance source, **not the user's current chat or production connector 24**. It retains the project for inspection. `BANG_CODEX_REAL_BINARY` and `BANG_CODEX_AUTH_HOME` select an independently authorized native Linux installation/home. The source and Organizer jobs use zero-tool/read-only configuration. Source generation has a 60-second bound; Organizer timeout is 60 seconds and project budget one call.

`tests/codex-executor-real-browser.mjs` takes `BANG_REAL_PROJECT` and `BANG_REAL_TOPIC`; it checks the retained actual card/commit/usage via real Chrome and protected HTTP, then reloads. It does not call a model or inject browser state. Ordinary controlled tests never use real credentials or model service.

## Evidence and failures retained (2026-11-18)

Windows 11 x64 / Node 25.8.1 / desktop-bundled Codex 0.169.0-alpha.11.1:

- Public Runtime RED→GREEN slices: initially executor unavailable; authentication initially collapsed to unavailable/retried; budget likewise; unexpected tool and mixed terminals initially published; proxy routing initially rejected; scalar-less provider grammar initially failed its controlled provider check; absent login initially proceeded; conflicting executor settings initially selected native. Each has a retained public behavior regression.
- Final pre-merge executor/native/controls suite: **50 passed**, no failures/skips, 56.1 seconds. Actual empty-home authorization check separately passed: AUTH_REQUIRED at authorization stage, one attempt, confirmed process exit, no model dispatch. Actual zero-tool wire audit passed.
- First two real isolated source attempts omitted required proxy environment and timed out without a CompletedTurn. A no-auth network differential showed existing proxy HTTP200 versus removed proxy timeout (curl28). Explicit proxy routing fixed source generation. No source was ingested from the failed attempts.
- The first real source then reached the native Organizer. Two attempts returned EXECUTOR_UNAVAILABLE; the second retained stage=model/reason=unknown. The output grammar was corrected to use explicit scalar types (controlled RED/GREEN), after which the third bounded attempt succeeded with a legitimate **no-change** receipt (8175 input / 39 output tokens, revision0). The original raw errors were intentionally not retained, so the grammar as sole cause of those original failures is an inference, not a verified raw-error diagnosis.
- A second actual isolated source explicitly requested a Rainwater barrel project knowledge card, preserving design-intention status. One Organizer attempt produced **1 card, revision1, 8291 input / 107 output tokens**, Windows Job exit confirmed without force. Runtime stop/reopen remained revision1. Task ID `189a60c5-b0ec-4ea3-ac29-e3047f791ee1`; attempt `20447fe5-1055-443d-8228-5dd4b12b6de6`. The source was actual isolated Codex output, with an acceptance-only signed adapter, not a fabricated current-chat completion.
- Production build passed (existing chunk-size warning). Actual Chrome displayed the retained committed card, task usage, revision and source/condition details, and preserved them after reload. No real-service cancellation or billing-cancellation claim is inferred from controlled lifecycle tests.

Ubuntu 24.04.4 x64 / WSL2 SchedResearch-R12 / Linux Node 25.8.1, ext4 `/var/tmp/bang-ticket25-linux`, uid65534 (nobody):

- Exact official npm artifact: `https://registry.npmjs.org/@openai/codex/-/codex-0.169.0-alpha.11.1-linux-x64.tgz`. Registry SHA512 `Cz606aiLwIGHQIhRGrY1eI5D+c8gvU7NJKkqBOkNi605SPDsc2aPjIfHr0wTI79oZNHtxMWcikVxyH2cPtiE8A==` verified before extraction; archive SHA256 `92671272d6077a25dc6b61518f4757683eb83274053feca792cd22adb2251c09`. Only the native ELF was extracted to `/var/tmp/bang-ticket25-tools/package/vendor/x86_64-unknown-linux-musl/bin/codex`; no global package install or credential copy.
- Actual pinned Linux CLI zero-tool wire audit passed. Initial executor/public-ingestion suite **16 passed**, no failures/skips. Actual native Runtime empty-home authorization test separately passed, with AUTH_REQUIRED before model dispatch and confirmed Linux process exit.
- Native Linux service success is **not** verified. There is no independently established Linux login. A private empty `/var/tmp/bang-ticket25-auth` was prepared uid65534/mode700; no authentication files were copied or read. Dormant local tracker wizard `linux-codex-login.sh` uses normal `login --device-auth` and then supported status; `bash -n` passed, shellcheck unavailable. No device code was requested.
- Network checks are also a blocker: direct auth.openai.com HEAD returned403 (reachability, not authorized login), direct chatgpt.com timed out/http000. WSL reports NAT/localhost-proxy incompatibility, route shows an ordinary host gateway, and no networkingMode override was found. Existing credential-free proxy via Linux localhost returned curl7/http000; via the observed host gateway returned curl28/http000 within six seconds. No firewall/global proxy edits, open relay or sandbox bypass was attempted. Login is therefore not presented as the only missing step.

Windows10, standalone Ubuntu distribution certification, Linux actual service success, production current-chat integration, no-human-reminder context delivery, broad model quality, physical suspend/resume and the complete host matrix remain unclaimed. Ticket25 stays claimed until its remaining actual Linux gate is met.
