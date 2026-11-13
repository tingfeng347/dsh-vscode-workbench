# 安装与升级

插件 0.2.7 支持 DeepSeek Harness `0.2.1-rc.1` 及以上（默认验证基线 `0.2.2-rc.1`，Cordis `4.1.0`）。架构接入与版本兼容表见[架构适配](ARCHITECTURE.md)。

## 安装

```bash
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
```

```bash
dsh plugin --profile web add dsh-vscode-workbench
```

通过 DSH 插件页或插件市场安装时，界面会把它加入 `dsh.profile.bundles` 并启用。用上面的 CLI 命令安装时只写入 `dependencies`，还需要在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 中加入 `dsh-vscode-workbench`，然后重启 `dsh web`：

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

## 首次安装终端支持

终端直接复用 Harness 官方控制器；工作台保留现有底部布局、多终端、重命名和分屏，不再依赖单独的 `node-pty` 安装或构建许可。普通浏览器由插件补丁启用，无需另装侧栏插件。Agent 浏览器不在此功能范围内。

旧版工作台的终端进程无法迁移到官方控制器，更新后需要新建终端。

刚发布不足 24 小时的版本可能被 pnpm 的安全等待期拦截。等待后重试即可；DSH 提供“立即更新”时可直接选择它。

## 从旧版升级

运行中的插件管理器启用 HMR 时，不允许覆盖安装同名包。先在插件管理器中移除旧版，再安装新版；CLI 可使用：

```bash
dsh plugin --profile web remove dsh-vscode-workbench
dsh plugin --profile web add dsh-vscode-workbench
```

完成后重新打开工作台，必要时重启 `dsh web` 并刷新页面。

## 安装失败：Harness 版本不兼容

如果安装只以这一行结束，说明 DSH 在安装前就拒绝了插件，pnpm 没有执行、也没有任何文件被写入：

```
dsh: plugin command failed; diagnostics: ~/.dsh/profiles/<profile>/.plugin-manager/logs/operation-*/pnpm.log
```

原因是 Harness 的兼容性预检：优先用插件的 `engines.dsh` 比对当前 Harness 版本；未声明时，检查所有 `@deepseek-ai/dsh*` peerDependencies。预发布版本也参与匹配，不满足就中止安装。诊断日志里能看到真正的结论：

```
dsh: installation rejected: Plugin dsh-vscode-workbench@<插件版本> is incompatible with dsh <Harness 版本>: peerDependencies {...}
dsh: nothing was installed.
```

插件市场把这类失败归入通用的 `plugin-side install failure`，所以自动提交的 Issue 里不会带上上面这行，正文只剩 `pnpm.log` 的路径。

### 旧版本兼容表

| 插件版本 | 需要的 Harness |
| --- | --- |
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

Harness `0.2.0-rc.2` 上没有可用的插件版本：0.1.9 起的插件都依赖 `0.2.1-alpha.2` 才引入的 `workingDirectory` 服务，0.1.8 又只适配 `0.1.1-rc.2`。`0.2.1` 的 alpha 版本能加载入口，但打不开工作台，所以最低从 `0.2.1-rc.1` 开始。请先把 Harness 升级到 `0.2.1-rc.1` 或更高再安装 0.2.7，例如 npm 全局安装时：

```bash
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
```

`dsh plugin allow-version` 只跳过版本闸门，不会补上缺失的宿主服务，在 `0.2.0-rc.2` 上插件仍然加载不起来；请优先升级 Harness。
