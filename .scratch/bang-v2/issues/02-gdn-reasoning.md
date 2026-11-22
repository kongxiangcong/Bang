# 02: 两层整理引擎与 GDN 总结

Status: ready-for-agent

**What to build:** 用户分批同步真实 GDN 会话，可从总结查到一次理解转折及其依据。

**Blocked by:** [01 隔离 v1，打通专题与 Episode](01-workspace-episodes.md)

- [ ] Pass 1 持久化 session_subgraphs；Pass 2 从会话子图和专题上下文产生结构化算子，事务更新专题版本并导出确定性快照。使用兼容 API 走通正式提交路径。
- [ ] 通过公开入口向空专题分批录入 17 轮，单会话软预算 3–7 个路标；无新增理解时允许空增量，不创建空版本。
- [ ] 在 16:59 后保存 inspect 输出与 Episode 引用，核对两个 key 算例的条件和更新列数。用户自述理解只记录为自报。
- [ ] 末轮保存第二份输出与来源，能找回 17:20 关于 S k 与写入误差的追问，列出 α、β 配合及完整单 token 流程等待深入内容。

[父规格](../spec.md)
