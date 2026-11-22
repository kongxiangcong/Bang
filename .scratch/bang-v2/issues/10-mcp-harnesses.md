# 10: 五个 MCP 工具与多 Harness 接入

Status: ready-for-agent

**What to build:** 用户能在 Cursor CLI、Antigravity 和 Codex 间延续同一专题。

**Blocked by:** [05 自动同步、失败隔离与恢复](05-job-recovery.md)、[09 Codex 绑定采集、过滤与混合轮改图](09-codex-capture.md)

- [ ] 用专题管理、记录轮次、查询白板、更新个人认知、立即同步五个工具完成一次跨工具讨论。路由不明时要求选择专题。
- [ ] 已绑定 Codex 会话缺少共同轮次标识时，在 watcher 读到该轮前后提交均返回 watcher_managed，最终一份 Episode、一次计数。提供同一原生标识时同版重投仍幂等。
- [ ] 查询、同步在 watcher 接管时可用，自动投递尊重解绑边界；通过真实宿主入口验证。

[父规格](../spec.md)
