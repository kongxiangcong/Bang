# Bang v2

Bang 把围绕专题展开的对话保存在本机，供后续整理和回看。本阶段提供专题管理、原文录入与修订，以及浏览器会话交换。

## 启动

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

## 开发与归档

`npm run typecheck` 校验 TypeScript，`npm test` 通过临时项目的 CLI 和回环 HTTP 服务测试专题、原文、并发启动与鉴权。

[原始产品需求](docs/design/requirements.md)、[v2 规格](.scratch/bang-v2/spec.md)和[架构设计](docs/design/bang_v2_architecture_design.md)留在当前仓库。[冻结用例和评分](baselines/whiteboard-v1/)可用于 v2 评估。v1 运行时、原型、发布脚本和历史评估程序位于 `legacy-v1` 标签，可取出独立工作树运行。

```sh
git worktree add --detach ../bang-legacy-v1 legacy-v1
```
