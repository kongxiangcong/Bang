# 06: 在逐轮投递的宿主中使用同一个技能

Status: resolved

**What to build:** 在依靠宿主逐轮提交问答的环境中使用 `$bang`，从回执知道采集方式，并在对应专题找到实际提交的原文。

**Blocked by:** [01 安装一次，在新目录记录第一轮](01-install-first-turn.md)、[v2 10 五个 MCP 工具与多 Harness 接入](../../bang-v2/issues/10-mcp-harnesses.md)

- [x] 从支持逐轮投递的真实宿主启动，回执显示“白板已就绪，宿主提交的问答会保存”。提交一轮后从对应专题回读并核对问答。
- [x] 对照已绑定且监听生效的 Codex 会话，确认回执说明正在自动记录。核实两个宿主各自产生的 Episode 和来源，未投递的讨论不会被报告为已保存。

[父规格](../spec.md)

## Comments

真实 OpenCode 1.19.6 在隔离目录加载同一已安装技能并调用实际 stdio MCP 工具。工具调用由受控回环模型驱动。投递前为零轮，投递后为一轮，来源为 `opencode`，原生会话及轮次标识和逐字问答均可回读。真实 Codex 另行验证自动记录回执和原文。Antigravity 的 stdio 注册通过，隔离会话启动要求登录。[OpenCode 证据](../validation/opencode-delivery.json) · [Codex 证据](../validation/codex-two-projects.json)
