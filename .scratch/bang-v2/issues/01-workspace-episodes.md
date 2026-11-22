# 01: 隔离 v1，打通专题与 Episode

Status: resolved

**What to build:** 让用户从干净的 v2 工作区启动本地项目，录入、修订并查回真实对话。

**Blocked by:** None (can start immediately)

- [x] 开工先核对工作树与归档提交，确保 legacy-v1 可恢复且不覆盖已有标签。隔离旧运行时、原型和旧测试，保全规格、GDN 原文、冻结用例与评分、领域文档及项目约定。
- [x] 使用 TypeScript 工作区和 Node ≥22.13 原生 SQLite WAL 跑通七表。通过 CLI 初始化、创建、切换和归档专题；重启后可查。
- [x] 两个项目同时启动使用各自的端口与令牌。验证回环地址、Host、Origin、CLI 鉴权和浏览器会话交换；原文库及凭据留在本机。
- [x] 通过公开入口按顺序录入 GDN 的 17 轮，保留角色、时间与来源标识。同文不同轮各自可查，同版重投只计一次，修订可追溯前版。验证并发写入结果。

[父规格](../spec.md)

## Comments

实现已合并至 `integration/bang-v2`（`0687b61`、`cd14616`）。`legacy-v1` 指向 `5ec17ac`。Node 22.13.0 和 22.23.4 均通过 5 项公开入口测试，另用 Chromium 验证一次性交换和两个项目的独立浏览器会话。
