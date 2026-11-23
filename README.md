# Bang v2

Bang 把围绕专题展开的对话保存在本机，整理为可追溯到原文的认知路标。CLI 提供专题管理、原文录入与修订、手动同步、检查和导出。

## 从源码安装 Bang 技能

需要 Node.js 22.13 或以上版本。在源码仓库运行一次。

```sh
node install.mjs
```

在学习目录中启动 Codex，在对话里输入 `$bang`。首次使用按目录名创建专题、绑定本次会话，并返回可自行打开的一次性白板链接。整理模型尚未配置时，Bang 仍会保存有效问答。

更新源码后重跑安装脚本可更新用户级入口。安装保留用户自行编写或编辑的同名技能。

## 使用 CLI

需要 Node.js 22.13 或以上版本。在此仓库运行以下命令，将 `/path/to/project` 替换为已有项目目录。省略 `--project` 时使用当前目录。

```sh
npm ci
npm run bang -- --project /path/to/project init
npm run bang -- --project /path/to/project topic create gdn --title "GDN 学习"
npm run bang -- --project /path/to/project topic list
npm run bang -- --project /path/to/project topic switch gdn
```

创建专题会将其选为当前专题。归档后仍可查询其原文。CLI 会按需启动项目的回环守护进程。使用 `serve --foreground` 查看启动错误，使用 `status` 查询端口，使用 `stop` 关闭服务。默认端口为 4318，已占用时顺延。

`open --topic gdn` 在默认浏览器中完成一次性会话交换。使用 `open --url` 时，CLI 输出可供浏览器打开的一次性地址。

## 采集 Codex 会话

在 Codex 的当前会话中运行 `bang bind --topic gdn`，采集从该轮开始。从外部终端使用 `bang bind --topic gdn --session <id>`，在两轮之间绑定会从下一轮开始。Bang 从 `$CODEX_HOME/sessions`（默认 `~/.codex/sessions`）定位本项目中明确指定的主会话。宿主提供的 transcript 路径和活动轮标识也可以通过 `--transcript` 和 `--turn` 指定。

`bang status` 显示会话绑定状态和已处理的最后一轮。退出守护进程保留绑定，重新启动后补齐期间的对话。`bang unbind --session <id>` 结束采集，再次绑定时跳过中间的对话。

采集跳过纯 Bang 操作。混合轮只保存可独立辨认的专题问答。无法分离的白板修改指令会跳过 Episode 采集，人工编辑及字段锁定接入待 [06 白板原地编辑](.scratch/bang-v2/issues/06-edit-proposals.md) 完成。

## 录入和回读 Episode

将一个 JSON 对象通过标准输入交给 `ingest --topic gdn`，或用 `--file` 指定 JSON 或 JSONL 文件。多个活跃专题时需明确指定专题。来源工具、会话和来源轮次标识应直接沿用来源数据。

```json
{
  "sourceTool": "chatgpt",
  "sessionId": "source-session-id",
  "turnId": "source-turn-id",
  "messages": [
    {"role": "user", "timestamp": "2026-11-20T16:55:00+08:00", "content": "为什么示例只更新第一列？"},
    {"role": "assistant", "timestamp": "2026-11-20T16:56:00+08:00", "content": "第一个例子使用了第二个元素为零的 key。"}
  ]
}
```

```sh
npm run bang -- --project /path/to/project ingest --topic gdn --file episode.json
npm run bang -- --project /path/to/project episode list --topic gdn
npm run bang -- --project /path/to/project episode get <episode-id> --topic gdn
npm run bang -- --project /path/to/project topic archive gdn
```

每次录入会返回 Episode ID。修订时保留原来源轮次标识，并用 `--replaces <episode-id>` 或 JSON 的 `replacesEpisodeId` 指向直接前版。重复投递同一版会返回已有 ID。

原文和修订存于项目的 `.bang/bang.db`，进程发现与 CLI 凭据存于 `.bang/server.json`。初始化会向项目的 `.gitignore` 添加本地数据库、发现和凭据文件的忽略规则。项目配置启用显式采集。

## 整理和检查专题

手动同步需要显式配置兼容 Chat Completions JSON Schema 输出的模型。可在 `.bang/config.json` 中设置 `llm.base_url` 和 `llm.model`，也可通过 `BANG_LLM_BASE_URL` 和 `BANG_LLM_MODEL` 覆盖。基础地址通常以 `/v1` 结尾，模型需要凭据时通过环境变量 `BANG_LLM_API_KEY` 提供。从环境配置时，先停止已运行的守护进程，再从配置了环境变量的终端同步。同步时会将本批 Episode 的原文发送到所配置的地址。 单次模型请求默认超时 120 秒，可用 `llm.timeout_ms` 或优先级更高的 `BANG_LLM_TIMEOUT_MS` 设置，接受 1 到 3,600,000 毫秒的整数。

```sh
npm run bang -- --project /path/to/project sync --topic gdn
npm run bang -- --project /path/to/project status --topic gdn
npm run bang -- --project /path/to/project inspect --topic gdn --query "为什么示例只更新第一列？"
npm run bang -- --project /path/to/project export --topic gdn
```

`sync --session <source-session-id>` 可指定一个会话。输出包含每个会话的终态。`inspect` 显示路标、关系、个人认知与来源 ID，可用 `episode get` 回读对应问答。专题快照写入 `.bang/topics/<slug>/` 的三份 JSON 文件。

## 开发与归档

`npm run typecheck` 校验 TypeScript，`npm test` 通过临时项目的 CLI 和回环 HTTP 服务测试专题、原文、并发启动与鉴权。

[原始产品需求](docs/design/requirements.md)、[v2 规格](.scratch/bang-v2/spec.md)和[架构设计](docs/design/bang_v2_architecture_design.md)留在当前仓库。[冻结用例和评分](baselines/whiteboard-v1/)可用于 v2 评估。v1 运行时、原型、发布脚本和历史评估程序位于 `legacy-v1` 标签，可取出独立工作树运行。

```sh
git worktree add --detach ../bang-legacy-v1 legacy-v1
```
