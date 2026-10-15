<h1 align="center">DSH VS Code Workbench</h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/dsh-neon-workbench-core.svg" width="220" alt="DSH VS Code Workbench Logo">
</p>

<p align="center">在 DeepSeek Harness 中叠加 VS Code 风格的本地开发工作台。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-vscode-workbench"><img src="https://img.shields.io/npm/v/dsh-vscode-workbench?logo=npm&label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/dsh-vscode-workbench"><img src="https://img.shields.io/npm/dm/dsh-vscode-workbench?label=downloads" alt="npm 月下载量"></a>
  <a href="https://github.com/tingfeng347/dsh-vscode-workbench/stargazers"><img src="https://img.shields.io/github/stars/tingfeng347/dsh-vscode-workbench?logo=github&label=Stars" alt="GitHub Stars"></a>
  <a href="https://github.com/tingfeng347/dsh-vscode-workbench/commits/main"><img src="https://img.shields.io/github/last-commit/tingfeng347/dsh-vscode-workbench?label=last%20commit" alt="最近提交"></a>
  <a href="https://github.com/tingfeng347/dsh-vscode-workbench/blob/main/LICENSE"><img src="https://img.shields.io/github/license/tingfeng347/dsh-vscode-workbench?label=license" alt="MIT 许可证"></a>
  <br>
  <a href="https://awesome-dsh-plugin.com/p/tingfeng347/dsh-vscode-workbench/"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="awesome · DSH plugin"></a>
  <a href="https://dshpluginhub.ai/plugins/dsh-vscode-workbench"><img src="https://dshpluginhub.ai/badges/plugins/dsh-vscode-workbench.svg" alt="DSH Plugin Hub 已收录"></a>
  <a href="https://dshmarket.com/p/tingfeng347/dsh-vscode-workbench/"><img src="https://img.shields.io/badge/dsh--market-已收录-5b7cfa?style=flat" alt="dsh-market 已收录"></a>
  <a href="https://dshmk.com/plugins/1343926987"><img src="https://img.shields.io/badge/DSH%20插件市场-已收录-0ea5e9?style=flat" alt="DSH 插件市场已收录"></a>
  <a href="https://dsh-ai.org/p/tingfeng347/dsh-vscode-workbench"><img src="https://img.shields.io/badge/dsh--ai.org-已收录-8b5cf6?style=flat" alt="dsh-ai.org 已收录"></a>
  <a href="https://duink.com/plugins/1343926987/"><img src="https://img.shields.io/badge/DSH%20Universe-已收录-14b8a6?style=flat" alt="DSH Universe 已收录"></a>
  <a href="https://deepseekplugin.org/plugins/tingfeng347-dsh-vscode-workbench"><img src="https://img.shields.io/badge/DeepseekPlugin-已收录-2563eb?style=flat" alt="DeepseekPlugin 已收录"></a>
</p>

<p align="center"><b>中文</b> · <a href="README.en.md">English</a></p>

## 亮点

- **一体化本地工作台**：资源管理器、Monaco 编辑器、搜索、Git、终端和 DSH 对话集中在一个 VS Code 风格界面。
- **完整文件体验**：文本、Markdown、图片、PDF 和 Word 文档均可直接打开；目录支持拖放上传和常用文件操作。
- **可靠且实时**：原子保存与版本校验避免静默覆盖，WebSocket 会及时标记工作区的外部变更。
- **可视化 Git 工作流**：覆盖状态、暂存、提交、分支、差异、提交文件与泳道式提交图。
- **可持续的工作上下文**：按工作区恢复标签、目录、视图、面板与栏宽；终端支持多会话、分屏与重命名。
- **贴合 DSH**：右侧直接复用 DSH 对话能力，主题与布局集中在工作台设置中管理。

## 功能

- **文件与编辑器**：懒加载目录树、创建、上传、拖放、重命名、删除和 Git 状态；Monaco 多标签编辑支持脏状态、原子保存与冲突提示。
- **预览**：Markdown 支持源码、大纲、相对链接和图片；内置 PDF 翻页缩放与 DOCX 渲染，DOC/ODT 可直接下载打开。
- **搜索与 Git**：`@vscode/ripgrep` 支持大小写、全词、正则和路径筛选；Git 提供暂存、撤销、丢弃、提交、分支、差异、提交文件和提交图表。
- **终端**：基于 `node-pty` 与 xterm，支持最多 8 个会话、会话重命名、右侧切换、分屏、ANSI 输出和 Ctrl+C。
- **布局与 DSH**：左侧视图、终端面板和右侧 DSH 对话栏可独立显示和调整；设置面板管理主题与各栏宽度。
- **同步与恢复**：工作区文件变化实时推送；刷新后恢复活动视图、标签、目录展开、面板和布局。

工作台通过官方 `sidebar.footer.action` 与 `shell.overlay` 扩展点挂载，不替换或卸载 `ui-layout`。

## 演示

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/explorer.png" width="800" alt="资源管理器与 Monaco 编辑器">
  <br><em>资源管理器与 Monaco 编辑器</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/source-control.png" width="800" alt="源代码管理与提交图表">
  <br><em>源代码管理与提交图表</em>
</p>

<p align="center">
  <img src="https://pic1.imgdb.cn/i/034GkZFU8ULHsWgFio93Lw.png" width="800" alt="终端">
  <br><em>终端</em>
</p>


## 安装

插件 0.1.9 适配 DeepSeek Harness `0.2.1-alpha.3`（Cordis `4.0.5-alpha.2`）。请先更新 Harness，再安装插件；Harness `0.1.1-rc.2` 对应插件 0.1.8。

```bash
dsh plugin --profile web add dsh-vscode-workbench
```

### 首次安装终端支持

终端使用 `node-pty`。如果安装日志提示其构建脚本被阻止，在 DSH 所在机器的 `~/.dsh/profiles/web/pnpm-workspace.yaml` 中合并以下配置，保留已有设置：

```yaml
allowBuilds:
  node-pty: true
```

新版 Harness 可能回滚失败的安装，配置后应重新执行安装命令。若插件已安装但终端仍提示 `node-pty` 加载失败，可执行：

```bash
cd ~/.dsh/profiles/web
pnpm rebuild node-pty
```

刚发布不足 24 小时的版本可能被 pnpm 的安全等待期拦截。等待后重试即可；DSH 提供“立即更新”时可直接选择它。

### 从旧版升级

运行中的插件管理器启用 HMR 时，不允许覆盖安装同名包。先在插件管理器中移除旧版，再安装新版；CLI 可使用：

```bash
dsh plugin --profile web remove dsh-vscode-workbench
dsh plugin --profile web add dsh-vscode-workbench
```

完成后重新打开工作台，必要时重启 `dsh web` 并刷新页面。

### 新版架构适配

- 客户端通过 `ui-renderer` 提供的槽位服务注册界面，使用 `ui-session` 的 `mainView` 引用选择当前会话；不再依赖已移除的 `dsh-client-runtime`。
- 文件、搜索、Git 和新建终端通过 `workingDirectory.get(session)` 使用会话当前目录，跟随工作目录投影切换；失效会话返回 404。
- HTTP 与 WebSocket 接口使用 `connection.requestRejection()`，共享 Harness 登录认证及 Host/Origin 校验；终端额外保留 loopback 限制。
- 对话栏按官方 `data-phase` 容器定位，支持新版 `conversation.content` 布局。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl+Shift+E` | 打开资源管理器 |
| `Ctrl+Shift+F` | 打开搜索 |
| `Ctrl+Shift+G` | 打开源代码管理 |
| `Ctrl+S` | 保存当前文件 |
| `Ctrl+Alt+B` | 显示或隐藏 DSH 对话栏 |
| `Ctrl+\`` | 显示或隐藏终端 |
| `Ctrl+Shift+\`` | 新建终端 |

左侧活动栏的终端按钮可切换显示或隐藏终端面板。

## 安全

所有插件接口要求 Harness 登录认证。Host 只接受当前 DSH 会话工作目录内的相对路径，并阻止目录穿越与符号链接越界。保存使用版本校验与原子替换；Git 与 ripgrep 使用参数数组启动，不拼接 Shell 命令。终端只接受同源 loopback 请求，固定在创建时的会话工作目录启动，并移除 API key、token、secret 等敏感环境变量。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

需要 Node.js `^22.19 || >=24`、pnpm 11.7、系统 Git，以及 `node-pty` 所需的本机构建环境（预编译产物不可用时）。

## 许可证

[MIT](LICENSE)
