# Bang · Windows 与 Linux x64 本地验证包

Windows 使用 ZIP 并通过 PowerShell 调用解压目录中的 Bang.cmd。Ubuntu x64 使用 tar.gz，并在 Linux 文件系统上解压以保留执行权限。两个包均包含 Node 25.8.1、原生帮助程序和预构建编辑器。运行需要浏览器和安装资源以外的现有项目目录。项目 Runtime 仅监听回环地址，关闭浏览器或编辑器服务后可继续运行。

## 首次使用

以安装位置为当前目录。将示例路径替换成已有项目和固定版 Codex 原生可执行文件的路径。

    .\Bang.cmd plan --project "D:\项目 工作区"
    .\Bang.cmd check --project "D:\项目 工作区" --codex "C:\工具\Codex\codex.exe"
    .\Bang.cmd prepare-codex --project "D:\项目 工作区" --codex "C:\工具\Codex\codex.exe"
    .\Bang.cmd serve --project "D:\项目 工作区"

Linux 示例（以解压得到的安装目录为当前目录）。

    ./bang plan --project "$HOME/项目 工作区"
    ./bang check --project "$HOME/项目 工作区" --codex "$HOME/工具/Codex/codex"
    ./bang prepare-codex --project "$HOME/项目 工作区" --codex "$HOME/工具/Codex/codex"
    ./bang serve --project "$HOME/项目 工作区"

plan 显示项目级入口的状态。check 验证包内资源、Node、SQLite 和 Codex 0.169.0-alpha.11.1 的原生版本。两条命令均以只读方式访问项目和安装资源；版本检查使用独立临时目录。版本检测以本地原生可执行文件的 --version 为准。check 的零退出码表示资源验证和版本检测通过。

prepare-codex 在项目的私有 Runtime 目录创建供审阅的 hooks.json 和可读 command.txt。项目已有 hooks 时，在阅读候选配置后，手动将对应事件合并到项目的 .codex/hooks.json。项目没有 hooks 时，可显式运行以下命令创建项目入口。

    .\Bang.cmd install-codex --project "D:\项目 工作区" --codex "C:\工具\Codex\codex.exe"
    ./bang install-codex --project "$HOME/项目 工作区" --codex "$HOME/工具/Codex/codex"

在 Codex 对该项目完成常规信任，打开 /hooks 并审阅生成的命令。确认后在所选会话键入准确的激活短语 Bang: enable current session。检查结果和入口生成表示安装预检通过，会话实际启用、已完成轮接收与回送各有独立状态。绝对安装路径变化时重新生成候选入口并在 Codex 重新审阅。

serve 输出完整编辑器 URL。打开该 URL，Ctrl+C 关闭编辑器服务。要显式停止项目 Runtime，运行以下命令。

    .\Bang.cmd stop --project "D:\项目 工作区"
    ./bang stop --project "$HOME/项目 工作区"

Organizer 使用独立的 Codex 授权和模型配置。需要试用时，见源码的 runtime/codex/EXECUTOR.md。项目已有队列任务时，启动 Runtime 可恢复任务。

## 从指定提交构建验证包

在目标平台使用 Git、tar 及 Node 构建。Windows 使用系统自带的 BSD tar 处理 ZIP，Ubuntu 需要 tar、xz 和 gzip。通过 Node 官方发行目录获取 node-v25.8.1-win-x64.zip 或 node-v25.8.1-linux-x64.tar.xz，固定 SHA-256 可与同一目录的 SHASUMS256.txt 对照。构建器从提交提取源码，在临时目录依据锁文件运行 npm ci 和 TypeScript/Vite 构建，最后发布验证目录、压缩包和 SHA-256 文件。

    node release/package.mjs --node-archive "D:\输入\node-v25.8.1-win-x64.zip" --output "D:\输出\bang-validation" --ref HEAD
    node release/package.mjs --node-archive "$HOME/输入/node-v25.8.1-linux-x64.tar.xz" --output "$HOME/输出/bang-validation" --ref HEAD

构建器使用独立 npm 缓存，也可选择 --npm-cache 提供现成缓存。输出父目录需存在。压缩包内清单逐文件记录 SHA-256，并记录源码提交、Node 官方归档哈希及目标平台。解压后的资源文件需与清单完全一致，运行数据使用项目目录。

Node 归档自带的许可证保存在 licenses/Node-LICENSE。该包用于本地验证。公开分发前仍需完成实际前端 JS、ELK worker、字体与原生二进制的许可证及声明核对，并补齐发布兼容性证据。
