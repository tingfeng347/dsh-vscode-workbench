# 架构适配

本文说明 `dsh-vscode-workbench` 如何接入 DeepSeek Harness，以及随 Harness 演进的适配记录。安装、升级与版本兼容表见[安装说明](INSTALL.md)。

## 挂载方式

工作台通过官方 `sidebar.footer.action` 与 `shell.overlay` 扩展点挂载，不替换或卸载 `ui-layout`。入口位于 DSH 侧栏的面板列表，与「插件」「自动化任务」等并列；DSH 对话栏由活动栏的鲸鱼图标开关。

「打开方式 → 浮动窗口」不是新的系统窗口：DSH Desktop 只有一个原生窗口，宿主会把 `window.open` 交给系统浏览器，因此工作台仍在 `shell.overlay` 里渲染，只是把 `.dvw-overlay` 从 `position: absolute; inset: 0` 改成 `position: fixed` 加内联的左上角与宽高。标题栏拖动和八向缩放由 React 指针事件计算。标题栏的全屏按钮和双击调用 `requestFullscreen()`，让浮层进入浏览器 top layer 并触发 Electron 的原生全屏，此时 DSH 标题栏、侧栏和对话都被遮住；`fullscreenchange` 同步按钮状态，`Esc` 由浏览器退出。全屏不可用时回退到原来的窗口内最大化，顶部保留 DSH 标题栏。打开方式、几何和内嵌最大化状态分别存在 `dvw:open-mode`、`dvw:float-rect`、`dvw:float-max`。浮动模式不再把 DSH 对话搬进右侧栏，因为对话本来就露在浮层外面。

## 客户端接入

- 界面通过 `ui-renderer` 提供的槽位服务注册，使用 `ui-session` 的 `mainView` 引用选择当前会话，不再依赖已移除的 `dsh-client-runtime`。
- 文件、搜索、Git 和新建终端通过 `workingDirectory.get(session)` 使用会话当前目录，跟随工作目录投影切换；失效会话返回 404。
- HTTP 与 WebSocket 接口使用 `connection.requestRejection()`，共享 Harness 登录认证及 Host/Origin 校验；终端额外保留 loopback 限制。
- 对话栏按官方 `data-phase` 容器定位，兼容新版 `conversation.content` 布局。

## 版本适配

安装前请确认 Harness 版本。插件在安装阶段用 `engines.dsh` 与 peerDependencies 做兼容性预检，不满足时会在 pnpm 执行前中止，详见[安装说明](INSTALL.md#安装失败harness-版本不兼容)。

| 插件版本 | 需要的 Harness |
| --- | --- |
| 0.2.9 | `0.2.1-rc.1` 及以上（默认基线 `0.2.2-rc.1`，Cordis `4.1.0`） |
| 0.2.8 | `0.2.1-rc.1` 及以上（默认基线 `0.2.2-rc.1`，Cordis `4.1.0`） |
| 0.2.7 | `0.2.1-rc.1` 及以上（默认基线 `0.2.2-rc.1`，Cordis `4.1.0`） |
| 0.2.6 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.2.5 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.2.4 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.2.3 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.2.2 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.2.1 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.2.0 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.1.15 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.1.14 | `0.2.2-rc.1`（Cordis `4.1.0`，默认基线）；另验证 `0.2.1-rc.5`（Cordis `4.0.5`） |
| 0.1.12 | `0.2.1-rc.5`（Cordis `4.0.5`，默认基线）；另验证 `0.2.2-rc.1`（Cordis `4.1.0`，Node.js ≥24.9） |
| 0.1.11 | `0.2.1-rc.5`（Cordis `4.0.5`，默认基线）；另验证 `0.2.2-rc.1`（Cordis `4.1.0`，Node.js ≥24.9） |
| 0.1.10 | `0.2.1-rc.4`（Cordis `4.0.5`，旧版验证基线） |
| 0.1.9 | `0.2.1-alpha.3`（Cordis `4.0.5-alpha.2`，旧版验证基线） |
| 0.1.8 | `0.1.1-rc.2` |

Harness `0.2.0-rc.2` 上没有可用的插件版本：0.1.9 依赖 Harness `0.2.1-alpha.2` 才引入的 `workingDirectory` 服务，0.1.8 又只适配 `0.1.1-rc.2`。请先把 Harness 升级到 `0.2.2-rc.1` 再安装 0.2.2。

`dsh plugin allow-version` 只跳过版本闸门，不会补上缺失的宿主服务，在 `0.2.0-rc.2` 上插件仍然加载不起来；请优先升级 Harness。

## 架构演进

`0.1.11` 起，插件把 DSH 开发依赖与 peerDependencies 同步到 `0.2.1-rc.5`（Cordis `4.0.5`），显式声明 `engines.dsh` 与 `0.2.2-rc.1` 的预发布依赖范围。安装版本闸门使用官方 `evaluatePluginCompatibility()` 验证，无需版本豁免。

`0.2.0` 引入语言服务器托管：语言运行时与 LSP 分别检测、分别安装，自动安装的服务器写入插件私有目录，并新增 `/dsh-vscode/file-icons` 路由按需提供 `vscode-icons` 图标。

`0.2.1` 修复会话尚未发布时的终端请求：切换工作区会等待会话就绪并自动重试；同版本确认了 `workingDirectory` 投影在会话切换后的目录跟随。

`0.2.2` 增加 AI 提交信息、工作台设置面板、纯白与护眼主题、并排差异布局修复，并保留与 Harness `0.2.1-rc.5` 的兼容范围。功能层面的完整版本记录见[版本记录](CHANGELOG.md)。

## 官方工具接入

终端通过隔离的官方 `ClientTerminals` 管理进程、恢复和输入控制，工作台只保存 Session 内的终端标签身份及布局。删除自建 `/dsh-vscode-terminal/*` 接口和 `node-pty` 依赖。普通浏览器由官方 `sidebarRight` 导航和渲染，在工作台中间展示原页面，不移动 React 管理的 DOM，也不重建 Electron webview。退出工作台后恢复原页面样式。网页链接和 HTML 文件按设置里的默认浏览器分流；HTML 由带随机令牌的 localhost 静态服务加载，因此相对样式、脚本和图片可用。详细范围与验证见[官方工具接入](native-tools.md)。
