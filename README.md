
<h1 align="center">DSH VS Code Workbench</h1>

<p align="center">在 DeepSeek Harness 中叠加 VS Code 风格的本地开发工作台。</p>

<p align="center"><b>中文</b> · <a href="README.en.md">English</a></p>

## 功能

- 资源管理器：懒加载目录，支持新建、重命名、删除和刷新。
- 编辑器：Monaco 多标签编辑、脏状态、原子保存、版本冲突和外部变更提示。
- 预览：Markdown 默认渲染，可切换源码与大纲；支持工作区相对链接、图片和常见图片文件预览。
- 搜索：基于 `@vscode/ripgrep` 的全文搜索，支持大小写、全词、正则和包含/排除规则。
- Git：状态分组、暂存、撤销暂存、丢弃、提交、分支切换、内联/并排差异和提交图表。
- 布局：可调节和折叠的左侧视图、底部面板与状态栏；设置统一管理主题和栏宽。
- DSH 对话：右侧复用官方会话界面，保留消息、编程工具、模型、附件和权限能力。
- 状态恢复：按工作区保存活动视图、标签、栏宽和面板状态，刷新后继续工作。

工作台通过官方 `sidebar.footer.action` 和 `shell.overlay` 扩展点挂载，不替换或卸载 `ui-layout`。

## 截图

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/explorer.png" width="800" alt="资源管理器与 Monaco 编辑器">
  <br><em>资源管理器与 Monaco 编辑器</em>
</p>


<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/source-control.png" width="800" alt="源代码管理与提交图表">
  <br><em>源代码管理与提交图表</em>
</p>

## 安装

```bash
dsh plugin --profile web add dsh-vscode-workbench
```

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl+Shift+E` | 打开资源管理器 |
| `Ctrl+Shift+F` | 打开搜索 |
| `Ctrl+Shift+G` | 打开源代码管理 |
| `Ctrl+S` | 保存当前文件 |
| `Ctrl+Alt+B` | 显示或隐藏 DSH 对话栏 |
| `Ctrl+\`` | 显示或隐藏已注册的终端面板 |
| `Ctrl+Shift+\`` | 新建终端并显示终端面板 |

终端仍由独立插件提供；本工作台只注册快捷键，并通过 `registerBottomPanel()` 和 `terminal.new` 命令调用它。


## 安全

Host 只接受当前 DSH 会话工作目录内的相对路径，并阻止目录穿越与符号链接越界。保存使用版本校验和原子替换；Git 与 ripgrep 使用参数数组启动，不拼接 Shell 命令。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

需要 Node.js `^22.19 || >=24`、pnpm 11.7 和系统 Git。

## 许可证

[MIT](LICENSE)
