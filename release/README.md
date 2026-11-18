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

## 维护 Codex 项目入口

运行 plan 或 status 查看现有 .codex/hooks.json 的 SHA-256、Bang 记录的 SHA-256、当前及上一安装包、建议操作和中断状态。check 另验证正在调用的安装包和 Codex 版本。已有或人工修改的 Hook 文件按原字节保留，包括早期版本创建但没有所有权记录的入口。手动合入的入口通过 Codex 项目配置自行维护。

关闭编辑页和 serve 进程后，在原包运行 stop。修复、升级、回退和卸载需要取得空闲的项目写入锁。用当前安装包的 repair-codex 恢复缺失的 Bang 入口。升级时将新包解压到独立目录，保留旧包。在新目录调用 upgrade-codex。它先验证新包资源，再切换 Bang 入口。仍须在 Codex 重新审阅变化后的入口。

    ./bang plan --project "$HOME/项目 工作区"
    ./bang upgrade-codex --project "$HOME/项目 工作区"
    ./bang status --project "$HOME/项目 工作区"

Windows 使用同名子命令，通过 .\Bang.cmd 调用，并提供本机项目路径。

写入失败时保留原入口和安装记录。status 显示 interrupted 时，清除文件占用并运行 rollback-codex，然后重新查看计划。若入口字节已被人工改写，恢复也会保留这些字节，待人工复核。完成升级后要切回上一包，可根据 status 的 previousRelease，在保留的上一包内再次运行 upgrade-codex。每次切换都需要宿主重新审阅。

uninstall-codex 只移除 SHA-256 仍与记录匹配的 Bang 项目入口。安装包目录、用户配置、项目私有注册、白板和历史仍保留。重新运行 install-codex 后可以重开原项目。维护命令不写入宿主全局凭据，也不注册系统自启。

旧项目可先运行 plan --legacy session --project DIR，或为旧 companion 指定 --legacy companion --legacy-topic TOPIC。报告包含选定来源的指纹、计数、写入者状态和待确认项。随后在编辑器使用“旧项目预检与迁移”核对回放并明确提交迁移，按结果选择独立的迁入项目并重新授权 Codex。安装升级与数据迁移分别执行。

## 从指定提交构建验证包

在目标平台使用 Git、tar 及 Node 构建。Windows 使用系统自带的 BSD tar 处理 ZIP，Ubuntu 需要 tar、xz 和 gzip。通过 Node 官方发行目录获取 node-v25.8.1-win-x64.zip 或 node-v25.8.1-linux-x64.tar.xz，固定 SHA-256 可与同一目录的 SHASUMS256.txt 对照。构建器从提交提取源码，在临时目录依据锁文件运行 npm ci 和 TypeScript/Vite 构建，最后发布验证目录、压缩包和 SHA-256 文件。

    node release/package.mjs --node-archive "D:\输入\node-v25.8.1-win-x64.zip" --output "D:\输出\bang-validation" --ref HEAD
    node release/package.mjs --node-archive "$HOME/输入/node-v25.8.1-linux-x64.tar.xz" --output "$HOME/输出/bang-validation" --ref HEAD

构建器使用独立 npm 缓存，也可选择 --npm-cache 提供现成缓存。输出父目录需存在。压缩包内清单逐文件记录 SHA-256，并记录源码提交、Node 官方归档哈希及目标平台。解压后的资源文件需与清单完全一致，运行数据使用项目目录。

Node 归档自带的许可证保存在 licenses/Node-LICENSE。该包用于本地验证。公开分发前仍需完成实际前端 JS、ELK worker、字体与原生二进制的许可证及声明核对，并补齐发布兼容性证据。
