---
name: bang
description: 在当前学习目录开始或接续 Bang 的专题记录，查看项目白板和采集进度，或停止采集。
---

# Bang

用户输入 `$bang` 或要求打开 Bang 白板时，在当前学习目录运行以下命令。它从宿主取得当前 Codex 会话，首次按目录名创建专题。

```sh
{{BANG_ENTRY}} skill start
```

根据回执向用户说明专题名、`message` 中的采集和整理模型状态、`sessions` 中的采集会话。把 `url` 原样显示为一次性链接，交给用户自行打开，即使用户要求“打开白板”也是如此。启动失败时，按 CLI 的错误回复用户。

如果用户同时提出可独立回答的专题问题，先用一个段落回复 Bang 操作结果，再在另一个段落回答问题。

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
