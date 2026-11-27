# 架构

本文说明工作台当前的扩展点、宿主服务和数据边界。安装步骤见[安装与升级](INSTALL.md)，功能变化见[版本记录](CHANGELOG.md)。

## 挂载与界面

- 工作台通过 Harness 官方 `sidebar.footer.action` 和 `shell.overlay` 扩展点挂载，不替换 `ui-layout`。
- DSH 对话栏使用官方会话界面；可以留在侧栏，也可以作为编辑器标签展示。会话与文件共享编辑器分组布局。
- 浮动模式仍在同一原生窗口的 overlay 中渲染，通过固定定位实现移动和缩放，不创建独立系统窗口。
- 工作台关闭对话栏后打开官方右侧栏时，布局直接到达目标状态，避免短暂露出隐藏的聊天内容；对话栏显示时保留官方过渡。

## 宿主服务

- 客户端界面通过 `ui-renderer` 槽位注册，当前会话由 `ui-session` 提供。
- 文件、搜索、Git 和终端操作根据当前 Session 的 `workingDirectory` 定位工作区。
- HTTP 与 WebSocket 请求使用 Harness 认证，并检查 Host/Origin；终端接口还限制为 loopback。
- 终端进程由官方 `ClientTerminals` 控制器管理；浏览器由官方浏览器面板管理。工作台不创建自建终端进程或浏览器页面。

## 源码布局

| 路径 | 内容 |
| --- | --- |
| `src/host/` | 宿主端的文件、Git、SSH、调试、预览、HTTP API 和文件监听。 |
| `src/client/` | 工作台、DSH 接入、编辑器，以及 Git、终端、SSH、设置、搜索、LSP、预览等界面和服务。 |
| `src/shared/` | 宿主与客户端共用的类型及纯逻辑。 |
| `build/`、`tests/` | 构建入口与打包配置；测试按功能分组，公共工具位于 `tests/support/`。 |

## 安全与数据保护

- 本地文件路径限定在当前工作区，并检查目录穿越和符号链接越界。
- 保存按文件版本校验，使用原子替换；草稿按 Session 与工作区隔离。
- SSH 文件操作会在远端校验规范化路径，避免访问选定工作区之外的内容。
- 详细边界见[数据保护与恢复](features/reliability.md)和[官方终端与浏览器](features/native-tools.md)。

## Harness 兼容性

当前插件版本 `0.5.0` 在 `package.json` 中声明 Harness `>=0.2.1-rc.1`。开发和 CI 使用 Harness `0.2.2-rc.5`、Cordis `4.1.0` 作为验证基线。兼容性预检会在安装时检查 `engines.dsh` 和相关 peerDependencies；安装失败时见[排错说明](INSTALL.md#安装失败harness版本不兼容)。

历史版本与已发布功能见[版本记录](CHANGELOG.md)。

## 搜索与替换 API

接口位于认证保护的 `/dsh-vscode/api/` 路径，并通过 `sessionId` 定位会话。

| 方法 | 请求 | 返回 |
| --- | --- | --- |
| `search` | `query`；可选 `caseSensitive`、`wholeWord`、`regex`、`include`、`exclude`、`captureGroups`。 | `matches` 包含相对路径、行列、文本和按需捕获组；`limited` 表示结果已截断。 |
| `search.replace` | `cwd` 与按相对路径分组的 `files`；每项编辑提供 `line`、`column`、匹配 `length`、`lineHash` 和替换文本 `text`。 | `changed` 列出成功处理的文件；`failures` 按文件返回失败原因。 |

替换前会重新校验匹配行和文件版本。二进制、非 UTF-8、超过 5 MiB 或匹配已变化的文件不会被写入。
