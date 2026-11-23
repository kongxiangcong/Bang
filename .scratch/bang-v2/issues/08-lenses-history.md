# 08: 复盘视角、语义回放与动效

Status: ready-for-agent

**What to build:** 用户可切换学习、决策和演进视角，回看结论或个人认知如何变化。

**Blocked by:** [07 自适应布局、局部稳定与 Pin/Fold](07-stable-layout.md)

- [ ] 学习视角呈现掌握度、未决问题与纠偏史；决策视角展示选项、证据及立场；演进视角显露替代关系。可以标记 verified 或 shaky。
- [ ] 在同一专题先改结论再拖动节点，核对回放只增加相应语义版本，固定节点在视角切换时保持稳定。
- [ ] 增量和状态变动仅局部提示；操作中尊重用户拖拽与编辑，验证 prefers-reduced-motion。

[父规格](../spec.md)
