# 06: 在逐轮投递的宿主中使用同一个技能

Status: ready-for-agent

**What to build:** 在依靠宿主逐轮提交问答的环境中使用 `$bang`，从回执知道采集方式，并在对应专题找到实际提交的原文。

**Blocked by:** [01 安装一次，在新目录记录第一轮](01-install-first-turn.md)、[v2 10 五个 MCP 工具与多 Harness 接入](../../bang-v2/issues/10-mcp-harnesses.md)

- [ ] 从支持逐轮投递的真实宿主启动，回执显示“白板已就绪，宿主提交的问答会保存”。提交一轮后从对应专题回读并核对问答。
- [ ] 对照已绑定且监听生效的 Codex 会话，确认回执说明正在自动记录。核实两个宿主各自产生的 Episode 和来源，未投递的讨论不会被报告为已保存。

[父规格](../spec.md)

## Comments
