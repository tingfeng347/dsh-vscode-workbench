# 发布检查清单

适用范围：`dsh-vscode-workbench` 的 npm 发布与 DSH 插件市场更新。以下命令均在本仓库根目录执行。

## 1. 发布前确认

- [ ] `git status` 只包含本次要发布的改动，没有误改 `dist/`、`node_modules/` 或本地 profile。
- [ ] 确认 npm 上的最新版本：`npm view dsh-vscode-workbench version dist-tags`
- [ ] 确认版本号需要递增；已发布版本不能重复发布。
- [ ] 若修复了安装或运行时问题，确认旧版本 tarball 确实不含这些修复，避免“已修复但用户装不到”。

当前已知状态（2026-11-14）：

- `0.2.9` 新增 Trae 风格 AI 改动审阅，支持文件、代码块和项目三级接受或拒绝、审阅模式和跟随开关（默认关闭）、Monaco 行内标记、DSH 对话栏项目级审阅卡片、生成文件跳转与资源管理器 Ctrl/Shift 多选；提交信息生成默认跟随 DSH 聊天当前 DeepSeek 模型，不再要求先进行 AI 对话，并可在设置中固定模型；Git 操作失败统一改为居中可理解的对话框，审阅文件较多时支持左右翻页、方向键和滚轮浏览。插件 Logo 改用透明背景，修复暗色模式下的白色边框。
- `0.2.8` 新增编辑器标签跨分屏拖动：可拖到窗格边缘分屏、拖到另一个窗格正文交换文件、拖回原标签栏重排，并修复标签关闭按钮误触拖动、焦点切换失步、Monaco 截获拖放和图片预览复用旧图的问题。同时修复从侧栏打开「插件」后无法返回对话，并新增工作台「当前窗口 / 浮动窗口」打开方式与系统全屏。
- `0.2.7` 把 `engines.dsh` 下限从 `0.2.1-rc.5` 放宽到 `0.2.1-rc.1`，`0.2.1` 的 rc 与 `0.2.2` 全系都能安装。下限来自实测：`0.2.1-rc.1` / `0.2.1-rc.2` 上工作台、官方终端、浏览器均可用；`0.2.1-alpha.2` 只能加载客户端、打不开主面板，因此不作为支持版本。同时移除活动栏浏览器入口，网页链接和 HTML 按设置里的默认浏览器分流；HTML 由带随机令牌的 localhost 静态服务提供，相对资源可用。修复浏览器页盖住 DSH 设置、工作台关闭时 Workbench 设置页空白的问题。
- `0.2.6` 修复工作台左上角真实鼠标点击无响应：宿主在该区域铺了 `-webkit-app-region: drag` 拖拽区，落在其中的真实按下事件到不了页面，表现为浏览器标签关不掉、活动栏顶部工作区图标点不开、侧栏头部按钮失效（注入式事件不受影响）。工作台整层改为 `no-drag`，标题栏继续保留窗口拖动。同时修复新建工作区主按钮悬停白字、终端重启后残留失效 ID、返回工作台时标签正文空白、store 未接入时的关闭兜底和活动栏手抖误吞点击。
- `0.2.5` 终端改为 Harness 官方终端服务，新增普通浏览器标签；移除自建终端接口和 `node-pty` 依赖。旧终端进程不能迁移，升级后需新建终端；CLI 安装后仍需手动加入 `dsh.profile.bundles`。
- `0.2.4` 修复 Windows 语言服务器检测：只接受带可执行扩展名的命令，POSIX bin 目录不再进入 Windows 搜索路径；CI 在 Windows 恢复通过。
- `0.2.3` 包含 0.2.2 的全部功能，并修复工作区切换窗口未覆盖 DSH 面板的问题：遮罩现在覆盖整个窗口、背景模糊，不再高亮右侧 DSH；同时移除重复的 DSH 侧边栏按钮。README 精简，架构 / 安装 / 版本记录拆分到 `docs/`，截图更新为浅色主题。
- `0.2.2` 新增 AI 提交信息生成（简洁 / 标准 / 详细、跟随最近提交 / 中文 / English），重构设置面板，新增纯白与护眼主题并覆盖 Monaco、终端和 DSH 对话栏；Markdown 默认预览，活动栏支持自由排序，工作区切换固定顶部，语言与 LSP 安装状态分离。
- `0.2.1` 修复终端会话就绪前请求失败与窄窗口 DSH 布局，补齐 macOS 标题栏留白和 Ctrl+点击跳转定义；界面统一活动栏图标、VS Code 圆弧标签、资源管理器行高和空编辑器鲸鱼标识。
- `0.2.0` 新增语言智能（按语言安装 LSP，转到定义 / 查找引用 / Peek / 补全 / 签名帮助 / 诊断）、PDF · Word · Excel · PowerPoint 预览、资源管理器拖动移动与拖出导出、添加到 DSH 对话、活动栏拖动排序与右键隐藏、居中工作区切换（新建 / 进入 / 同工作区切换会话不重载）、`.gitignore` 自动监听排除、启动会话重试、浅色终端 ANSI 色板、VS Code 风格 Git 图谱与彩色文件图标。
- `0.1.15` 统一深色主题：活动栏、侧栏、标签栏、底部面板和状态栏使用 `#191a1b`，编辑器使用 `#121314`，输入框/浮层使用 `#202122`/`#252526`，Monaco 与终端同步底色，深色状态栏不再使用蓝色背景；「跟随 DSH」按明暗使用与深色/浅色相同的色板；浅色主题使用 `#f8f8f8` 侧栏、`#fff` 编辑器、`#e5e5e5` 分隔线并加入 8px 圆角；设置新增 11–20px 编辑器字体大小（防抖提交）；活动栏图标统一为 18px，选中态使用圆角背景（去掉左侧蓝条），活动栏加边框和左侧上下圆角并贴满左边；标签栏改为 VS Code 顶部圆角活动标签（33px）并支持鼠标中键关闭；资源管理器右侧、编辑器组、终端和 DSH 对话栏改为带 4px 间距的圆角卡片（独立 gutter 底色），列表恢复整行方角，输入框/菜单/终端按 VS Code 圆角；终端标签侧栏与终端主区统一底色，终端画布背景读取面板实际底色；侧栏头/标签栏/编辑工具栏/面板头统一 35px，文件/搜索/Git/终端列表行 22px，输入框高度对齐 VS Code，滚动条圆角；活动标签顶部圆角 8px；标签栏底线只在非活动区域显示；移除右侧全部关闭按钮，改为标签右键菜单（关闭/关闭其他/关闭右侧标签页/关闭已保存/全部关闭）；Monaco 显式预加载中文语言包，内置菜单中文化（zh-cn），打开文件不自带首行高亮；深色下隐藏 DSH 对话栏时保持 DSH 标题栏深色；状态栏使用 VS Code 深/浅色底而非蓝色；终端面板可向下拖动隐藏，从底部边缘向上拖动重新拉出；卡片底部贴住状态栏；编辑器组/标签栏/终端补齐上下细线，活动栏隐藏多余滚动条；资源管理器/编辑器组/终端/DSH 对话栏统一 4px 上下留白与外边框；中间编辑器与终端为各自完整的圆角卡片，终端顶部圆角并与编辑器留 4px 间隙；未打开文件时隐藏空标签栏；左右分隔条统一 4px，资源管理器/DSH 对话栏拖到最小宽度以下自动隐藏；搜索结果点击跳转对应行并在编辑器中高亮匹配词（Markdown 自动切源码）；源代码管理增加分支下拉切换与新建分支，其他 worktree 已检出的分支会标记并禁用；切换失败使用居中错误对话框；资源管理器与标签栏改用 `vscode-icons` 彩色图标包（`/dsh-vscode/file-icons` 路由）；DSH 对话栏同步底色，工作台入口移入侧栏面板列表，对话栏开关移到活动栏。
- `0.1.14` 修复 Windows Desktop 顶部 40px 自定义标题栏与工作台侧栏标题叠字的问题（`data-windows-titlebar` 留白），把开发/测试基线升级到 Harness `0.2.2-rc.1`（Cordis `4.1.0`）；同时让文件监听跳过 `vendor`、`third_party`、`build`、`dist` 等大目录并支持设置追加排除项，监听失败不再崩溃；修复多标签布局与活动标签自动滚动，底部状态栏改为默认关闭。
- `0.1.13` 只准备了版本号和文档，没有打 tag，npm 与 GitHub Release 均未发布；其 Windows 标题栏与基线升级内容包含在 `0.1.14`。
- `0.1.12` 包含草稿恢复、保存与文件操作可靠性、macOS 标题栏与布局、终端启动、transport WebSocket 和侧栏遮挡修复。
- `0.1.11` 的 tarball 不含 `repairNodePtyHelper`、`__DSH_TRANSPORT__`、标题栏和侧栏隐藏等修复。

## 2. 版本与文档

- [ ] 修改 `package.json` 的 `version`（例如 `0.1.12`）。
- [ ] 同步 README 的版本说明，以及 `docs/ARCHITECTURE.md` / `docs/ARCHITECTURE.en.md` 中的 Harness 兼容性表格。
- [ ] 检查 `engines.dsh` 与 `peerDependencies` 是否仍覆盖目标 Harness 版本。
- [ ] 如果新增了安装前置条件，先更新 `docs/INSTALL.md` / `docs/INSTALL.en.md` 和 README 摘要，再发布。

## 3. 本地验证

```sh
corepack pnpm typecheck
corepack pnpm test -- --run
corepack pnpm build
git diff --check
```

- [ ] 类型检查通过。
- [ ] 全部测试通过（本次基线：57 个测试文件、345 项测试）。
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

### 5.1 首次安装

- [ ] 无需为工作台批准 `node-pty` 构建；插件包不再依赖该模块。
- [ ] 官方终端 controller 与普通浏览器均由 Harness 提供，安装后无需另装侧栏或终端插件。

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
- [ ] 已移除的 `/dsh-vscode-terminal/api/list` 返回 404。

### 5.4 官方终端与浏览器

- [ ] 工作台新建终端能出现 shell 提示符并执行 `pwd`。
- [ ] 多终端、分屏、重命名、关闭与失败重试正常。
- [ ] 折叠面板、切换 Session 和刷新不会重复创建终端。
- [ ] 多窗口新建不会覆盖彼此的恢复记录。
- [ ] 普通浏览器在中间标签区打开；切回文件再返回保留网页状态。
- [ ] 工作台设置和工作区切换器能覆盖浏览器，退出工作台恢复官方布局。

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

- 升级到官方终端后，旧版自建终端的进程不能迁移，需要新建终端。
- CLI 安装不会自动修改 `dsh.profile.bundles`；只装依赖而不启用 bundle，插件不会加载。
- 刚发布不足 24 小时的版本可能触发 pnpm 的安全等待期；等待后重试，或使用 DSH 的“立即更新”。
