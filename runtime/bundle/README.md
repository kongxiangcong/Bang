# bang-bundle（Linux）

项目拥有一个持续讨论专题，聊天只是可切换的输入来源。全局技能在任意项目调用 `$bang-bundle`：首次初始化并绑定当前轮，重复调用复用服务，新会话调用排队切换输入，保留白板、用户手改、来源与进度。没有开机自启，也不需要常驻智能体。

## 安装与使用

要求 Linux、Node.js 22+、npm、util-linux 的 `flock`、带 `exec --ephemeral --ignore-user-config --output-schema` 和 `shell_tool` 开关的 Codex CLI。已验证 Node 24.22.1、npm 11.9.0、Codex 0.167.0-alpha.4 的命令能力；当前云宿主没有 transcript，实际模型整理留待真实宿主验收。

在 Bang 安装目录执行一次：

```sh
node runtime/bundle/install.mjs
```

安装器按锁文件补齐缺失的前端依赖并准备字体与 ELK worker 静态资源，并将技能装入 `~/.agents/skills/bang-bundle/SKILL.md`。已有同内容安装可重复执行；不同内容的已有技能不会被覆盖。`--skills-dir <目录>` 可指定宿主支持的全局技能目录。保留 Bang 源码安装路径，技能使用该路径下的运行程序。新 Codex 会话发现全局技能；无需复制到每个项目。

在目标项目打开 Codex 后调用 `$bang-bundle`。正常情况下不填写 ID、路径或命令。程序使用宿主 `CODEX_THREAD_ID`（其次 `CODEX_SESSION_ID`）；优先读 `CODEX_TRANSCRIPT_PATH`，否则仅按确切 ID 查找 `$CODEX_HOME/sessions` 中唯一文件，核对 `session_meta.id`。`CODEX_TURN_ID` 或 transcript 的当前活动 `task_started` 决定调用轮。无可靠信息时停止，不用 mtime、最新文件或跨聊天内容猜测。

调试入口：

```sh
node /path/to/Bang/runtime/bundle/bang-bundle.mjs up --workspace /path/to/project
node /path/to/Bang/runtime/bundle/bang-bundle.mjs status --workspace /path/to/project
node /path/to/Bang/runtime/bundle/bang-bundle.mjs pause --workspace /path/to/project
node /path/to/Bang/runtime/bundle/bang-bundle.mjs resume --workspace /path/to/project
node /path/to/Bang/runtime/bundle/bang-bundle.mjs stop --workspace /path/to/project
```

`--chat / --transcript / --turn` 仅用于宿主明确提供相应信息或测试夹具，不用于猜测。显式 ID 不得与宿主当前 ID 冲突。`--codex` / `BANG_CODEX` 指定兼容入口，`--model` / `BANG_MODEL` 指定模型；否则使用 CLI 的默认模型。整理进程不加载全局模型配置文件，复用原 `CODEX_HOME` 认证和既有进程环境，不复制凭据。依赖自定义 provider 配置的宿主需要单独适配，不能宣称已支持。不要关闭 TLS 或复制 token 来绕过认证问题。

返回 `whiteboardUrl` 是该 Linux 机器的 loopback 地址，动态选择空闲端口并保存，服务恢复时复用原端口。端口被其他进程占用时明确失败，不占用或终止其他服务。远程机器需要宿主端口转发；不是公开发布。网页关闭不影响整理。停止后重启沿用专题与进度；不清空用户数据。`.bang/` 包含私有讨论，请由项目使用者选择合适的 Git 忽略配置；程序不会执行提交、推送或修改既有 Git 保护。

## 切换与单写入

`up` 先验证目标会话、当前活动轮、CLI 能力和前端依赖。配置变更使用 `control.lock`，后台整个生命周期使用 Linux `flock`。进程标识包含 PID、`/proc` 启动时刻和 boot ID，避免 PID 重用误判；锁由内核释放，不删除活跃锁。模型进程另持有 `model.lock`，后台被强杀后遗留的模型也不会与后续模型并发。

切换时保存 `pendingSwitch`：新来源及其调用前完成轮列表、旧来源在请求时已完成轮的完整队列、旧未完成轮 ID。旧任务继续串行提交；队列排空后原子更新绑定并追加历史。新来源从调用技能的活动轮开始接收；不回填其之前的已完成轮。旧截止点后完成的轮不接收，排除范围在 `pendingSwitch` / `lastBindingTransition` 中明确返回。

慢任务期间技能返回“切换进行中”，不可报告已绑定新会话。再次调用同一目标复用队列；不同目标不会覆盖正在切换的队列。失败后 `resume` 继续原队列。pause/stop 先停止接收下一任务，正在执行的一轮仍完成提交；stop 也关闭白板服务。

## 持久化与兼容

```text
项目/.bang/
  bundle.json                   # 项目配置、当前绑定、绑定历史、待切换队列
  worker.json / server.json      # 带启动时刻的进程标识与端口
  failure.json                  # 后台异常（resume/up 显式恢复）
  server-failure.json            # 白板服务异常
  *.lock*                       # 内核 flock 的锚点，不手工删除
  logs/bundle.jsonl              # 初始化后的处理与错误日志
  topics/discussion/
    head.json                   # 唯一提交指针
    commits/1.json, 2.json, ...  # 不可变修订：本轮原文、增量、完整活动状态、归档
    view.json                   # 用户编辑、布局、视角及已显示事件
    runs/<轮次哈希>/<尝试UUID>/ # 输入、结构化输出、CLI 日志
```

提交先 fsync 修订文件，再原子替换并 fsync `head.json`。原文、增量、已处理标记和活动状态属于同一个提交。失败或被杀时，不被 head 引用的修订不对读者可见；重试不会重复应用。即使提交后日志写入失败，恢复也会跳过已提交轮。轮次去重键包含聊天 ID，跨会话重名 turn 不冲突。

旧版 `.bang/companion.json` 可迁移：必须先停止旧 worker；旧锁若仍对应活进程会拒绝迁移。保留原文件和 view，转换已提交修订，并保留原白板事件 ID，避免再次应用。旧记录有重复、缺失或不连续时拒绝覆盖。新 bundle 仍复用原 `discussion` 专题。旧版单独 `companion` 入口继续保留。

## 每轮上下文与回查

每次独立 Codex exec 默认只得到规则、当前活动白板、用户手改、结构化交接记忆、上一版讨论文字、最新一轮已完成问答和最多 20 项最近归档索引。无新完成轮不调用模型。只采纳 task_complete 的最终回答，或同轮明确标为 final_answer 的回答；不读取工具结果或推理。完成标记缺少可核对的最终回答时停止并报格式问题。

默认预算（修改项目 `bundle.json` 的 `budget` 后恢复即可）：

| 字段 | 默认值 | 含义 |
|---|---:|---|
| inputBytes | 64000 | 完整模型提示 UTF-8 字节上限，含规则及回查 |
| stateBytes | 24000 | 活动白板、memory、discussion 和保留条件总预算 |
| historyBytes | 12000 | 本轮累计历史回查预算 |
| handoffBytes | 6000 | 提供给主助手的结构化交接摘要预算 |
| maxNodes / maxGroups / maxRelations | 60 / 12 / 100 | 活动对象数量上限 |
| maxLookups | 2 | 每轮最多历史回查次数 |
| modelTimeoutMs | 180000 | 一次独立模型调用超时 |

字节预算是保守容量限制，不冒充精确 token 计数。超过输入预算的单轮完整保留为未处理，报错要求调整预算，不能简单截断。模型每轮返回有界活动记忆；旧结论的成立条件必须仍被保留，或显式归档原条件、原因与来源。未决问题消失必须给出解决依据。归档节点保留原对象与来源；归档不会抹除历史。所有输出经运行时 schema、来源、图关系及预算校验；一次纠错仍失败则退出，不反复烧额度。

回查是无工具 JSON 协议：模型输出 `kind=lookup` 和来源/归档 ID，普通程序只从当前项目已提交记录中取出相关完整片段，计入预算，再发起独立调用。没有任意路径、shell、SQL 或跨会话搜索接口。CLI 调用禁用 shell、exec、MCP 配置、插件、浏览器、多智能体及图片等工具；关闭项目说明和宿主技能发现。主助手也可按需读取：

```sh
node /path/to/Bang/runtime/bundle/bang-bundle.mjs history --workspace /project --source '<message-id>'
node /path/to/Bang/runtime/bundle/bang-bundle.mjs history --workspace /project --index
node /path/to/Bang/runtime/bundle/bang-bundle.mjs history --workspace /project --archive '<archive-id>'
```

完整原文和修订历史允许在磁盘增长；活动白板和发送给模型的整理文字受预算限制。首版读取历史索引仍线性扫描本专题提交，超长存档的性能优化不影响输入隔离与预算。

## 验证

```sh
node --test tests/bundle.test.mjs
cd prototypes/whiteboard-integration
npm run build
```

Linux 生命周期测试需要 `/usr/bin/chromium`；测试会明确失败而不是静默跳过。测试使用独立临时项目、合成 transcript 和替代模型 CLI，实际启动 Node 后台、Vite、Chromium，执行提交、切换、手改、刷新与恢复。它不能证明真实聊天自动接收，也不能证明当前模型服务可用。

当前结果与真实验收步骤见 [VALIDATION.md](VALIDATION.md)。

## 只读安装目录

安装器是唯一准备 bundle 前端依赖与静态资源的入口：运行 `install.mjs` 时复制 Excalidraw 字体和 ELK worker；安装完成后 Bang 安装目录可以只读。`up`、`resume` 和白板服务仅核对、读取资源，绝不自动 npm install 或执行资源修补。资源缺失会报告“安装资源不完整，请重新运行安装器”及具体路径；请在安装目录可写的安装阶段重新执行安装器。

各目标项目分别使用 `.bang/cache/vite`（Vite 依赖预构建）、`.bang/cache/node`、`.bang/cache/npm`、`.bang/tmp`（含模型隔离工作目录）、`.bang/state/codex` 和 `.bang/logs/codex`。后台进程 cwd 与临时/缓存环境也指向目标项目，不沿用安装目录。Codex 通过 `log_dir` / `sqlite_home` 参数指定运行状态位置；认证仍使用原 `CODEX_HOME`，不复制凭据、不修改全局配置。外部 CLI 的认证刷新行为不由 Bang 接管。

新项目使用独立空闲端口；重启保留原端口，不抢占其他服务。已有聊天绑定、待切换队列、修订、白板数据及锁文件均保留。不要通过删除 `.bang/` 或锁文件解决安装问题。

回归：先执行安装器，再运行 `node --test tests/*.test.mjs`。`bundle-readonly.test.mjs` 必须以非 root 身份运行，会复制独立安装夹具、去掉写权限、核对两个项目的 `up`/复用/HTTP 资源及安装文件清单。它使用明确标注的合成宿主，不能替代真实当前聊天完成轮验收。
