# Bang 源码直用、单技能 `$bang` 与过时入口清理方案设计

## 1. 背景与问题梳理

当前用户在本机 `git clone` Bang 源码后，若希望在多个独立专题目录中直接打开 Codex 并启用 Bang 持续整理学习对话，存在以下四处真实摩擦点：

1. **新旧两套 `bang-bundle` 运行时并存、体验割裂**
   - 旧版 Linux 独立运行时（`runtime/bundle/` + `runtime/bundle/install.mjs`）虽然支持一次安装全局技能，但已在文档中被标为旧版（采用 `flock` 与每项目独立启动 Vite dev server），与主线新架构（`runtime/native/` + `runtime/canvas/` + `runtime/codex/` + `release/bang.mjs`）分叉。
   - 新版统一入口（`release/bang.mjs` + `release/bundle.mjs`）强依赖验证包产物 `package-manifest.json`、固定版本内置 Node 与预打包 `editor/` 清单，**无法在源码克隆目录直接运行**。
2. **新版技能缺少 `status` / `stop` 能力，且 CLI 的 `status` 语义错位**
   - 现行 `skills/bang-bundle/SKILL.md` 仅注入 `up --project` 一条命令，未在聊天内暴露查看状态与停止后台能力。
   - `release/bang.mjs` 中的 `status` 当前返回的是 Codex Hooks 维护计划（`projectPlan`），而非项目后台运行态（Runtime 存活、白板 URL、各专题绑定会话、整理器状态、已接收与已整理轮次）。
3. **缺少根目录短安装入口，源码更新后技能无法平滑刷新**
   - 仓库根目录没有面向本机源码用户的短安装脚本；且 `installSkill` 只要发现 `~/.agents/skills/` 中已有内容不同的技能文件就直接报错，每次源码 `git pull` 更新都需要人工删除旧技能文件。
4. **过时入口与冗余接口过多，增加心智与维护负担**
   - 仓库同时保留了旧版手动白板技能（`skills/bang/`）、旧版 `runtime/bundle/`、更早期的 `runtime/companion/` 及旧数据迁移链路（`legacy-migration` / `--legacy`）、以及 7 个项目级 `.codex/hooks.json` 维护子命令（`plan` / `prepare-codex` / `install-codex` / `repair-codex` / `upgrade-codex` / `rollback-codex` / `uninstall-codex`）。

---

## 2. 设计目标与核心决策

### 2.1 设计目标

- **主机级一次安装，专题级零配置复用**：克隆源码后在仓库根目录执行一次短安装脚本，完成共用前端构建与当前用户全局技能注册；此后每学一个新专题，在任意目录打开 Codex 即可直接使用，无需复制技能或输入长路径命令。
- **统一到新版原生运行时**：直接基于 `runtime/native/` + `runtime/canvas/` + `runtime/codex/` + 预构建静态白板运行，不再为每个专题启动 Vite dev server。
- **极简交互面与极简代码面**：一个技能名、三个清晰动作，彻底清理过时旧入口、旧数据迁移链路与不再需要的 Codex Hook 维护子命令。

### 2.2 关键设计决策

#### 决策 1：技能保持单技能 + 子意图，**不拆分为四个独立技能**
不将生命周期拆成“初始化 / 绑定 / 状态 / 结束”四个技能，理由如下：
- **贴合用户心智**：学习新专题时用户的真实意图只有一个——“把当前专题的 Bang 开起来”。首次初始化、同会话重复复用、新会话接续切换、停后重新拉起本就应该是幂等自动完成的，拆开 `init` 与 `bind` 只会制造顺序错误和判断负担。
- **不污染全局技能补全列表**：`~/.agents/skills/` 为主机当前用户全局共享，单一技能只占 1 个名字。
- **契合 Codex 技能机制**：Codex 通过模型阅读 `SKILL.md` 路由意图；一份简明的三动作说明（默认 `up`、`status`、`stop`）上下文开销极低，同时天然兼容自然语言表达（如“停一下 `$bang`”）。

#### 决策 2：将技能名从 `bang-bundle` 改为 `bang`
- `bang-bundle` 是为了与早期手动技能 `skills/bang/SKILL.md` 区分的历史命名，`bundle` 对终端用户无信息量。
- 随旧手动白板技能一起清理后，主技能直接命名为 `bang`：
  - 源码模板路径：`skills/bang/SKILL.md`
  - 用户级安装路径：`~/.agents/skills/bang/SKILL.md`
  - Codex 聊天调用：`$bang` / `$bang status` / `$bang stop`
- CLI 名称与技能名称统一为 `bang`，用户只需记住一个词。

#### 决策 3：新版统一入口原生支持源码直跑模式（Source Mode），且不削弱验证包完整性边界
- 保留验证包模式（存在 `package-manifest.json` 时的严格完整性校验），不破坏发布包边界。
- 仅在满足**正向源码树识别条件**时才允许进入 Source Mode；验证包缺失或损坏 `package-manifest.json` 时必须报完整性错误，绝不降级为源码模式。

#### 决策 4：彻底删除过时旧入口、旧数据迁移链路与 Codex Hook 维护子命令
- 删除旧版 `runtime/bundle/`、旧版 `runtime/companion/`、旧手动白板技能 `skills/bang/`（原内容）。
- 删除旧项目数据迁移链路（`runtime/canvas/legacy-migration.mjs`、Runtime 的 `legacy-*` 操作、前端迁移面板、`--legacy` 参数及对应测试）。
- 删除 Codex Hook 项目级维护子命令（`plan` / `prepare-codex` / `install-codex` / `repair-codex` / `upgrade-codex` / `rollback-codex` / `uninstall-codex` 及 `release/codex-maintenance.mjs`），聚焦零项目侵入的 `$bang` 技能主流程。

---

## 3. 目标用户使用流程（以「GDN 模型结构」学习为例）

### 3.1 主机一次性安装（仅执行一次）

```bash
git clone <Bang 仓库地址> ~/workspace/Bang
cd ~/workspace/Bang
./install.sh
```

脚本自动完成环境预检、共用静态白板构建、全局技能 `~/.agents/skills/bang/SKILL.md` 注册（以及可选的 `~/.local/bin/bang` 短命令链接）。之后 `git pull` 更新源码时，重跑 `./install.sh` 即可幂等刷新。

### 3.2 新专题开启与持续记录流程

1. **创建专题目录并打开 Codex**
   ```bash
   mkdir -p ~/study/gdn-architecture
   cd ~/study/gdn-architecture
   codex
   ```
2. **发送 `$bang` 开启白板与后台整理**
   - 用户输入：`$bang`
   - Bang 自动在 `~/study/gdn-architecture/.bang/` 初始化项目工作区、核对当前 Codex 会话与调用轮、启动原生后台与静态白板服务，返回本地回环白板地址（如 `http://127.0.0.1:<port>/canvas.html?topic=<id>`）与整理器状态。
3. **正常开展 GDN 学习讨论**
   - 用户提问（例如讨论 Qwen3.5-0.8B 的 18 层 Gated DeltaNet + 6 层 Attention 3:1 排布、固定大小状态矩阵 `St[v, k]` 与传统 KV Cache 的差异、门控遗忘更新规则等），Codex 正常回答。
   - 每轮问答达到可核验完成态后，后台独立整理器以只读、无工具方式提取该轮原始轮次记录（Episode）中的用户输入与最终回答，将概念节点、对比关系、推导依据增量提交到白板；保留用户在白板上的手动布局与批注，冲突内容转为待接受建议。
4. **查看状态与跨会话接续**
   - 随时发送 `$bang status`：只读返回当前项目后台运行态及各专题的绑定会话、白板链接、已接收轮数与最近成功整理的轮次，不触发启动或修改状态。
   - 对话过长时在同一项目目录新开 Codex 会话并发送 `$bang`：自动接续原有 GDN 专题与白板（多专题时提示用 `--topic <id>` 选择），保留历史原文与用户手改，将输入来源切换到新会话。
5. **结束学习**
   - 发送 `$bang stop`：停止**当前项目目录**的 Bang 后台（涵盖该目录下所有专题的监听、整理器与白板服务），`.bang/` 数据完整保留。下次回到该目录发送 `$bang` 即可原地恢复。

---

## 4. 技术方案设计

### 4.1 仓库根目录短安装脚本

在仓库根目录提供极简安装入口：
- `install.mjs`：跨平台核心安装逻辑（Linux / Windows 均可直接 `node install.mjs`）。
- `install.sh`：Linux 薄封装（`exec node "$(dirname "$0")/install.mjs" "$@"`），方便直接 `./install.sh`。

安装脚本职责（全程幂等）：
1. **环境预检**
   - **支持平台与双原生 helper 校验**：复用 `release/resources.mjs` 中的 `platforms` 平台表，明确当前预构建原生 helper 的支持目标为 **`linux-x64`** 与 **`win32-x64`**（其他平台或架构直接明确报不支持）。逐一检查该平台声明的**全部 helper**（Linux：`runtime/native/lock-host` 与 `runtime/native/process-host`；Windows：`runtime/native/lock-host.exe` 与 `runtime/native/process-host.exe`）均为常规文件且具备可执行权限，避免安装通过、白板可开但首轮整理器启动失败。
   - **Node 运行能力真实导入校验**：不仅检查版本号，还实际执行 `import('node:sqlite')` 与仓库核心 `.ts` 模块导入（例如 `runtime/canvas/contract.ts`、`runtime/canvas/structures.ts`），验证当前 Node 的 SQLite 与原生 TypeScript 类型剥离支持均可用。
   - **本机 Codex CLI 探测**：优先 `CODEX_APP_RUNTIME_CLI_PATH`，其次 `PATH`；不可用或版本不满足要求时给出清晰诊断。
2. **准备共用前端静态产物**
   - 在 `prototypes/whiteboard-integration/` 检查依赖并按锁文件补齐（缺失时执行 `npm ci`）。
   - 执行预构建（`npm run build -- --mode packaged`），生成共用的 `prototypes/whiteboard-integration/dist/` 静态资源目录。
   - 所有专题只读复用该目录，不在每个专题内重复安装依赖或启动 Vite。
3. **注册/更新用户级全局技能**
   - 写入 `~/.agents/skills/bang/SKILL.md`（支持 `--skills-dir <dir>` 覆盖默认目录）。
   - 在生成的 `SKILL.md` 中写入受控来源标识（如 `<!-- managed-by: bang -->`）；若目标文件已存在且带有该标记则平滑更新，若为用户手工编写的未知文件则拒绝覆盖并提示审阅（支持 `--force` 显式覆盖）。
   - 若检测到旧版 `~/.agents/skills/bang-bundle/SKILL.md`（且由 Bang 安装），提示用户清理或随参数移除，避免新旧技能并存。
4. **可选本机短命令**
   - 输出清晰的终端使用提示，或通过 `--link-bin`（可选写入 `~/.local/bin/bang`）提供终端短命令，便于在未打开 Codex 时于任意项目目录执行 `bang status` / `bang stop`。

### 4.2 统一入口的双模式判定与精简 CLI 契约

精简 `release/bang.mjs` 的子命令集合，仅保留面向用户和验证的核心入口：

| 子命令 | 作用域 | 说明 | 参数 |
|---|---|---|---|
| `install-skill` | 当前用户 | 注册/更新全局 `$bang` 技能 | `[--skills-dir <dir>] [--force]` |
| `up` | 项目 / 指定专题 | 初始化/绑定/接续当前会话并启动项目后台与白板 | `[--project <dir>] [--codex <path>] [--model <name>] [--topic <id>]` |
| `status` | 项目（含各专题） | 严格只读查询项目后台与各专题绑定/接收/整理状态 | `[--project <dir>]` |
| `stop` | **整个项目** | 停止当前项目目录的 Runtime、所有专题监听/整理器与白板服务 | `[--project <dir>]` |
| `serve` | 项目 | 单独启动白板 HTTP 服务（调试/查看用） | `[--project <dir>] [--port <n>]` |
| `check` | 本机 / 项目 | 检查平台 helper、Node 导入能力、编辑器产物与 Codex 可用性 | `[--project <dir>] [--codex <path>]` |

关键行为约束：
- **`--project` 默认取 `process.cwd()`**：未显式传入 `--project` 时默认作用于当前工作目录，同时仍支持显式传参。
- **严格的双模式判定（防止损坏验证包误降级为源码模式）**：
  1. 若根目录存在 `package-manifest.json` → **验证包模式**，执行原有的严格文件列表、SHA-256 哈希与内置 Node 校验；编辑器资源来自 `<root>/editor/`。
  2. 若根目录不存在 `package-manifest.json` → 执行**源码树正向识别**：必须同时存在根目录 `install.mjs`、`prototypes/whiteboard-integration/package.json` 与 `prototypes/whiteboard-integration/vite.config.ts`，且**不存在**验证包特征（如 `<root>/node/` 内置运行时目录或 `<root>/editor/` 预打包目录）。
     - 满足全部正向条件 → **源码直跑模式**：按平台表校验 `lock-host` 与 `process-host`、校验 `<root>/prototypes/whiteboard-integration/dist/canvas.html` 存在（缺失时提示运行 `./install.sh` / `node install.mjs`）。
     - 不满足正向条件 → 判定为**损坏或缺失清单的验证包**，直接报 `Bang package manifest is missing` 等完整性错误并拒绝启动。
- **保留与 `release/package.mjs` 的兼容**：验证包构建脚本同步更新为打包 `skills/bang/SKILL.md` 并移除已删除模块。

### 4.3 运行态 `status` 契约与严格只读保证

#### 1. 原子化单次只读查询（含 SQLite 只读与并发语义）
当前 `runtimeOperation(project, command)` 中，仅 `command === 'status'` 走只探活路径，而 `binding-status`、`organizer-status`、`topics` 等都会调用 `ensureRuntime(project)`；同时 `openBindingDatabase` 与 `organizerStatus` 会执行 `CREATE TABLE IF NOT EXISTS` 建表语句，并非严格只读。

解决方案：
- 在 `runtime/native/runtime.mjs` 中新增聚合只读命令 **`bundle-status`**，并在 `runtimeOperation` 中将其与 `status` 一并纳入**只探活、绝不调用 `ensureRuntime`** 的只读分支：
  - 若后台未存活（无 `connection.json` 或探活失败），直接返回 `{ status: 'unavailable' }`，不拉起守护进程。
  - 若后台存活，通过**单次** `/control` 请求在守护进程队列内一次性收集完整快照（`editorUrl`、所有专题列表、各专题的活动绑定、已接收/待整理轮次、整理器状态与最近成功整理记录、逐专题 watch 状态）。
- **SQLite 严格只读**：`bundle-status` 查询项目数据库时必须使用只读连接（`readOnly: true`），若数据库文件或目标表尚不存在，直接按空集合/默认值返回，**绝不创建数据库文件、绝不执行建表或任何写入**。
- **与 `stop` 并发的正确语义**：若 `status` 先进入守护进程队列，返回查询当时的有效运行中快照（`runtimeRunning: true`）属于合法结果；若 `stop` 先进入队列，则收敛为 `runtimeRunning: false`。并发场景的核心不变量是：**`stop` 完成后再次查询必得 `runtimeRunning: false`，且全程不会启动新的 Runtime 实例**。

#### 2. 多专题结构、逐专题监听状态、终端无会话语义、区分“已接收”与“已整理”
- 项目目录下允许存在多个专题，因此 `status` 按项目级摘要 + `topics` 数组返回，避免单专题扁平结构在多专题场景下信息丢失。
- **逐专题 `watchStatus`**：改造 `runtime/codex/watch.mjs`，将原本按 `project` 存单条状态的 `statuses` 改为按专题（或活动 `sourceId`）分别记录监听状态，使多专题下各专题的 `watchStatus` 相互独立、互不覆盖。
- 区分两类进度指标：
  - **`receivedTurns`**：来源连接器已接收的完成轮数（对应 `binding.source.completedTurns`，原始轮次入库即递增，**不代表已整理**）。
  - **`pendingTurns`**：尚在整理队列中的待处理轮数。
  - **`lastOrganizedTurn` / `lastOrganizedRevision`**：整理器最近一次成功提交白板对应的轮次信息与修订号（从未成功整理过则为 `null`）。
- 区分聊天环境与普通终端环境：
  - 当环境变量无 `CODEX_THREAD_ID` / `CODEX_SESSION_ID`（例如在普通终端执行 `bang status`）时，`currentHostChatId` 为 `null`，且每个专题的 `boundToCurrentHost` 返回 **`null`**（而非 `false`），明确表示“当前无宿主聊天可供比较”。

返回结构示例：

```json
{
  "initialized": true,
  "project": "/home/user/study/gdn-architecture",
  "runtimeRunning": true,
  "editorBaseUrl": "http://127.0.0.1:41923/canvas.html",
  "currentHostChatId": "thr_abc",
  "topics": [
    {
      "topicId": "t_01...",
      "whiteboardUrl": "http://127.0.0.1:41923/canvas.html?topic=t_01...",
      "boundChatId": "thr_abc",
      "boundToCurrentHost": true,
      "watchStatus": "watching",
      "organizerEnabled": true,
      "organizerPauseReason": null,
      "receivedTurns": 3,
      "pendingTurns": 1,
      "lastOrganizedTurn": { "turnId": "turn_2", "sourceId": "src_2" },
      "lastOrganizedRevision": 2
    }
  ]
}
```

边界状态约定：
- 项目尚无 `.bang/` 目录：`initialized: false, runtimeRunning: false, editorBaseUrl: null, currentHostChatId, topics: []`。
- 项目已初始化但后台已停止：`initialized: true, runtimeRunning: false, editorBaseUrl: null`（提示可通过 `$bang` 恢复）。

### 4.4 统一全局技能 `$bang`（`skills/bang/SKILL.md`）

新模板 `skills/bang/SKILL.md` 保持短小精准，注入统一的基础命令模板（例如 `@@BANG_BASE_COMMAND@@` 替换为 `[nodePath, "<bang-root>/release/bang.mjs"]`），按用户意图路由三个动作：

1. **默认调用（`$bang`）**：
   - 执行 `<base> up --project <当前项目绝对路径>`（保留宿主当前聊天环境；若用户指定专题则追加 `--topic <id>`）。
   - 返回 `whiteboardUrl`、`organizerEnabled` 与绑定状态；遇到 `selection-required` 时请用户选择专题后重跑；保留 Windows 下 `BANG_WINDOWS_HOST_ACCESS` 权限申请指引。
   - 刚启动时仅报告绑定与后台状态，不宣称尚未完成的当前轮已整理。
2. **查看状态（`$bang status` 或自然语言查询状态）**：
   - 执行 `<base> status --project <当前项目绝对路径>`。
   - 按 `topics` 如实汇报项目后台状态、各专题绑定情况（区分 `boundToCurrentHost` 为 `true` / `false` / `null`）、白板链接、整理器开关/暂停原因，并**严格区分**“已接收轮数（`receivedTurns`）”与“最近成功整理的轮次（`lastOrganizedTurn` / `lastOrganizedRevision`）”，不得把已接收但尚未整理的轮次说成已整理。
3. **停止服务（`$bang stop` 或自然语言要求停止）**：
   - 执行 `<base> stop --project <当前项目绝对路径>`。
   - 在回执中**明确告知作用范围**：已停止**当前项目目录**的 Bang 后台（包括该目录下**所有专题**的监听、整理器与白板服务），`.bang/` 中的白板与历史记录均已保留。

### 4.5 共享编辑器静态资源加载策略

改造 `release/editor.mjs` 与 `runtime/native/runtime.mjs` 中的 `bundle-editor`：
- 抽象统一的编辑器资源解析函数：
  - 验证包模式：从 `<root>/editor/` 按 `package-manifest.json` 白名单提供静态文件。
  - 源码直跑模式：从 `<root>/prototypes/whiteboard-integration/dist/` 扫描静态资源文件白名单（仅限常规文件、拒绝符号链接逃逸、保留既有 CSP 与回环 Host/Origin 校验）。
- `runtime/native/runtime.mjs` 持有并向 `bundle-status` 暴露当前 `bundleEditor?.url ?? null`，使只读状态查询在后台存活时直接拿到真实白板地址。

### 4.6 唯一跨模块依赖迁移（`locateTranscript` + `matchingFiles`）

在删除 `runtime/bundle/` 前，将 `runtime/bundle/transcript.mjs` 第 26–39 行的 **`matchingFiles` 与 `locateTranscript` 一并迁移**至 `runtime/codex/locate-transcript.mjs`（或 `runtime/codex/transcript-transport.mjs`）：
- 保留当宿主仅提供会话 ID 而未提供 `CODEX_TRANSCRIPT_PATH` 时，递归扫描 `$CODEX_HOME/sessions` 按精确 ID 匹配唯一 `.jsonl` 文件的行为。
- 保持“0 个或多个匹配文件时明确报错、不按 mtime 或最新文件猜测”的严格边界。
- 更新 `release/bundle.mjs` 的导入路径，彻底切断对 `runtime/bundle/` 的依赖。

---

## 5. 过时入口与接口清理清单

### 5.1 直接删除的文件与目录

| 类别 | 路径 | 原因 |
|---|---|---|
| 旧版 Linux 独立运行时 | `runtime/bundle/`（整个目录） | 已被统一原生运行时替代；迁出 `locateTranscript` 与 `matchingFiles` 后无任何运行时引用 |
| 旧版 companion 运行时 | `runtime/companion/`（整个目录） | 过时后台入口，且不再保留旧数据迁移 |
| 旧版技能目录 | `skills/bang/`（旧手动白板内容及 `references/`）与 `skills/bang-bundle/` | 统一替换为新的 `skills/bang/SKILL.md` |
| 旧数据迁移实现与文档 | `runtime/canvas/legacy-migration.mjs`、`runtime/canvas/MIGRATION.md` | 明确不再保留旧项目数据迁移链路 |
| 前端旧迁移面板与 companion 验证脚本 | `prototypes/whiteboard-integration/src/LegacyMigration.tsx`、`prototypes/whiteboard-integration/validate-background.mjs` | 分别对应旧迁移 UI 入口与直接导入 `runtime/companion/whiteboard.mjs` 的旧后台验证脚本 |
| Codex Hook 维护模块 | `release/codex-maintenance.mjs` | 明确删除 7 个 Hook 维护子命令 |
| 旧入口/迁移/Hook 维护测试 | `tests/bundle.test.mjs`、`tests/bundle-readonly.test.mjs`、`tests/bundle-resources.test.mjs`、`tests/frontend-install.test.mjs`、`tests/legacy-runtime.test.mjs`、`tests/legacy-migration.test.mjs`、`tests/legacy-migration-browser.mjs`、`tests/legacy-http.test.mjs`、`tests/legacy-browser.mjs`、`tests/installed-lifecycle.test.mjs` | 覆盖已删除的旧入口、旧迁移与 Hook 维护命令 |

### 5.2 同步精简接口的既有文件

| 文件 | 精简/调整内容 |
|---|---|
| `release/bang.mjs` | 移除 `plan`、`prepare-codex`、`install-codex`、`repair-codex`、`upgrade-codex`、`rollback-codex`、`uninstall-codex` 与 `--legacy` / `--legacy-topic`；实现严格双模式判定、`--project` 默认 `cwd`、单次只读运行态 `status` |
| `release/bundle.mjs` | `installSkill` 改名为安装 `bang`（支持受控标记覆盖与旧 `bang-bundle` 提示）；改从 `runtime/codex/` 导入 `locateTranscript`；调用 `bundle-status` 实现只读状态封装 |
| `release/editor.mjs` | 支持验证包 `editor/` 与源码 `prototypes/whiteboard-integration/dist/` 两种静态资源来源 |
| `release/package.mjs` | 打包清单改收 `skills/bang/SKILL.md`，移除 `codex-maintenance.mjs` 与 `companion/*` 拷贝 |
| `runtime/native/runtime.mjs` | 移除 `legacy-archive` / `legacy-stop` / `legacy-preflight` / `legacy-migrate` / `legacy-history` 注册；新增只读 `bundle-status` 聚合命令（使用只读 SQLite 连接，并在 `runtimeOperation` 中走不拉起后台分支）；`bundle-editor` 支持源码构建产物 |
| `runtime/codex/watch.mjs` | 将监听状态存储从按项目单条记录升级为按专题（或活动来源）逐项记录，支撑多专题 `watchStatus` 查询 |
| `runtime/canvas/bang.mjs`、`runtime/canvas/http.mjs` | 移除 `legacy-*` CLI 命令与 HTTP 路由 |
| `prototypes/whiteboard-integration/bridge.mjs` 及前端入口 | 移除对 `runtime/companion/whiteboard.mjs` 与 `LegacyMigration.tsx` 的引用 |
| `tests/installed-bang.test.mjs`、`tests/installed-bang-smoke.mjs`、`tests/installed-security.mjs` | 适配新技能名 `bang`、精简后的子命令集合，去除对已删除 Hook 维护命令的断言 |
| `.github/README.md`、`release/README.md` | 更新为单一的“clone → `./install.sh` → `$bang` / `$bang status` / `$bang stop`”文档，移除旧入口指引 |

---

## 6. 实施顺序与验证计划

### 6.1 建议实施顺序

1. **迁移共享辅助函数**：将 `matchingFiles` 与 `locateTranscript` 迁入 `runtime/codex/` 并补齐单元测试，确保 `release/bundle.mjs` 脱离 `runtime/bundle/`。
2. **落地严格双模式判定与单次只读 `bundle-status`**：改造 `release/editor.mjs`、`runtime/native/runtime.mjs`、`release/bundle.mjs` 与 `release/bang.mjs`。
3. **统一技能与根目录安装脚本**：编写新的 `skills/bang/SKILL.md`、`install.mjs`（含双 helper 与 Node 真实导入预检）与 `install.sh`。
4. **清理过时目录、接口与旧迁移链路**：按第 5 节清单删除旧目录/脚本与冗余子命令，并更新前端和文档。
5. **补齐测试与端到端验证**。

### 6.2 验证与验收清单

- **自动化测试（新增与保留）**：
  1. **`locateTranscript` / `matchingFiles` 单元测试**：覆盖 `$CODEX_HOME/sessions` 中 **0 个、1 个、多个**匹配文件以及显式 `CODEX_TRANSCRIPT_PATH` 的行为。
  2. **安装预检测试**：覆盖 `linux-x64` / `win32-x64` 双 helper（`lock-host` + `process-host`）缺失检测、Node 导入 `node:sqlite` 与 `.ts` 模块预检、`install.mjs` 幂等覆盖保护。
  3. **双模式安全边界反例测试**：从验证包目录移走 `package-manifest.json` 后执行 `up`，必须报完整性错误，**绝不降级为源码模式**。
  4. **`status` 只读与语义测试**：
     - **SQLite 只读不建表**：在“Runtime 已启动、相关业务表尚未建立”的项目上执行 `status`，验证查询正常返回且查询前后数据库表清单（含数据库文件存在性）完全一致。
     - **与 `stop` 并发不重启**：并发执行 `status` 与 `stop`，允许先入队的 `status` 返回当时的有效运行中快照（`runtimeRunning: true`）或收敛为 `false`；验证 `stop` 完成后再次查询必得 `runtimeRunning: false`，且全程未启动新的 Runtime 实例。
     - **未初始化 / 已停止项目只读**：执行 `status` 不创建 `.bang/`、不启动守护进程。
     - **区分已接收与已整理**：模拟“**已接收一轮但整理器暂停**”场景，验证 `receivedTurns === 1`、`pendingTurns >= 1`、`lastOrganizedTurn === null`，确认技能不会误报已整理。
     - **多专题与逐专题 `watchStatus`**：在同一项目下构造“一个专题正在监听、另一个专题已暂停接收（`reception-stopped`）”，验证 `topics` 两项的 `watchStatus` 各自准确、互不覆盖；普通终端无会话环境时 `currentHostChatId === null` 且各专题 `boundToCurrentHost === null`。
  5. **回归与构建**：跑通保留的 `tests/installed-bang.test.mjs`、`tests/codex-*.test.mjs`、`tests/canvas-*.test.mjs`、`tests/native-*.test.mjs` 以及 `prototypes/whiteboard-integration` 的生产构建（`npm run build -- --mode packaged`）。
- **本机真实链路验收**：
  1. 在 Bang 源码根目录执行 `./install.sh`，确认双 helper 预检通过、生成共用静态构建产物与 `~/.agents/skills/bang/SKILL.md`。
  2. 新建隔离专题目录（如 `/tmp/study-gdn`），在 Codex 中依次验证：
     - `$bang`：自动初始化 `.bang/`、绑定当前会话、返回可访问的白板 URL。
     - 正常进行 1–2 轮 GDN 讨论后，核验后台完成轮整理与白板刷新。
     - `$bang status`：准确汇报运行态、绑定态、白板地址、已接收轮数与最近成功整理轮次。
     - 同目录新开 Codex 会话发送 `$bang`：接续原专题与白板。
     - `$bang stop`：优雅停止当前项目目录（所有专题）的后台与白板服务，保留 `.bang/` 数据，再次 `$bang status` 显示 `runtimeRunning: false`。
