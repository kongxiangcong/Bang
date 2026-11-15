# Bang 增量协议

工作目录：`prototypes/whiteboard-integration`。默认 `npm run dev` 启动 `http://127.0.0.1:5180/`，CLI 尊重 `BANG_URL`。打开或复用浏览器白板后，`node bang.mjs context` 读取当前活动会话；`node bang.mjs submit <json>` 提交下面的数据。模型选择内容关系，浏览器渲染器据此安排局部布局并回写 `appliedEventIds`。

```json
{
  "messages": [
    {"id": "m035", "role": "user", "text": "本轮用户原文"},
    {"id": "m036", "role": "assistant", "text": "本轮模型原文"}
  ],
  "event": {
    "id": "discussion-018",
    "goal": "本轮想弄清的问题",
    "changes": {
      "upsertGroups": [
        {"id": "g-question", "title": "议题", "goal": "需要澄清什么", "relation": "radial", "explanation": "这些内容围绕同一问题展开"}
      ],
      "upsertNodes": [
        {"id": "n-question", "groupId": "g-question", "text": "图上简述", "explanation": "完整解释、推导步骤、条件与未知。", "status": "open", "sources": [{"messageId": "m035"}]}
      ],
      "upsertRelations": [],
      "removeNodeIds": [],
      "removeRelationIds": []
    }
  }
}
```

- `messages` 可省略，表示仅整理当前已出现的内容；新消息 id 使用 context 的 `nextMessageId` 后续编号。追加原文的行号由服务分配；其 source 可只填 `messageId`。已有原文可以带 `startLine/endLine`，必须落在那条消息范围内。
- `event.id` 每个增量唯一；重试同一 id 幂等。`goal` 描述本轮目标；`throughRound` 可省略，由服务从消息确定。
- `upsertGroups` 的 `relation`：`loose` 是独立事项；`hierarchy` 是包含分类；`radial` 是中心议题发散；`sequence` 是执行顺序。这是本轮内容关系的判断，不要求每次生成四种表达。稳定 group id 保持区域连续。
- `upsertNodes` 使用稳定 id；`text` 为图上摘要，`explanation` 保留文字推导；`sources` 指向已出现原文；`status` 为 `reported`、`hypothesis`、`open` 或 `inferred`。
- `upsertRelations` 项为 `{ "id": "r-1", "from": "node-a", "to": "node-b", "kind": "supports", "label": "依据" }`。`kind` 可为 `contains`、`sequence`、`association`、`supports`、`revises`，端点必须存在。关系需要时才创建。
- 更新节点时提交它的新语义内容，渲染器合并局部场景并保留其他对象。删除节点时在 `removeRelationIds` 一并删除其关联关系。更正判断通常用更新/修正关系保留推导，不必删除历史依据。
- `context.objects` 是当前画布状态；其中 `bangNode`、`bangGroup`、`bangRelation` 是语义内容，`text` 是当前实际图中文字，`pendingNode` 是尚未接受的建议。用户手改与建议同时存在时不能把建议当作已接受结论。

回放未完成时 submit 不接续新消息，以免跳过尚未发生的原文。完整回放后可连续 submit；通用新讨论使用显式 `reset --empty`。会话保存在项目内 `.bang/sessions/pim.json`，文件名不限制讨论主题。`scene` 包含实际场景、视角、文件与已应用事件 id；模型通过 submit 更新，避免自行覆写场景快照。
