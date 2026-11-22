# 02: 两层整理引擎与 GDN 总结

Status: needs-info

**What to build:** 用户分批同步真实 GDN 会话，可从总结查到一次理解转折及其依据。

**Blocked by:** [01 隔离 v1，打通专题与 Episode](01-workspace-episodes.md)

- [x] Pass 1 持久化 session_subgraphs；Pass 2 从会话子图和专题上下文产生结构化算子，事务更新专题版本并导出确定性快照。使用兼容 API 走通正式提交路径。
- [ ] 通过公开入口向空专题分批录入 17 轮，单会话软预算 3–7 个路标；无新增理解时允许空增量，不创建空版本。
- [ ] 在 16:59 后保存 inspect 输出与 Episode 引用，核对两个 key 算例的条件和更新列数。用户自述理解只记录为自报。
- [ ] 末轮保存第二份输出与来源，能找回 17:20 关于 S k 与写入误差的追问，列出 α、β 配合及完整单 token 流程等待深入内容。

[父规格](../spec.md)

## Comments

整理引擎已合并至 `integration/bang-v2`（`66e0c13`）。通过受控的回环兼容 API，公开 CLI 分批录入 17 轮并验证两阶段提交、来源查询、重启回读与空增量。私有证据位于 `.scratch/bang-v2/validation/02-gdn/controlled-ISYGVd/`，其中包含两个检查点的 inspect 输出和 Episode 引用。该端点使用预设模型输出，真实模型的 GDN 提炼与语义验收仍待执行。

代码审查修复合并于 `453f47d`，受控用例在 Node 22.13.0 上复跑通过，证据位于 `.scratch/bang-v2/validation/02-gdn/controlled-Jk7Nxu/`。本地 Qwen2.5-3B-Instruct Q4_K_M 通过兼容 API 结构化输出探测。实际 GDN 重放分别在 120 秒和 300 秒超时下停在第一批 Pass 1，专题语义版本为 0。两次失败记录位于 `.scratch/bang-v2/validation/02-gdn/configured-82fVrL/` 和 `configured-9U5veW/`。继续验收需要能完成整理的兼容模型端点和模型名。
