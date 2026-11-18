# 验证记录

日期：2026-11-16（Asia/Shanghai）。当前云环境：Linux、Node 24.22.1、Chromium 156。没有执行 Git 提交、推送、代码上传或对外发布。

## 已验证

- 全局技能已安装到 `/home/agent/.agents/skills/bang-bundle/SKILL.md`；安装内容指向 `/workspace/Bang/runtime/bundle/bang-bundle.mjs`。
- 当前宿主 Codex CLI 0.167.0-alpha.4 支持所需命令能力；`codex login status` 报告已有 ChatGPT 登录。未复制认证文件，未调用真实整理模型，未修改全局模型配置。
- Node 测试覆盖：准确身份/当前活动轮绑定；拒绝缺失、冲突、歧义输入；仅提取完成轮用户与最终回答；原子提交及写入/模型失败恢复；跨会话去重；冻结旧接收队列；运行中切换；用户编辑作为上下文；受限来源回查；条件/未决问题/预算检查；内核锁及 PID 重用识别；旧版迁移保留原事件 ID。
- 实际 Linux 进程及 Chromium 的模拟链路：首次空项目启动；同会话重复调用复用 PID/链接；合成 A 完成轮更新页面；B 切换后沿用页面和对象；A 后续消息不进入；手改文字、布局与视角保留；刷新恢复；替代模型失败后恢复不重复；暂停恢复。
- 65 轮合成讨论的模型输入保持有界、只携带最新轮原文；归档节点及条件可按 ID 回查。

命令：`node --test tests/bundle.test.mjs`。17 项通过，0 失败，0 跳过；日志写入 `/tmp/bang-bundle-tests.log`。
TypeScript 检查与生产构建通过。生产构建命令：`npm run build`，工作目录 `prototypes/whiteboard-integration`。日志 `/tmp/bang-bundle-build.log`。已有 React peer dependency 和构建包体大小提示未通过升级依赖消除。

## 真实链路待办（用户已确认）

当前云宿主有 `CODEX_THREAD_ID` / `CODEX_SESSION_ID`，但没有 `$CODEX_HOME/sessions`，也没有提供当前 transcript 路径。运行真实 `up --workspace /workspace/Bang` 明确拒绝绑定；没有扫描或猜测其他聊天，没有伪造当前聊天记录。用户已选择先交付实现与模拟结果。

因此以下内容均未验证：真实模型服务对整理请求的响应、真实新完成轮的后台自动接收、真实会话 A→B 接续、宿主在新会话中发现并执行全局技能。不把上面的模拟数据或进程状态当作这些验收的证据。

在具有本地 transcript 的 Linux Codex 宿主执行：

1. 全局安装一次。在空目标项目开启真实会话 A，调用 `$bang-bundle`；保存返回的绑定、调用轮 ID、PID、链接和 revision。
2. 让该调用轮真正结束，在后续轮查询 status；核对 lastSuccessfulRound 与 A 的真实完成轮 ID，一并核对新增节点及来源。不要用补写合成 JSONL 替代。
3. 在页面手改一个节点并拖动，等待保存。开启同项目真实会话 B，调用技能；核对 handoff 与原结论条件，链接和 view 延续。
4. B 再完成一轮，核对 B 的真实 ID 提交；让 A 完成另一轮，确认 A 不再进入。查看 lastBindingTransition 的截止范围，明确排除的旧未完成轮。
5. 在旧轮模型仍运行时切换，观察 pendingSwitch，等待提交完成再确认 B 绑定，检查旧队列全部提交一次。
6. 检查手改节点的建议、位置和视角，执行刷新。记录真实模型 stderr、成功 revision、各 turn ID 和来源引用；报告失败点，不删除工作区或活跃锁。

模型需要现有宿主授权和兼容入口；自定义 provider 配置尚需适配。远程白板访问需要宿主支持端口转发。不开机自启、不提供多会话并行汇入或多用户并发保证。

## 2026-11-17：只读安装目录修复验证

本次在独立云 checkout 验证，未接触 200cloud 或用户现有 `.bang/`。

- 安装器实际执行成功（专用测试 skills 目录）。前端 TypeScript 与 Vite production build 通过；仍有既有包体大小提示。
- 新增资源缺失/不自动修补、项目缓存环境隔离、`.bang` 私有权限回归。`node --test --test-skip-pattern="Linux lifecycle" tests/bundle.test.mjs tests/bundle-resources.test.mjs tests/frontend-install.test.mjs`：20 项通过（显式排除受阻浏览器生命周期项）；只读双项目集成另 1 项通过。
- `bundle-readonly.test.mjs`：非 root UID 1000，安装副本去除全部写权限，写入探针明确失败；两个可写目标项目均返回 initialized、boundToCurrentHost、workerRunning、whiteboardAccessible=true。这里的绑定是合成 fixture，不是真实当前聊天。
- 两项目使用不同端口；同项目重复 up 复用 PID 和 URL；字体、ELK worker、主页面及 TSX/scene 转换请求均 HTTP 200。Vite 缓存分别在各项目 `.bang/cache/vite`。运行前后安装副本的路径、大小、mtime 和 mode 清单一致。
- 回归发现并修复 Vite 6 将 port:0 解释成 5173 的问题：首次启动选择空闲端口，后续启动严格复用保存端口。
- 保留原有原子提交、切换队列、旧数据迁移和手改保留逻辑；没有删除用户数据、已有修订或锁。

限制：完整 Linux lifecycle 浏览器测试本次未通过，卡在 Chromium 启动阶段（socket EPERM，即使请求放宽执行权限仍失败），而非应用断言失败。该测试在启动失败前已验证 synthetic up/重复 up 和一次合成完成轮提交；不能报告整项通过。新增浏览器断言要求 FontFace 实际解码和 ELK worker 实际布局；本次没有运行到该断言，HTTP 200 不等价于实际加载成功。云浏览器也无法访问执行器 loopback，因此该项待具有浏览器网络可达性的宿主复核。

真实当前聊天的 transcript 受宿主访问限制，没有读取、扫描、伪造或另造“当前聊天”来绕过。因此本次没有验证真实 turnId 提交、真实整理模型或真实宿主完整运行的写入轨迹。现有真实链路待办仍有效；最终验收必须在可访问当前 transcript 的目标宿主完成一轮后，核对 status.lastSuccessfulRound.turnId 与实际轮 ID，不能用进程启动代替。

用户随后提供的补丁已在基线 8ea91ac 独立 worktree 核对：因 CRLF，普通 git apply 检查失败，使用 --ignore-space-change 后成功。最终实现合入其只读 checkFrontend 接口、resume 修改配置前预检查及 Node --permission 无写权限测试；错误匹配测试按用户最初要求的完整提示语调整顺序。保留额外的临时文件隔离、Vite 缓存读取白名单和独立端口修复。
