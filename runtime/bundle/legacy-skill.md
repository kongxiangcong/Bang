---
name: bang-bundle
description: 一键初始化项目级 Bang 后台讨论白板；准确绑定当前 Codex 聊天，在新会话接续同一专题，保留白板手改与来源，管理后台和本地服务。
---

# Bang bundle

用户当前工作目录是目标项目，不是 Bang 的安装目录。首次说明一次：记录保存在项目 `.bang/`；整理需要将问答、活动白板、摘要和按需历史片段发送给配置的模型服务。复用宿主认证，不复制凭据，不修改全局模型配置。不执行 Git 提交、推送、代码上传或发布。

## 一次调用

执行 `node @BUNDLE@ up --workspace <当前项目绝对路径>`。本文件位于源码时，将 `@BUNDLE@` 解析为本技能目录的 `../../runtime/bundle/bang-bundle.mjs`；全局安装器会写入已验证的绝对路径。路径作为独立参数传给执行工具，不拼接用户输入为 shell 代码。

程序优先使用 `CODEX_THREAD_ID` / `CODEX_SESSION_ID`、`CODEX_TRANSCRIPT_PATH` 和 `CODEX_TURN_ID`。无 transcript 环境变量时，只按宿主给出的**确切会话 ID**在 `$CODEX_HOME/sessions` 文件名中定位唯一文件，并验证首条 session_meta 和当前活动 task_started。不得依据修改时间、最近聊天或其他会话内容猜测。宿主工具若明确返回当前会话的路径/轮次，可传 `--chat`、`--transcript`、`--turn`，仍须验证。

若宿主不能提供必要信息，报告程序指出的缺失项；不要让用户填写已经能从宿主取得的信息，不扫描其他聊天。若缺少兼容 Codex CLI 或前端依赖，按安装文档诊断。不要伪造绑定、创建模拟 transcript 冒充当前聊天或把模拟测试叫真实验证。

up 幂等复用服务。同一会话保持原起点；新会话持久化切换请求，先完成旧会话截止点前的已完成轮，再更新绑定。期间返回 pendingSwitch 时明确说“切换进行中”，列出接收范围和不接收的旧未完成轮；随后检查 status，不能提前说已绑定新会话。切换失败保留队列，用 resume 恢复。不要删锁或清空数据。

## 返回与交接

读取 up/status 的 handoff（已限制长度），让主助手知道：目标、主要结论及条件、未解决问题、建议继续事项。不要自动读取全部历史或完整白板，也不要逐轮把后台整理回注聊天。

分别报告 initialized、boundToCurrentHost、workerRunning、whiteboardAccessible、lastSuccessfulRound。返回 whiteboardUrl；远程环境需要宿主支持的端口转发，不能把远端 loopback 说成用户设备可直接访问。不以进程启动证明真实新轮已整理。本轮尚未结束时只能在后续调用中核查对应 turnId 的成功提交。

## 管理与按需历史

同一入口支持 `status`、`pause`、`resume`、`stop`，均带 `--workspace <项目>`。pause 不再接收处理新轮，正在整理的任务先完成；resume 沿用进度。stop 同时关闭页面服务，数据保留。

`history --source <message-id>` 只返回本专题已接收来源；`history --index` 列出归档；`history --archive <archive-id>` 返回单项原推导。只读需要的片段，不扫描其他聊天或源码。预算错误不能用切掉条件、清空白板或放宽隔离来绕过。

后台是普通 Node 轮询程序；仅有新完成轮或该轮必要的回查/纠错时，才调用独立、无工具的 Codex exec。不能用常驻智能体替代监控。
