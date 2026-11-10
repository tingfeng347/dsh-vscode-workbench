# 发布检查清单

适用范围：`dsh-vscode-workbench` 的 npm 发布与 DSH 插件市场更新。以下命令均在本仓库根目录执行。

## 1. 发布前确认

- [ ] `git status` 只包含本次要发布的改动，没有误改 `dist/`、`node_modules/` 或本地 profile。
- [ ] 确认 npm 上的最新版本：`npm view dsh-vscode-workbench version dist-tags`
- [ ] 确认版本号需要递增；已发布版本不能重复发布。
- [ ] 若修复了安装或运行时问题，确认旧版本 tarball 确实不含这些修复，避免“已修复但用户装不到”。

当前已知状态（2026-11-10）：

- `0.1.15` 统一深色主题：活动栏、侧栏、标签栏、底部面板和状态栏使用 `#191a1b`，编辑器使用 `#121314`，输入框/浮层使用 `#202122`/`#252526`，Monaco 与终端同步底色，深色状态栏不再使用蓝色背景；浅色主题使用 `#f8f8f8` 侧栏、`#fff` 编辑器、`#e5e5e5` 分隔线并加入 8px 圆角；设置新增 11–20px 编辑器字体大小（防抖提交）；活动栏图标统一为 18px，选中态使用圆角背景（去掉左侧蓝条）；标签栏改为 VS Code 顶部圆角活动标签（33px）并支持鼠标中键关闭；资源管理器右侧、编辑器组、终端和 DSH 对话栏改为带 4px 间距的圆角卡片（独立 gutter 底色），列表恢复整行方角，输入框/菜单/终端按 VS Code 圆角；终端标签侧栏与终端主区统一底色；侧栏头/标签栏/编辑工具栏/面板头统一 35px，文件/搜索/Git/终端列表行 22px，输入框高度对齐 VS Code，滚动条圆角；标签栏底线只在非活动区域显示；编辑器组/标签栏/终端补齐上下细线，活动栏隐藏多余滚动条；资源管理器/编辑器组/终端/DSH 对话栏统一 4px 上下留白与外边框；中间编辑器与终端合并为一张连续卡片，终端关闭时编辑器自动补全底部圆角，顶部贴住标题栏；左右分隔条统一 4px，资源管理器/DSH 对话栏拖到最小宽度以下自动隐藏；搜索结果点击跳转对应行并在编辑器中高亮匹配词（Markdown 自动切源码）；资源管理器与标签栏改用 `vscode-icons` 彩色图标包（`/dsh-vscode/file-icons` 路由）；DSH 对话栏同步底色，工作台入口移入侧栏面板列表，对话栏开关移到活动栏。
- `0.1.14` 修复 Windows Desktop 顶部 40px 自定义标题栏与工作台侧栏标题叠字的问题（`data-windows-titlebar` 留白），把开发/测试基线升级到 Harness `0.2.2-rc.1`（Cordis `4.1.0`）；同时让文件监听跳过 `vendor`、`third_party`、`build`、`dist` 等大目录并支持设置追加排除项，监听失败不再崩溃；修复多标签布局与活动标签自动滚动，底部状态栏改为默认关闭。
- `0.1.13` 只准备了版本号和文档，没有打 tag，npm 与 GitHub Release 均未发布；其 Windows 标题栏与基线升级内容包含在 `0.1.14`。
- `0.1.12` 包含草稿恢复、保存与文件操作可靠性、macOS 标题栏与布局、终端启动、transport WebSocket 和侧栏遮挡修复。
- `0.1.11` 的 tarball 不含 `repairNodePtyHelper`、`__DSH_TRANSPORT__`、标题栏和侧栏隐藏等修复。

## 2. 版本与文档

- [ ] 修改 `package.json` 的 `version`（例如 `0.1.12`）。
- [ ] 同步 README 中的版本说明和 Harness 兼容性表格（`README.md`、`README.en.md`）。
- [ ] 检查 `engines.dsh` 与 `peerDependencies` 是否仍覆盖目标 Harness 版本。
- [ ] 如果新增了安装前置条件，先更新 README，再发布。

## 3. 本地验证

```sh
corepack pnpm typecheck
corepack pnpm test -- --run
corepack pnpm build
git diff --check
```

- [ ] 类型检查通过。
- [ ] 全部测试通过（本次基线：18 个测试文件、84 项测试）。
- [ ] 构建通过；只有既有提示时可以接受。
- [ ] `git diff --check` 没有空白错误。

## 4. 打包检查

```sh
corepack pnpm pack:plugin
tar -tzf dist/dsh-vscode-workbench-<version>.tgz | head -40
```

- [ ] tarball 只包含 `lib/`、`src/`、`cordis.patch.yml`、README 和 LICENSE。
- [ ] `lib/client.js` 含本次新增标记，例如：

```sh
tar -xOf dist/dsh-vscode-workbench-<version>.tgz package/lib/client.js | grep -c dvw-titlebar
tar -xOf dist/dsh-vscode-workbench-<version>.tgz package/lib/client.js | grep -c __DSH_TRANSPORT__
tar -xOf dist/dsh-vscode-workbench-<version>.tgz package/lib/index.js | grep -c repairNodePtyHelper
```

三个计数都应大于 0。

## 5. 干净安装验收

使用独立的 `HOME`，不要复用或覆盖 `~/.dsh/profiles/desktop`。

```sh
export CLEAN_HOME=/tmp/dvw-clean-home
mkdir -p "$CLEAN_HOME"
HOME="$CLEAN_HOME" "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile web add /absolute/path/to/dsh-vscode-workbench-<version>.tgz
```

### 5.1 首次安装（不预置 allowBuilds）

- [ ] 记录实际结果。若出现 `ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: node-pty`，说明 pnpm 拦截了 `node-pty` 的构建脚本，安装会失败或回滚。
- [ ] 在 `$CLEAN_HOME/.dsh/profiles/web/pnpm-workspace.yaml` 合并：

```yaml
allowBuilds:
  node-pty: true
```

- [ ] 重新执行安装，确认成功。

### 5.2 启用插件

CLI 安装只写 `dependencies`，不会自动写 `dsh.profile.bundles`。在 `$CLEAN_HOME/.dsh/profiles/web/package.json` 中把 `dsh-vscode-workbench` 加入 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-vscode-workbench"
      ]
    }
  }
}
```

通过 DSH 插件页或插件市场安装时，DSH 会在安装成功后自动完成这一步；手工 `dsh plugin add` 不会。

### 5.3 启动并检查

```sh
HOME="$CLEAN_HOME" "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  --profile web --no-open --port 0
```

- [ ] 服务成功启动并打印带 `token` 的地址。
- [ ] 首页 HTML 的插件列表包含 `dsh-vscode-workbench/client.js`。
- [ ] `/dsh-vscode/codicons/codicon.ttf` 返回 200。
- [ ] `/dsh-vscode/api/unknown` 返回 405（说明 API 前缀已注册，而不是 404）。
- [ ] `/dsh-vscode-terminal/api/list` 带合法 `sessionId` 时能返回列表。

### 5.4 终端修复

安装后先确认 node-pty 的 helper 权限：

```sh
ls -l "$CLEAN_HOME/.dsh/profiles/web/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper"
```

- [ ] 安装后可能是 `0644`（无执行位）。
- [ ] 启动 DSH、插件加载后变为 `0755`（`TerminalManager` 构造时自动修复）。
- [ ] 用干净 profile 里的 `node-pty` 直接 spawn `/bin/zsh`，能收到命令输出。
- [ ] 在 DSH 工作台里新建终端，能出现 `zsh` 提示符并执行 `pwd`。

## 6. 功能验收

- [ ] 资源管理器能列出工作区文件；`session-not-found` 竞态会自动重试，不留下红字。
- [ ] Monaco 编辑、保存、外部文件变化提示正常。
- [ ] 打开二进制文件时只显示一条“二进制文件不能在文本编辑器中打开”，没有叠字。
- [ ] 终端可新建、分屏、关闭；`spawn-helper` 丢失执行位时终端仍可启动。
- [ ] 工作台激活时 DSH 原生右侧栏按钮和左上角切换按钮被隐藏；返回 DSH 后恢复。
- [ ] macOS 顶部 48px 标题栏可见，交通灯不遮挡“资源管理器”等内容。
- [ ] Windows Desktop 顶部 40px 标题栏下不出现叠字；“应用”“编辑”菜单可用，标题栏可拖动。
- [ ] 拖动标题栏能移动窗口。
- [ ] 对话栏宽度、侧栏宽度和终端高度可拖动。

## 7. 发布

```sh
corepack pnpm publish --dry-run
corepack pnpm publish
```

- [ ] 发布前确认 registry 是 `https://registry.npmjs.org`。
- [ ] `--dry-run` 的文件列表与第 4 步一致。
- [ ] 发布后执行 `npm view dsh-vscode-workbench version`，确认新版本成为 `latest`。
- [ ] 打 tag 并推送：`git tag v<version>`、`git push origin main --tags`。
- [ ] 在 GitHub Releases 写清修复内容和安装注意事项。

## 8. 发布后验证

- [ ] 在一台干净的机器或全新 `HOME` 上按 README 从 npm 安装，而不是本地 tarball。
- [ ] 分别验证“插件市场安装自动启用”和“CLI 安装后手动加入 bundles”两条路径。
- [ ] 确认插件市场/插件页显示新版本，并完成一次实际更新。
- [ ] 记录仍未验证的平台（Windows、Linux、旧版 Harness）和限制。

## 已知安装注意事项

- `node-pty` 的构建脚本可能被 pnpm 拦截；需要 `allowBuilds: node-pty: true`。插件运行时会补 `spawn-helper` 执行位，但无法绕过 pnpm 在安装阶段的拦截。
- CLI 安装不会自动修改 `dsh.profile.bundles`；只装依赖而不启用 bundle，插件不会加载。
- 刚发布不足 24 小时的版本可能触发 pnpm 的安全等待期；等待后重试，或使用 DSH 的“立即更新”。
