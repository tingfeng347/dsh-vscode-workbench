# 官方终端与浏览器接入

用户要求：接入新建终端、普通浏览器；暂不接入 Agent 浏览器。保持工作台现有布局和操作方式，免去另外安装终端或侧栏插件。

2026-11-26 浏览器交互修正：用户先要求「点击浏览器默认在官方的界面显示吧，标签页只有在用户手动打开网页时才作为标签页打开」，随后明确覆盖为「直接用官方的浏览器打开，我原来的自己的逻辑去了」「把官方新增的浏览器面板都自动接到了中间，连启动页也会接管，不要接管了」，并补充「原来的那些无用的我自己写的浏览器的代码可以清理，不做兼容」。以最终要求为准，所有浏览器页面均由官方界面展示，删除已替代链路，不保留兼容分支。

## 实现约定

- 终端保留底部面板、右侧列表、重命名、分屏、拖拽尺寸和快捷键。进程、恢复、连接和输入由官方 `ClientTerminals` 管理；隔离 `webTerminals` 服务，避免覆盖官方侧栏的持有清单。
- 终端身份按 Session 保存。折叠或切换工作区保留进程；显式关闭才结束进程。恢复失败显示错误，不创建替代进程。
- 普通浏览器完全使用官方 `browser` 面板。官方入口、工作台快捷键、内置网页链接和 HTML 预览均在官方右侧栏展示，不创建中间浏览器标签，不定位、搬移或接管官方浏览器 DOM。系统浏览器设置仍使用系统打开。安装补丁继续启用随 Harness 附带的浏览器。
- 不订阅浏览器新增清单来切换工作台焦点或收起右栏，不自动把启动页或具体网页吸附到编辑区。打开请求保留当前 Session 挂载等待与取消语义，避免切换会话后误开旧请求。
- 删除自建终端接口和 `node-pty` 依赖。旧进程不能迁移到官方进程，更新后需要新建终端。
- 不接入、不安装、不修改 Agent 浏览器。

## 验收

入口：工作台操作、官方终端模型的公开 API、官方浏览器导航和页面挂载。

- [ ] 终端新建、输入输出、重命名、分屏、关闭和失败重试。
- [ ] 折叠、工作区切换、刷新后保留身份，不重复创建进程。
- [ ] 浏览器打开、切换、关闭、尺寸变化和退出工作台后布局恢复。
- [ ] 类型检查、相关回归、完整测试和生产构建。
- [ ] 实际浏览器检查；替身与真实集成结果分别记录。

## 浏览器交还官方界面（2026-11-26）

- 移除浏览器清单订阅、工作台浏览器标签、自动聚焦／收起右栏和 `DshBrowserPage` 页面接管组件及专属样式；不再根据新建浏览器页面切换中间编辑内容。保留调用官方打开 API 的薄适配层，以及 Session 等待、取消、不可用提示。HTML 静态预览等待地址时切换会话，同样取消旧请求。
- 官方接口依据为只读提取本机 App 的 `dsh-client-ui-sidebar-browser/src/client/index.ts`、`view/BrowserBody.tsx` 与 Sidebar Right 公开接口；不实例化或修改官方私有浏览器 store/controller，也不注入地址栏提交监听。源码摘录位于 `/tmp/dvw-browser-official-qa/official-source/`。
- 删除已失效的 `getSnapshot/subscribe/focus` 测试夹具及两个未触发任何订阅的旧用例；当前全量 634 项测试通过、4 项跳过，类型检查通过。清理只涉及测试与文档，生产源码和已打包客户端未变。日志：`/tmp/dvw-browser-official-qa/tests-cleanup.log`、`typecheck-cleanup.log`。独立清理复核通过，生产源码没有旧页面接管或兼容分支，见 `cleanup-audit.json`。
- 干净生产构建、打包及 Impeccable 检测通过。打包前清理旧 `lib`，确认归档中没有已删除的 `DshBrowserPage` 声明或临时测试页面。日志：`/tmp/dvw-browser-official-qa/pack.log`、`design-final.log`。
- 独立 Chrome 验收 15 项通过，运行时异常为 0：官方启动页、同节点导航到 URL、新 URL 页、快捷键、右栏关闭后的唤起、链接、HTML 预览、系统浏览器设置均保持预期归属；原浏览器节点身份、父容器、样式和类名不变，文件与对话草稿保留。还验证「打开侧边栏」菜单图标、打开与重复打开，以及有文件 1/4／无文件全宽组合规则。
- 浏览器验收使用真实 Workbench、NativeBrowser、Monaco、快捷键和官方 MenuRegistry；浏览器 body、右栏服务、菜单弹出层和图标插槽渲染为夹具，不等同 Desktop 实测。证据：`/tmp/dvw-browser-official-qa/browser-result.json`、`browser-review-result.json`、`browser-run.mjs`。
- 已通过 Desktop 官方插件管理器更新并启用本地 0.4.1 构建，精确来源为 `file:/Users/tingfeng/.dsh/local-plugins/dsh-vscode-workbench/dsh-vscode-workbench-0.4.1-official-browser-a7b5cfe163.tgz`。185 个归档文件与实际安装目录全部一致，源码及构建文件与工作区一致，无旧 `DshBrowserPage` 文件，其他直接依赖声明未变。客户端 SHA-256：`a7b5cfe16362e3beb61b82d19327b5592c1d9085efb1c6e30d6895de4ccc4976`。核验：`/tmp/dvw-browser-official-qa/local-install-result.json`；安装前备份：`/Users/tingfeng/.dsh/backups/dsh-vscode-workbench-browser-default-20261126-dytxtf3h`。
- 真实 Desktop CUA 已确认：浏览器启动页和 `https://example.com/` 均留在官方右栏，不生成工作台网页标签；「打开侧边栏」可打开且重复执行不收起；仅打开 `package.json` 时编辑器恢复，随后关闭测试文件和网页。保留原会话与空草稿，未发送消息或保存文件。Desktop 比例测量与菜单图标视觉确认未完成：AX 不提供上限，唯一一次截图畸变，未继续坐标操作。本次安装打开的「插件（DSH 官方页面）」标签保留，仍属编辑内容。证据：`/tmp/dvw-browser-official-qa/desktop-cua-result.json`。
