# 07: 从 Codex 讨论到白板来源问答，联合验收

Status: ready-for-agent

**What to build:** 在已配置整理模型的环境从源码安装，通过真实 Codex 讨论、自动整理和可交互白板完成一次 GDN 学习回看。

**Blocked by:** [04 查看各专题白板与进度，保持停采边界](04-status-board-links.md)、[v2 03 最小静谧画布与 GDN 原文溯源](../../bang-v2/issues/03-gdn-canvas.md)、[v2 05 自动同步、失败隔离与恢复](../../bang-v2/issues/05-job-recovery.md)

- [ ] 从宿主调用 `$bang`，自行打开链接。按 GDN 用例分批讨论，在中途及最终检查点查看专题实际生成的内容。
- [ ] 从“只更新第一列？”找到相应的成立条件和纠偏依据，打开来源并核对原始用户提问与助手回答。
- [ ] 从宿主查询进度、停止、继续交谈并重新打开白板，确认历史可回读且停采期间的讨论未入库。
- [ ] 留存中途与最终检查结果、最终画布截图和抽查的 Episode 引用，由用户联合评审整理内容与交互白板。

[父规格](../spec.md)

## Comments

### 2026-11-23 · 技术验收

在隔离的 `gdn` 目录从 `acab922` 的源码安装，使用真实 Codex 调用 `$bang`，回执确认自动采集并给出一次性链接。验收用回环转接调用真实 `gpt-6.2-sol` 模型进行两阶段整理，Chromium 从回执链接访问实际白板。对话按 GDN 学习用例的关键检查点新写为两批，每批五轮。[运行记录](../validation/live-gdn-nNjIVB/run.json) · [脱敏回执](../validation/live-gdn-nNjIVB/start.json)

- 五轮入库后自动发布白板第 1 版。保留了 `[1,0]ᵀ` 与 `[1,1]ᵀ` 的对照、误差写入条件，以及只解码一个 token 的误解。用户说“理解了”时记录为自报理解。[中途 inspect](../validation/live-gdn-nNjIVB/midpoint.json) · [中途白板](../validation/live-gdn-nNjIVB/midpoint-canvas.png)
- 十轮入库后自动发布第 2 版。`S k` 读出已有预测并参与计算写入误差。用户完成逐列推导后记录为已验证。α 与 β 的配合和完整单 token 流程保留为待讲问题。终版新增了门控衰减的限定，早期条件栏仍有一处“第 j 列实际变化”的宽泛表述，评审时请结合紧邻的误差写入限定核对。[终版 inspect](../validation/live-gdn-nNjIVB/final.json) · [白板总览](../validation/live-gdn-nNjIVB/final-overview.png) · [待讲问题](../validation/live-gdn-nNjIVB/final-pending-study.png)
- 从“单个 token 会更新哪些列？”沿“用逐列增量解释单个 token 的写入范围和生效条件”打开结论，核对 `β`、`e`、`kⱼ` 的非零条件。通过路标打开纠偏 Episode `6fe489a2-ac8d-41a4-a6cb-e701b70403d3`、用户推导 Episode `6600022f-1ffd-41d6-ade0-9d4d16fa5bfe` 和两列算例 Episode `989dc257-4786-4d83-8639-200149a12b79`，逐条核对了用户提问与助手回答。[浏览路径及原文](../validation/live-gdn-nNjIVB/browser-path-and-sources.json) · [成立条件](../validation/live-gdn-nNjIVB/reopened-conditions.png) · [纠偏原文](../validation/live-gdn-nNjIVB/reopened-correction-source.png)
- 宿主查询显示正在采集、已保存十轮和白板第 2 版。通过 `$bang stop` 停止，继续了一轮关于第三列的 Codex 讨论。再次调用 `$bang status` 显示无会话正在采集，并返回可打开的白板链接。浏览器显示原来的十轮，Episode ID 列表保持一致，关于第三列的新讨论留在采集区间之外。[停采与重开](../validation/live-gdn-nNjIVB/stop-and-reopen.json) · [停采后问答](../validation/live-gdn-nNjIVB/after-stop-discussion.json) · [重新打开的原文列表](../validation/live-gdn-nNjIVB/reopened-history.png)

先行试跑的五轮原文全部保存。原模型提示下，三次整理均把用户复述标为已验证，语义校验拒绝后白板保持第 0 版。上述对照运行的末批中，模型第一次写错一位来源 ID，公开作业状态记录了拒绝，自动重试后才发布第 2 版。[先行作业状态](../validation/live-gdn-VmbynW/midpoint.json) · [被拒绝的模型提示结果](../validation/live-gdn-VmbynW/midpoint-rejected-epistemic-hints.json) · [末批重试状态](../validation/live-gdn-nNjIVB/final-jobs.json)

在模型提示修订 `4ff48b9` 后也完成了实际宿主和白板验收。首批五轮在第一次尝试发布第 1 版。浏览器脚本最初按字面“第一列”找标题，漏掉了“单个 token 会更新哪些列？”，触发清理停采。随后通过已安装的技能重新绑定同一 Codex 会话，重开白板，并核对中途 inspect 完全一致，再继续最终五轮。第二批第一次整理输出有误的 `about` 关系，重试后发布第 2 版。独立推导 Episode `16c56502-98ba-4d25-8c11-eaca040d642b` 被记录为已验证。末尾从真实 Codex 停采并继续对话，之后用 `$bang status` 的新链接重开，仍为十轮且无会话采集。[重开后的中途白板](../validation/live-gdn-tK6mpI/midpoint-reopened-canvas.png) · [终版 inspect](../validation/live-gdn-tK6mpI/final.json) · [末批作业](../validation/live-gdn-tK6mpI/final-jobs.json) · [终版白板](../validation/live-gdn-tK6mpI/final-canvas.png) · [抽查原文](../validation/live-gdn-tK6mpI/source-spot-check.json) · [停采后历史](../validation/live-gdn-tK6mpI/reopened-history.png) · [宿主进度与停采回执](../validation/live-gdn-tK6mpI/stop-and-reopen.json)

整理内容和实际可交互白板待用户共同评审后签核。
