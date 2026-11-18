# 44 · Codex 发行包权限边界验收

2026-11-18，Windows 11 25H2 x64（26200）和 Ubuntu 24.04.4 x64（WSL2、ext4、非 root）各通过 33 项安装后检查。两平台均使用 `cc80028bd4a61a9ef3940974e09c7bca96761b57` 的实际验证包、随包 Node 25.8.1、原生 Runtime 与 Codex 0.169.0-alpha.11.1。

| 验证包 | SHA-256 |
| --- | --- |
| Windows ZIP | `4803d7a912cf75a39aaedd48ba596a38d99f9fbf1130cb3751fbec36d21cbfd5` |
| Ubuntu tar.gz | `082224dc73bb55323a4590215e56fd761581b1dffbc516a1ac0e9f58a711ec01` |

- **编辑器和 Daemon**。同源启动、正常提交与项目所有者读取成功。错误 Host、跨源、跨站、缺失或不匹配的令牌、把编辑器令牌用于 Daemon、跨项目写入、专题不匹配、未经分配的恢复项目选择及直接使用整理器身份写入均被拒绝。重开后的修订为授权写入专题 1、同项目另一专题 0、独立项目 0。
- **资源和原文**。发行编辑器拒绝带凭据标记的 URL、危险协议、越界相对文件引用、通过 Windows junction／Linux symlink 的外部文件引用及标准 Canvas 导入预览中的越界背景引用。两平台实际 Chrome 验证显示完整 Markdown 和其中的 HTML 为可见原文，无嵌入内容或脚本执行，显示缺失文件占位，安全链接带 `noopener noreferrer`，页面未请求链接目标。
- **来源和整理器**。用安装后的 Hook 和受控 Codex transport 合成事件。未启用来源与子 Agent 在读取正文前被拦截，真实项目 Runtime 将有签名的子 Agent 和整理器事件排除在完成轮之外。合法合成正文只能从对应专题读取。编辑器无法通过公开配置指定执行器。固定版 Codex 在独立空授权目录中于 `AUTH_REQUIRED` 停止，且只有一次尝试，原生监督器确认退出。另对两平台固定版本 CLI 做零工具检查，受控回环服务收到空工具列表，未执行推理。
- **诊断**。普通发布日志仅有时间、事件和修订。编辑器诊断、命令诊断和普通日志均未发现合成凭据、完整提示词、未接收正文或主测试项目的编辑器与 Daemon 临时令牌。通过授权的来源入口读取到完整的合成正文。

## 重跑

在目标平台提供已解压的验证包、固定版本 Codex 和 Chrome。Ubuntu 使用非 root 用户，安装与项目数据位于 Linux 文件系统。

```text
node tests/installed-security.mjs EXTRACTED_PACKAGE PINNED_CODEX
```

浏览器检查运行 `node tests/canvas-resources-browser.mjs`，把 `BANG_BROWSER_PACKAGED_ROOT` 设为解压包，必要时用 `BANG_CHROME` 指定浏览器。Ubuntu 的独立 Chrome headless shell 使用先前已准备的私有共享库路径。零工具检查运行 `node tests/codex-capability-audit.mjs`，把 `BANG_CODEX_AUDIT_BINARY` 设为固定版 Codex。接受测试使用合成短句和临时项目，脚本退出时停止自己的服务并移除临时目录。

早期验证把 junction 提交拒绝状态误写为 400（实际 409），把导入预览拒绝状态误写为 409（实际 400），并误用未公开的忽略事件字段。修正后在旧发行包通过 29 项，追加项目选择、写入身份和来源范围断言后，在新发行包通过 33 项。首次浏览器候选复用了早期的编辑手势，遇到定位和重载等待失败。发行组合验收改为在已保存的合成卡片上验证真实详情。Linux 首次 Chrome 缺少私有 `libnspr4.so` 加载路径，复用 41 的浏览器运行环境后通过。

发行包和真实 CLI 的运行已实测。正常 Codex 会话信任后接收并回送真实完成轮、带真实授权的整理器模型完成、Windows 10 和独立启动 Ubuntu 尚未验收。票保持 `claimed`。
