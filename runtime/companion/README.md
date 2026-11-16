# Bang 后台整理

Linux 一键初始化和跨会话接续请使用 [bang-bundle](../bundle/README.md)。本页记录旧版显式指定 transcript 的入口；已有数据可在停止旧 worker 后由 bundle 迁移。

当前已接入后台专题白板，PIM 白板保持独立。采用 **明确绑定的 transcript 完成轮轮询**，不是已接通的 Stop hook。每 1.5 秒检查一次，仅在真实 `task_complete` 后处理对应用户消息与最终回答；不读取工具结果、模型内部推理或其他聊天。

官方 Hooks 已提供异步入口，但新 hook 需宿主信任，当前轮内不能证明配置已加载。本次不更改全局 hook 信任。当前桌面 transcript 格式属于内部格式，解析器按实测的 `task_started / response_item / task_complete` 编写，版本变化需核对。

## 目录

```text
当前项目/.bang/
  companion.json                 # 当前聊天、专题、模型执行入口与启用状态
  runtime/                       # 初始化复制的必要运行源码与提示/schema
    bang.mjs
    organizer.md
    output.schema.json
    start.ps1
    whiteboard.mjs               # 将已提交语义增量适配到白板；只保存独立视图
  topics/<专题>/
    state.json                   # 已处理完成轮ID、覆盖范围、当前版本
    board.json                   # 语义白板；无需浏览器即可完成
    view.json                    # 浏览器视图、手改、布局及已显示增量
    discussion.md                # 当前整理与判断变更原因
    sources.jsonl                # 实际收到的完整轮原文
    updates.jsonl                # 语义增量记录
    runs/<轮ID>/                 # 输入、独立模型响应与错误日志
  logs/worker.jsonl              # 初始化、处理完成、错误等事件
```

运行与整理均在这个目录内发生；宿主认证仍由 Codex 自身管理，不复制任何凭据。PIM 原会话保持在原位置，后台验证使用独立的 `companion-validation` 专题。

## 命令

从插件源码运行一次 init，显式给出调用者工作区、当前聊天ID、其准确 transcript 路径和桌面 Codex executable。不要扫描所有聊天或猜测最新文件。

```powershell
node runtime/companion/bang.mjs init --workspace "<项目绝对路径>" --chat "<当前聊天ID>" --transcript "<当前聊天记录绝对路径>" --codex "<兼容的Codex.exe绝对路径>" --model "<可用模型>" --topic discussion
```

默认从初始化完成轮边界开始；`--backfill 2` 可补处理最近两条已完成真实轮，不代表启用后新产生的事件。已有聊天的首次全量整理和自动发现聊天参数尚未接入技能；当前 `skills/bang/SKILL.md` 仍是手动整理入口。

初始化命令从 Bang 仓库执行，后续命令切换到所选项目目录执行。需要当前宿主可读取的真实 transcript、兼容的 Codex 独立执行入口和可用的模型访问；仓库不提供这些用户数据或凭据。

```powershell
powershell -File .bang/runtime/start.ps1
node .bang/runtime/bang.mjs status
node .bang/runtime/bang.mjs pause
node .bang/runtime/bang.mjs stop
node .bang/runtime/bang.mjs resume
powershell -File .bang/runtime/start.ps1
```

pause/stop 停止接收新任务；已开始的整理完成落盘后退出。resume 只改启用状态，再用 start 启动进程。重复启动会因 worker.lock 拒绝。当前版本不会在失败时反复调用模型；错误记录在 logs，进程退出，修正后再启动。不是操作系统服务，不宣称重启电脑后自动恢复。

整理明确否定旧结论时复用节点ID标记 rejected/✕，或移除过时节点和关系；原因保留在 discussion/updates，不追加无意义的新旧连线。未决争议保留 disputed。后台不把整理结果回注主聊天。

## 验证范围

独立模型入口使用桌面自带 Codex CLI，读取宿主已有认证，独立 ephemeral 会话、read-only 沙箱，仅返回结构化结果。全局 npm Codex 0.130.0 与当前配置不兼容，因此没有使用它，也没修改全局配置。

完成两个历史真实轮的独立增量整理只能证明来源解析与模型路径；**启用后新轮自动接收必须等当前主聊天回合结束，再在后续回合查看 worker 日志证明**。不把重放、合成事件或进程在运行当作实时链路验证成功。

后续已观察到两条新真实完成轮自动整理，revision 从 2 到 4；后台整理不依赖浏览器打开。

## 查看自动更新的白板

启动现有白板服务（`prototypes/whiteboard-integration` 下 `npm run dev`），打开：

http://127.0.0.1:5180/?topic=discussion

URL 的 topic 对应服务所配置项目的 `.bang/topics/<topic>/`。当前 `vite.config.ts` 默认读取 Bang 仓库；若初始化到外部项目，须给 `createBangMiddleware({projectRoot: '项目绝对路径'})` 配置同一项目并重启服务，尚无项目切换界面。页面每 700 ms 读取已提交 revision 的增量，后台模型完成后自动更新，无需手动刷新。只监听绑定聊天，模型整理耗时仍独立于这个轮询间隔。关掉网页不影响后台整理；重新打开会从已保存的 view.json 接续。根地址是手动整理/PIM 回放入口，不会被后台专题覆盖。

后台输出的 sourceIds 转为可查看原文的消息引用；rejected 结论使用同一节点并加 ✕，删除结论时移除失效关系及线上的标签，不堆叠新旧链路。用户文字与新判断冲突时显示采用建议；删除手改内容也先给建议。视角、手摆位置和手调线复用编辑器保护。撤销后已接收事件不会被轮询反复重放。

已做最小 UI 验证：真实 revision 4 数据通过专题 API 显示；隔离副本提交一次新 revision，页面自动原位否定/删除且保持手摆位置和视角；撤销/重做及保存刷新恢复通过，运行时异常 0。验证未写回真实专题或 PIM，记录在 `prototypes/whiteboard-integration/evidence/background-view/results.json`。`validate-background.mjs` 可重跑；当前服务仍是开发服务，未做插件安装包或机器重启自启。
