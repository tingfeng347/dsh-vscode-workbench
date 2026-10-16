<h1 align="center">DSH VS Code Workbench</h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/dsh-neon-workbench-core.svg" width="220" alt="DSH VS Code Workbench Logo">
</p>

<p align="center">A VS Code-style local development workbench for DeepSeek Harness.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-vscode-workbench"><img src="https://img.shields.io/npm/v/dsh-vscode-workbench?logo=npm&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-vscode-workbench"><img src="https://img.shields.io/npm/dm/dsh-vscode-workbench?label=downloads" alt="npm downloads"></a>
  <a href="https://github.com/tingfeng347/dsh-vscode-workbench/stargazers"><img src="https://img.shields.io/github/stars/tingfeng347/dsh-vscode-workbench?logo=github&label=Stars" alt="GitHub stars"></a>
  <a href="https://github.com/tingfeng347/dsh-vscode-workbench/commits/main"><img src="https://img.shields.io/github/last-commit/tingfeng347/dsh-vscode-workbench?label=last%20commit" alt="Last commit"></a>
  <a href="https://github.com/tingfeng347/dsh-vscode-workbench/blob/main/LICENSE"><img src="https://img.shields.io/github/license/tingfeng347/dsh-vscode-workbench?label=license" alt="MIT license"></a>
  <br>
  <a href="https://awesome-dsh-plugin.com/p/tingfeng347/dsh-vscode-workbench/"><img src="https://awesome-dsh-plugin.com/badge.svg" alt="awesome · DSH plugin"></a>
  <a href="https://dshpluginhub.ai/plugins/dsh-vscode-workbench"><img src="https://dshpluginhub.ai/badges/plugins/dsh-vscode-workbench.svg" alt="Listed on DSH Plugin Hub"></a>
  <a href="https://dshmarket.com/p/tingfeng347/dsh-vscode-workbench/"><img src="https://img.shields.io/badge/dsh--market-Listed-5b7cfa?style=flat" alt="Listed on dsh-market"></a>
  <a href="https://dshmk.com/plugins/1343926987"><img src="https://img.shields.io/badge/DSH%20Plugin%20Market-Listed-0ea5e9?style=flat" alt="Listed on DSH Plugin Market"></a>
  <a href="https://dsh-ai.org/p/tingfeng347/dsh-vscode-workbench"><img src="https://img.shields.io/badge/dsh--ai.org-Listed-8b5cf6?style=flat" alt="Listed on dsh-ai.org"></a>
  <a href="https://duink.com/plugins/1343926987/"><img src="https://img.shields.io/badge/DSH%20Universe-Listed-14b8a6?style=flat" alt="Listed on DSH Universe"></a>
  <a href="https://deepseekplugin.org/en/plugins/tingfeng347-dsh-vscode-workbench"><img src="https://img.shields.io/badge/DeepseekPlugin-Listed-2563eb?style=flat" alt="Listed on DeepseekPlugin"></a>
</p>

<p align="center"><a href="README.md">中文</a> · <b>English</b></p>

## Highlights

- **One local workbench**: explorer, Monaco editor, search, Git, terminal, and DSH conversation in one VS Code-style interface.
- **Complete file experience**: open text, Markdown, images, PDF, and Word files directly; the tree supports drag-and-drop uploads and common file operations.
- **Reliable and live**: atomic saves and revision checks prevent silent overwrites, while WebSocket updates flag external workspace changes.
- **Visual Git workflow**: status, staging, commits, branches, diffs, commit files, and a swimlane commit graph.
- **Persistent workspace context**: restore tabs, tree, views, panels, and widths per workspace; terminals support multiple sessions, splits, and rename.
- **Built for DSH**: reuse the DSH conversation surface on the right and manage theme and layout from workbench settings.

## Features

- **Files and editor**: lazy explorer with create, upload, drag-and-drop, rename, delete, and Git markers; Monaco tabs provide dirty state, atomic saves, and conflict notices.
- **Preview**: Markdown source, outline, relative links, and images; built-in PDF paging and zoom plus DOCX rendering, with DOC/ODT download support.
- **Search and Git**: `@vscode/ripgrep` supports case, whole-word, regex, and path filters; Git covers stage, unstage, discard, commit, branches, diffs, commit files, and the graph.
- **Terminal**: `node-pty` and xterm with up to eight sessions, rename, a right-side switcher, splits, ANSI output, and Ctrl+C.
- **Layout and DSH**: the primary view, terminal panel, and DSH conversation sidebar can be shown and resized independently; settings manage theme and widths.
- **Sync and restore**: workspace file changes stream to the UI, while reload restores views, tabs, expanded directories, panels, and layout.

The workbench mounts through the official `sidebar.footer.action` and `shell.overlay` extension points. It does not replace or disable `ui-layout`.

## Demo

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/explorer.png" width="800" alt="Explorer and Monaco editor">
  <br><em>Explorer and Monaco editor</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/source-control.png" width="800" alt="Source control and commit graph">
  <br><em>Source control and commit graph</em>
</p>

<p align="center">
  <img src="https://pic1.imgdb.cn/i/034GkZFU8ULHsWgFio93Lw.png" width="800" alt="terminal">
  <br><em>terminal</em>
</p>


## Installation

Plugin 0.1.9 targets DeepSeek Harness `0.2.1-alpha.3` (Cordis `4.0.5-alpha.2`). Update Harness before installing; plugin 0.1.8 targets Harness `0.1.1-rc.2`.

```bash
dsh plugin --profile web add dsh-vscode-workbench
```

### First terminal installation

The terminal uses `node-pty`. If installation reports a blocked build script, merge the following into `~/.dsh/profiles/web/pnpm-workspace.yaml` on the DSH host, preserving existing settings:

```yaml
allowBuilds:
  node-pty: true
```

Newer Harness releases may roll back failed installations, so run the install command again after configuring builds. If the plugin is installed but `node-pty` still cannot load, run:

```bash
cd ~/.dsh/profiles/web
pnpm rebuild node-pty
```

pnpm can also delay versions published less than 24 hours ago. Retry after the waiting period, or use DSH's "Update now" action when it is offered.

### Upgrading an existing installation

The running plugin manager rejects installing over an existing package when HMR is active. Remove the old plugin before installing the new version. With the CLI:

```bash
dsh plugin --profile web remove dsh-vscode-workbench
dsh plugin --profile web add dsh-vscode-workbench
```

Reopen the workbench afterwards; restart `dsh web` and refresh the page if needed.

### Install fails: incompatible Harness

If the install ends with only this line, Harness refused the plugin before installing anything — pnpm never ran and no file was written:

```
dsh: plugin command failed; diagnostics: ~/.dsh/profiles/<profile>/.plugin-manager/logs/operation-*/pnpm.log
```

Harness runs a compatibility preflight first: it compares the plugin's `@deepseek-ai/dsh*` peerDependencies with the running Harness version and aborts on a mismatch. The diagnostic log holds the actual verdict:

```
dsh: installation rejected: Plugin dsh-vscode-workbench@<plugin version> is incompatible with dsh <Harness version>: peerDependencies {...}
dsh: nothing was installed.
```

The plugin marketplace files this under the generic `plugin-side install failure`, so the auto-submitted issue body keeps only the `pnpm.log` path instead of that line.

| Plugin version | Required Harness |
| --- | --- |
| 0.1.9 | `0.2.1-alpha.3` or newer (Cordis `4.0.5-alpha.2`) |
| 0.1.8 | `0.1.1-rc.2` |

No plugin version runs on Harness `0.2.0-rc.2`: 0.1.9 needs the `workingDirectory` service that first shipped in Harness `0.2.1-alpha.2`, while 0.1.8 only targets `0.1.1-rc.2`. Update Harness to `0.2.1-alpha.3` or newer before installing, for example with a global npm install:

```bash
npm i -g @deepseek-ai/dsh@0.2.1-alpha.4
```

`dsh plugin allow-version` only bypasses the version gate; it does not supply the missing host services, so the plugin still fails to load on `0.2.0-rc.2`. Update Harness instead.

### Harness architecture integration

- Client contributions use `ui-renderer` slots and select the current session through `ui-session`'s `mainView` retain count, replacing the removed `dsh-client-runtime`.
- Files, search, Git and new terminals use `workingDirectory.get(session)`. Workspace selection follows the working-directory projection; missing sessions return 404.
- HTTP and WebSocket routes share Harness authentication and Host/Origin checks through `connection.requestRejection()`. Terminals also require loopback access.
- The conversation panel locates the official `data-phase` container across the new `conversation.content` layout.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+E` | Open Explorer |
| `Ctrl+Shift+F` | Open Search |
| `Ctrl+Shift+G` | Open Source Control |
| `Ctrl+S` | Save the active file |
| `Ctrl+Alt+B` | Toggle the DSH conversation panel |
| `Ctrl+\`` | Show or hide the terminal |
| `Ctrl+Shift+\`` | Create a terminal |

## Security

All plugin routes require Harness authentication. The host accepts only paths relative to the active DSH session workspace and rejects traversal and symlink escape. Saves use revision checks and atomic replacement. Git and ripgrep run with argument arrays rather than shell-concatenated commands. The terminal accepts same-origin loopback requests only, stays in the session workspace selected at creation, and removes API keys, tokens, secrets, and similar environment variables.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Requires Node.js `^22.19 || >=24`, pnpm 11.7, system Git, and the native build prerequisites for `node-pty` when no prebuild is available.

## License

[MIT](LICENSE)
