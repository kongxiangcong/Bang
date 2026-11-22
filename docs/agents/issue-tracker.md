# 本地 Markdown 议题跟踪

每个功能使用一个 `.scratch/<feature-slug>/` 目录。

- 规格写入 `spec.md`。
- 每个实施议题单独写入 `issues/<NN>-<slug>.md`，编号从 `01` 开始。
- 在议题文件开头用 `Status:` 记录分诊标签，取值见 `triage-labels.md`。
- 在文件末尾的 `## Comments` 下追加讨论，保留已有记录。

技能要求发布规格或议题时，按上述路径创建文件及所需目录。
读取议题时，使用给定路径，或按功能目录和议题编号定位文件。

## Wayfinder

在 `.scratch/<effort>/map.md` 中维护 Notes、Decisions-so-far 和 Fog。
每个待解问题单独写入 `issues/<NN>-<slug>.md`，从 `01` 编号。

- 在正文写明问题，用 `Type:` 标记 `research`、`prototype`、`grilling` 或 `task`。
- 用 `Blocked by: 01, 02` 这样的字段记录依赖。所有依赖均为 `resolved` 时，阻塞解除。
- 按编号领取第一个尚未解决、已解除阻塞且无人领取的问题。开始前写入并保存 `Status: claimed`。
- 解决后在 `## Answer` 下追加答案，设置 `Status: resolved`，并在地图的 Decisions-so-far 中追加结论摘要和议题链接。
