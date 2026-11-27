# 安装与升级

插件需要 DeepSeek Harness `0.2.1-rc.1` 或更高版本。安装时建议使用 npm 的 `latest`。开发和 CI 的验证版本记录在 `package.json` 和 `pnpm-lock.yaml` 中。架构接入与当前兼容范围见[架构说明](ARCHITECTURE.md)。

## 安装

```bash
npm i -g @deepseek-ai/dsh@latest
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

当前版本的兼容范围与验证基线见[架构说明](ARCHITECTURE.md#harness-兼容性)。历史版本兼容信息请查看[版本记录](CHANGELOG.md)。版本闸门只能检查声明的依赖，跳过闸门不会为旧版 Harness 补上缺失的宿主服务。
