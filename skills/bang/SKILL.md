---
name: bang
description: 在当前学习目录开始或接续 Bang 的专题记录，查看项目白板和采集进度，或停止采集。
---

# Bang

用户输入 `$bang` 或要求打开 Bang 白板时，在当前学习目录开始或接续当前会话的采集。首次按目录名创建专题。在 Codex 中运行以下命令，使用宿主提供的当前会话。

```sh
{{BANG_ENTRY}} skill start
```

在逐轮投递的宿主中，把宿主类型和当前原生会话 ID 作为参数传入。以下命令以 Antigravity 为例，`HOST_SESSION_ID` 取自宿主会话上下文。

```sh
{{BANG_ENTRY}} skill start --harness antigravity --session "HOST_SESSION_ID"
```

宿主也可通过 `BANG_HARNESS` 和 `BANG_SESSION_ID` 提供这两个值。缺少会话 ID 时说明还需要宿主提供会话上下文。

如果宿主沙箱限制本机回环访问，或会在命令退出后回收 Bang 后台进程，通过宿主的常规审批机制执行本次已安装的 Bang 命令。Codex 的执行工具支持 `sandbox_permissions` 时，使用 `require_escalated` 请求本次命令的执行权限。以获批执行后的 CLI 回执为准。

当前会话已有绑定时沿用原专题。用户明确指定专题，或从候选中选定专题时，在启动命令末尾追加 `--topic`，把用户给出的完整专题名、`slug` 或 `id` 作为一个参数传入，并按当前 shell 正确引用参数。

回执为 `choose_topic` 时，告诉用户本会话仍未绑定，列出 `candidates` 中各专题的名称和 `slug`，等用户选定后再运行启动命令。

开始或接续记录后，向用户说明专题名、`message` 中的采集和整理模型状态、`sessions` 中的采集会话。把 `url` 原样显示为一次性链接，交给用户自行打开，即使用户要求“打开白板”也是如此。启动失败时，按 CLI 的错误回复用户。

如果用户同时提出可独立回答的专题问题，先用一个段落回复 Bang 操作结果，再在另一个段落回答问题。

## 宿主投递

由宿主集成在助手回复完整结束后，把专题讨论的问答原文、原生会话 ID 和稳定原生轮次 ID 交给 `bang_record_turn`。宿主应保留启动回执的 `bindingId`，作为 `binding_id` 随本次采集区间内的原文提交。主动停止项目后，迟到的投递须附原 `binding_id` 及宿主原生的 ISO 8601 完成时间 `completed_at`。`recorded` 和 `duplicate` 回执提供可回读的 Episode。只提交实际发生的专题讨论，以回执确认保存结果。

宿主可用以下命令启动 Bang 的 stdio MCP 服务，或将同一投递 JSON 交给 `deliver` 的标准输入。

```sh
{{BANG_ENTRY}} mcp
```

## 查看项目状态

用户输入 `$bang status` 时，在当前学习目录运行以下命令。

```sh
{{BANG_ENTRY}} skill status
```

显示 `message`。状态为 `ready` 时，按 `topics` 每个专题一行列出 `topic.title`、`sessions` 中正在采集的会话、`turnCount` 轮已保存原文、`latestReasoning` 中最近成功整理的会话和轮次，以及可自行打开的原始 `url`。`revision` 为数字时一并显示白板版本。空的 `sessions` 显示“无”，空的 `latestReasoning` 显示“暂无成功整理”。链接失效时，可用 `$bang status` 获取新链接。

## 停止采集

用户输入 `$bang stop` 时，在当前学习目录运行以下命令。

```sh
{{BANG_ENTRY}} skill stop
```

显示 `message`。如果 `unverifiedSessions` 有值，列出这些会话，并说明停止时未能核实其末尾的问答。用户可以再用 `$bang status` 打开已有白板。
