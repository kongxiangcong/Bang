# Bang

对话驱动的思维整理白板。把讨论目标、结论、成立条件、争议和原文来源放在同一张可编辑白板上；随着讨论推进，更新已有对象，保留修正原因。

**白板和讨论属于项目，聊天是可切换的输入来源。** 在目标项目的 Codex 会话中调用 `$bang-bundle`，初始化后台整理与白板；新建会话后再次调用，接着同一专题讨论。

Linux 可以直接从本仓库安装技能并使用本机 Codex。也可使用 Windows 或 Linux x64 验证包提供的入口。之后在目标项目的 Codex 聊天中发送 `$bang-bundle`，独立整理器在完成轮后更新已提交白板。[验证包说明](../release/README.md)

## 在 Linux 从源码运行

需要 Linux、Node.js 22+、npm、util-linux 的 `flock`，以及已有可用认证的兼容 Codex CLI。CLI 须支持 `exec --ephemeral --ignore-user-config --output-schema` 和 `shell_tool` 开关。

在 Bang 仓库根目录安装一次：

```sh
node runtime/bundle/install.mjs
```

安装器会按锁文件补齐缺失的前端依赖，并将技能安装到 `~/.agents/skills/bang-bundle/SKILL.md`。保留 Bang 的安装目录；无需将技能复制到每个项目。

然后在**目标项目目录**打开新的 Codex 会话，调用：

```text
$bang-bundle
```

首次调用创建项目内 `.bang/` 工作区，核对并绑定当前聊天和调用轮，启动后台与本地白板，返回白板链接及各项运行状态。通常无需填写聊天 ID、记录路径或启动命令。若宿主没有提供可靠会话信息，程序会说明缺失项并停止绑定，不按“最新文件”猜测。

白板链接指向运行程序的 Linux 机器。远程环境需要宿主支持端口转发；启动服务不代表已对外发布。

## 跨会话继续讨论

在同一项目新建会话，再次调用 `$bang-bundle`。程序保留原专题、白板、原文与进度，将输入来源切换到当前聊天，并向主助手提供有长度限制的交接摘要：目标、主要结论及条件、未解决问题和建议继续事项。

| 场景 | 行为 |
|---|---|
| 首次调用 | 初始化项目工作区，绑定当前轮，启动服务 |
| 同一会话重复调用 | 检查并复用服务，不重置白板或重复接收 |
| 新会话调用 | 完成旧会话截止点前已接收的任务，再切换来源 |
| 切换时旧任务仍在运行 | 返回“切换进行中”及接收范围，保留待切换队列 |
| 服务停止后调用 | 恢复服务，沿用处理进度和白板链接 |
| 初始化或运行失败 | 报告失败位置，保留数据和可恢复状态 |

新会话从调用技能的这一轮开始接收，默认不回填此前历史。旧会话截止点后完成的轮次不再接收；被排除的旧未完成轮会明确列出。第一版每个项目一个持续专题、一个活动会话绑定。

## 后台如何工作

普通 Node 程序轮询已绑定的聊天记录，等待明确的轮次完成标记，再启动一次独立 Codex CLI 整理。只接收用户消息与助手最终回答，不将工具输出、内部推理或其他聊天作为输入；无新完成轮时不调用模型。网页关闭不影响后台整理。

每轮默认输入规则、当前活动白板、用户手改、上一版讨论摘要及最新问答，不重发全部历史。相关旧原文通过来源 ID 按需回查；输入、活动状态、白板对象数量和交接摘要都有可配置预算。压缩需要保留条件、未决问题和来源，或显式记录归档原因，不能简单截断后标记成功。

白板复用稳定对象 ID。新结论修正旧判断时原位更新或删除，并保存依据；用户手改、布局和视角受到保护，冲突内容作为建议处理。原文、增量和处理进度一起提交，重试或恢复不会重复应用同一轮。

记录保存在本地，但整理需要将问答、活动白板、摘要和获准回查的片段发送给配置的模型服务，会消耗模型额度。程序复用宿主认证，不复制凭据、不修改全局模型配置；依赖自定义 provider 配置的宿主尚需单独适配。

## 查看状态与管理服务

以下命令中的两个路径分别替换为 Bang 安装目录和目标项目目录：

```sh
node /path/to/Bang/runtime/bundle/bang-bundle.mjs status --workspace /path/to/project
node /path/to/Bang/runtime/bundle/bang-bundle.mjs pause --workspace /path/to/project
node /path/to/Bang/runtime/bundle/bang-bundle.mjs resume --workspace /path/to/project
node /path/to/Bang/runtime/bundle/bang-bundle.mjs stop --workspace /path/to/project
```

`pause` 停止开始下一项整理，已开始的一轮先完成；`resume` 沿用进度恢复；`stop` 同时关闭白板服务，保留数据。不要手动删除活跃锁。

状态分别报告初始化、当前绑定、后台进程、白板可访问性及最近成功提交的轮次。**进程已启动不等于真实新轮已成功整理**；调用技能的这一轮尚未结束时，需要在后续轮核对其完成记录。

## 项目数据

```text
目标项目/.bang/
  bundle.json                 # 当前绑定、绑定历史、待切换队列与预算
  worker.json / server.json   # 进程标识与白板端口
  failure.json                # 后台失败位置
  server-failure.json         # 白板服务失败位置
  logs/bundle.jsonl           # 处理、切换与异常日志
  topics/discussion/
    head.json                 # 当前已提交修订
    commits/                  # 问答原文、增量、活动状态与归档
    view.json                 # 用户编辑、布局、视角与已显示事件
    runs/                     # 独立模型调用输入、输出与日志
```

完整问答和修订历史保存在磁盘；发送给模型的活动上下文受预算限制。请将目标项目的 `.bang/` 排除在版本控制之外。Bang 仓库使用源码白名单，个人对话、凭据、依赖、浏览器数据和构建产物不入库。

## 手动白板与旧版入口

只需手动整理时，可启动原白板：

```sh
cd prototypes/whiteboard-integration
npm ci --registry=https://registry.npmjs.org
npm run dev
```

默认服务地址为 `http://127.0.0.1:5180/`。新克隆没有个人 PIM 材料时创建空白讨论。使用项目内的 [bang 手动技能](../skills/bang/SKILL.md) 提交增量；它与全局 `bang-bundle` 是不同入口，不会自动初始化后台。

旧版显式指定 transcript 的 companion 入口保留在 [后台运行文档](../runtime/companion/README.md)。已有工作区可在停止旧 worker 后迁移到 bundle，保留原数据、白板手改和事件 ID。旧版 Windows 的历史验证不代表新版 Linux 真实链路已经完成验收。

## 验证与边界

从仓库根目录运行：

```sh
node --test tests/bundle.test.mjs
cd prototypes/whiteboard-integration
npm run build
```

测试需要 `/usr/bin/chromium`，使用临时项目、合成聊天记录及替代模型 CLI，实际启动后台、Vite 和浏览器。已覆盖绑定失败、重复调用、跨会话切换、运行中切换、手改保护、失败恢复、上下文预算、历史回查和旧版迁移恢复。

当前云宿主没有提供 transcript，因此真实自动接收、真实跨会话链路及真实模型整理仍是待办；全局技能的新会话发现也需在目标宿主验收。生产构建仍有包体大小提示。尚无开机自启、多会话同时汇入、多用户协作、跨设备同步或跨刷新撤销历史。聊天记录格式属于宿主内部格式，升级后需重新核对。

## 进一步阅读

- [bang-bundle 安装、切换机制、预算与回查](../runtime/bundle/README.md)
- [测试结果与真实宿主验收步骤](../runtime/bundle/VALIDATION.md)
- [全局技能说明](../skills/bang-bundle/SKILL.md)
- [白板编辑与手动整理说明](../prototypes/whiteboard-integration/README.md)
- [旧版后台入口](../runtime/companion/README.md)
- [产品需求](../docs/design/requirements.md)
- [早期离线交互原型](../prototypes/lifetime-experience/index.html)
