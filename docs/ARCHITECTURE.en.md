# Architecture

This page explains how `dsh-vscode-workbench` integrates with DeepSeek Harness and tracks Harness changes. Installation, upgrades, and the compatibility table are in [Installation](INSTALL.en.md).

## Mounting

The workbench mounts through the official `sidebar.footer.action` and `shell.overlay` extension points. It does not replace or disable `ui-layout`. The entry sits in the DSH sidebar panel list next to Plugins and Scheduled Tasks, and the whale icon in the activity bar toggles the DSH conversation panel.

## Client integration

- UI contributions use `ui-renderer` slots and select the current session through `ui-session`'s `mainView` retain count, replacing the removed `dsh-client-runtime`.
- Files, search, Git, and new terminals use `workingDirectory.get(session)`. Workspace selection follows the working-directory projection; missing sessions return 404.
- HTTP and WebSocket routes share Harness authentication and Host/Origin checks through `connection.requestRejection()`. Terminals also require loopback access.
- The conversation panel locates the official `data-phase` container across the new `conversation.content` layout.

## Version compatibility

The install gate compares `engines.dsh` or the `@deepseek-ai/dsh*` peerDependencies against the running Harness before pnpm executes. See [Installation](INSTALL.en.md#install-fails-incompatible-harness) when the install is rejected.

| Plugin version | Required Harness |
| --- | --- |
| 0.2.7 | `0.2.1-rc.1` and newer (default baseline `0.2.2-rc.1`, Cordis `4.1.0`) |
| 0.2.6 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.2.5 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.2.4 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.2.3 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.2.2 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.2.1 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.2.0 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.1.15 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.1.14 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.1.12 | `0.2.1-rc.5` (Cordis `4.0.5`, default baseline); also checked with `0.2.2-rc.1` (Cordis `4.1.0`, Node.js ≥24.9) |
| 0.1.11 | `0.2.1-rc.5` (Cordis `4.0.5`, default baseline); also checked with `0.2.2-rc.1` (Cordis `4.1.0`, Node.js ≥24.9) |
| 0.1.10 | `0.2.1-rc.4` (Cordis `4.0.5`, previous validation baseline) |
| 0.1.9 | `0.2.1-alpha.3` (Cordis `4.0.5-alpha.2`, previous validation baseline) |
| 0.1.8 | `0.1.1-rc.2` |

No plugin version runs on Harness `0.2.0-rc.2`: 0.1.9 needs the `workingDirectory` service that first shipped in `0.2.1-alpha.2`, while 0.1.8 only targets `0.1.1-rc.2`.

`dsh plugin allow-version` only bypasses the version gate; it does not supply missing host services, so update Harness instead.

## Evolution

`0.1.11` aligned DSH development dependencies and peers with `0.2.1-rc.5` (Cordis `4.0.5`) and declared `engines.dsh` plus the `0.2.2-rc.1` prerelease range. The official `evaluatePluginCompatibility()` validates the gate without exemptions.

`0.2.0` added language-server hosting: runtimes and LSPs are detected and installed separately, automatic installs live in the plugin's private directory, and `/dsh-vscode/file-icons` serves the `vscode-icons` pack on demand.

`0.2.1` retried terminal requests while a session was being published, so switching workspaces waits for the session instead of leaving a failed terminal behind.

`0.2.2` added AI commit messages, the settings panel, Pure White and Eye Care themes, and the split-diff stabilization while keeping the `0.2.1-rc.5` compatibility range. Full release notes are on [GitHub Releases](https://github.com/tingfeng347/dsh-vscode-workbench/releases).

## Official tools

Terminals use an isolated official `ClientTerminals` controller for process ownership, recovery and input flow; the workbench owns tab membership and layout. Custom `/dsh-vscode-terminal/*` routes and the `node-pty` dependency are removed. Browser navigation and rendering stay with the official sidebar; its original DOM is presented in the editor area without moving React-owned nodes or rebuilding Electron webviews. Leaving the workbench restores the original presentation. Web links and HTML files follow the configured default browser; HTML is served by a token-guarded localhost site server so relative styles, scripts and images resolve. See [native tools](native-tools.md) for scope and verification.
