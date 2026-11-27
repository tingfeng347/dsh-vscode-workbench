# 发布检查

本清单适用于 `dsh-vscode-workbench` 的版本发布。用户可见的版本变化维护在[版本记录](../CHANGELOG.md)。

## 发布前

- [ ] 工作区只包含本次发布所需文件；没有误改 `dist/`、`node_modules/` 或本地 profile。
- [ ] 检查 npm 当前版本和 `latest`：`npm view dsh-vscode-workbench version dist-tags`。
- [ ] 确认版本号尚未发布，并更新 `package.json`、锁文件和 `docs/CHANGELOG.md`。
- [ ] 检查 Harness 兼容声明、安装说明及 README 是否需要同步。

## 本地检查

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack:plugin
git diff --check
```

- [ ] 类型检查、全量测试、构建、打包和差异检查均通过。
- [ ] 插件包包含 `lib/`、`src/`、README、LICENSE 和 `cordis.patch.yml`，不包含临时文件。
- [ ] 对安装或运行时修复，确认产物包含改动并按需要完成干净安装验证。
- [ ] 若涉及界面，说明自动化、浏览器和桌面端分别实际覆盖的范围。

## 合并与发布

- [ ] 发布提交已合并到 `main`，PR 的必需 CI 全部通过。
- [ ] 在 `main` 为待发布提交创建与 `package.json` 一致的 `v<version>` 标签。
- [ ] 推送该标签并等待 Release workflow 完成：三平台验证、打包、GitHub Release 和 npm 发布。
- [ ] 检查 GitHub Release 中的 tarball，并确认 `npm view dsh-vscode-workbench version dist-tags` 指向新版本。

## 发布后

- [ ] 确认 npm 包可读取：`npm view dsh-vscode-workbench@<version> version`。
- [ ] 发布完成触发的徽章任务通过，`assets/badges/npm-version.svg` 与 npm `latest` 一致。该任务会有界重试，等待新版本可见。首排六个徽章在本地生成，README 图片 URL 使用内容哈希刷新缓存。统计接口失败时保留旧图并报告失败，可从 Actions 重跑。
- [ ] 在独立 profile 或干净 HOME 中，从插件市场安装已发布版本，确认工作台自动启用。
- [ ] 在另一干净 profile 中按 README 从 npm 通过 CLI 安装，将插件加入 `dsh.profile.bundles`，重启后打开工作台。
- [ ] 从装有上一版本的测试 profile 打开插件市场，确认能看到新版本，完成一次更新并打开工作台。
- [ ] 记录尚未覆盖的平台或 Harness 版本限制到稳定文档，不把临时日志、备份路径或本机状态写入功能说明。
