# Bang

对话驱动的思维整理白板。先理解讨论目标和内容关系，再选择便签、分类树、思维导图或流程；随着讨论修订原对象，保留推导、成立条件和来源。新结论否定旧判断时，原位标记或删除失效内容，不堆叠新旧连线。

当前是可运行的本地原型，包含可编辑白板、手动技能入口和独立后台整理进程。后台自动跟进已在 Windows 桌面 Codex 环境验证，但尚不是安装即用的正式插件。

## 两种使用方式

- **后台陪伴**：显式绑定一个聊天后，每轮用户消息与模型最终回复完成，独立 Codex 进程读取新增内容并整理。成果落盘到项目 `.bang/`，不把整理过程回注主聊天；浏览器打开时自动显示新版本。
- **手动整理**：[Bang 技能](../skills/bang/SKILL.md) 让当前模型读取白板并提交增量。技能尚未全局注册，也尚未自动执行后台初始化；引用技能不等于已经开启自动跟进。

白板支持文字编辑、节点拖动、来源查看、手改冲突建议、撤销/重做与保存恢复。自动连线避开卡片，手调走向可保留。直接拖线改接另一节点尚不会自动修改语义关系。

## 克隆后启动白板

需要 Node.js、npm 和浏览器。本次实测 Node 25.8.1、npm 11.11.0、Windows Chrome。

```powershell
cd prototypes/whiteboard-integration
npm ci --registry=https://registry.npmjs.org
npm run dev
```

打开 [http://127.0.0.1:5180/](http://127.0.0.1:5180/)。没有本地 PIM 材料时会创建空白讨论，不需要下载个人对话或生成日志。根地址是手动整理/回放入口。

## 初始化自动跟进

在仓库根目录执行一次初始化，参数必须来自用户选定的当前聊天，不能通过扫描全部聊天或猜测最新文件代替：

```powershell
node runtime/companion/bang.mjs init --workspace "<项目绝对路径>" --chat "<聊天ID>" --transcript "<该聊天记录绝对路径>" --codex "<兼容的Codex.exe绝对路径>" --model "<可用模型>" --topic discussion
```

然后切换到该项目目录：

```powershell
powershell -File .bang/runtime/start.ps1
node .bang/runtime/bang.mjs status
```

默认只处理初始化之后完成的轮次；需要补整理最近若干完整轮时，初始化加 `--backfill 2` 等明确数量。该流程需要可读取的真实聊天记录、兼容的独立 Codex 执行入口及已可用的模型访问；不提供或复制凭据。具体说明见 [后台运行文档](../runtime/companion/README.md)。

初始化在 **Bang 仓库本身** 时，打开 [http://127.0.0.1:5180/?topic=discussion](http://127.0.0.1:5180/?topic=discussion) 查看自动白板。后台可在其他项目落盘，但当前 Vite 服务默认读取 Bang 仓库：查看外部项目时，需要在 `vite.config.ts` 中显式给 `createBangMiddleware({projectRoot: '项目绝对路径'})` 配置同一项目并重启服务，尚无项目切换界面。

```text
当前项目/.bang/
  companion.json             # 绑定聊天与运行配置
  runtime/                   # 初始化复制的运行源码、指令与schema
  topics/<专题>/
    discussion.md            # 当前讨论、推导与判断变化
    board.json               # 语义白板
    view.json                # 画布、手改和视角
    sources.jsonl            # 已收到的对话
    updates.jsonl            # 增量记录
    state.json               # 版本与已处理轮次
    runs/                    # 独立模型输入输出
  logs/worker.jsonl
```

暂停或停止：`node .bang/runtime/bang.mjs pause` / `stop`。已开始的整理会完成落盘后退出；恢复需要先执行 `resume`，再运行 `start.ps1`。浏览器关闭不影响后台整理，后台和本地白板服务仍需运行，没有开机自启。

## 验证与边界

已验证真实新轮自动接收与独立整理、后台版本到白板的自动刷新、原位否定/删除、手摆布局保留、撤销与刷新恢复。生产构建通过，仍有包体较大的提示。PIM 是另一个本地回放案例，不是产品的领域限制；个人原文和回放增量不随仓库发布。

当前通过绑定聊天记录中的完成轮标记轮询接收内容，**未接通 Stop hook**。记录格式属于宿主内部格式，升级后需核对；全局旧版 Codex CLI 不一定兼容。尚无插件安装包、多用户协作、跨设备同步或跨刷新撤销历史。后台整理的独立模型仍消耗模型额度。

## 源码与数据

- [白板运行与验证说明](../prototypes/whiteboard-integration/README.md)
- [后台整理源码及说明](../runtime/companion/README.md)
- [产品需求](../docs/design/requirements.md)
- [早期离线交互原型](../prototypes/lifetime-experience/index.html)

仓库使用源码白名单。个人对话、`.bang/` 工作区、凭据、依赖、浏览器数据、截图、构建和验证产物不入库；初始化到其他项目时，也应将该项目的 `.bang/` 排除在版本控制之外。
