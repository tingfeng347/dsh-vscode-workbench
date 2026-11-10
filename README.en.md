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
- **Layout and DSH**: the primary view, terminal panel, and DSH conversation sidebar can be shown and resized independently; settings manage theme, widths, and watcher exclusions.
- **Sync and restore**: workspace file changes stream to the UI after skipping large trees such as `node_modules`, `vendor`, `third_party`, `build`, and `dist`, with extra exclusions configurable in settings; reload restores views, tabs, expanded directories, panels, and layout.

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

Plugin 0.1.14 targets DeepSeek Harness `0.2.2-rc.1` (Cordis `4.1.0`). Update Harness before installing; see the table below for older plugin versions.

```bash
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
```

```bash
dsh plugin --profile web add dsh-vscode-workbench
```

Installing from the DSH Plugins page or a marketplace also adds the package to `dsh.profile.bundles` and enables it. The CLI command above only writes `dependencies`, so add `dsh-vscode-workbench` to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json` and restart `dsh web`:

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

Harness runs a compatibility preflight first: `engines.dsh` takes precedence; when absent, every `@deepseek-ai/dsh*` peerDependency must match the running Harness version. Prereleases participate in matching. A mismatch aborts installation. The diagnostic log holds the actual verdict:

```
dsh: installation rejected: Plugin dsh-vscode-workbench@<plugin version> is incompatible with dsh <Harness version>: peerDependencies {...}
dsh: nothing was installed.
```

The plugin marketplace files this under the generic `plugin-side install failure`, so the auto-submitted issue body keeps only the `pnpm.log` path instead of that line.

| Plugin version | Required Harness |
| --- | --- |
| 0.1.14 | `0.2.2-rc.1` (Cordis `4.1.0`, default baseline); also checked with `0.2.1-rc.5` (Cordis `4.0.5`) |
| 0.1.12 | `0.2.1-rc.5` (Cordis `4.0.5`, default baseline); also checked with `0.2.2-rc.1` (Cordis `4.1.0`, Node.js ≥24.9) |
| 0.1.11 | `0.2.1-rc.5` (Cordis `4.0.5`, default baseline); also checked with `0.2.2-rc.1` (Cordis `4.1.0`, Node.js ≥24.9) |
| 0.1.10 | `0.2.1-rc.4` (Cordis `4.0.5`, previous validation baseline) |
| 0.1.9 | `0.2.1-alpha.3` (Cordis `4.0.5-alpha.2`, previous validation baseline) |
| 0.1.8 | `0.1.1-rc.2` |

No plugin version runs on Harness `0.2.0-rc.2`: 0.1.9 needs the `workingDirectory` service that first shipped in Harness `0.2.1-alpha.2`, while 0.1.8 only targets `0.1.1-rc.2`. Update Harness to `0.2.2-rc.1` before installing plugin 0.1.14, for example with a global npm install:

```bash
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
```

`dsh plugin allow-version` only bypasses the version gate; it does not supply the missing host services, so the plugin still fails to load on `0.2.0-rc.2`. Update Harness instead.

### Harness architecture integration

Version 0.1.11 updates DSH development dependencies and peers to `0.2.1-rc.5`, keeps Cordis at `4.0.5`, and declares `engines.dsh` explicitly. It also explicitly declares prerelease dependency ranges for `0.2.2-rc.1`. The official `evaluatePluginCompatibility()` validates the installation gate without version exemptions.

Both dependency environments pass type checking, 52 tests and the build, covering the official version gate, real Harness cookie authentication and session-directory switching regressions. Full DSH browser end-to-end validation has not been run. The next channel requires Node.js ≥24.9.

Version 0.1.12 focuses on reliability and macOS usability. It preserves and restores unsaved workspace drafts, hardens concurrent saves and file operations, adds a draggable title bar with correct window clearance, and hides the native DSH sidebar chrome while the workbench is active. WebSocket URLs now follow the DSH transport, and terminal startup repairs the `spawn-helper` execute bits. PDF, DOCX, image and Markdown previews were verified in DSH Desktop.

Version 0.1.14 fixes the overlapping header on Windows Desktop: DSH 0.2 reserves a 40px custom title bar at the top of the window and draws its App and Edit menus there. The workbench now honors `data-windows-titlebar`, starts below that bar, and no longer overlaps sidebar titles such as Source Control, while the title bar drag area remains usable. The development and test baseline moves to Harness `0.2.2-rc.1` / Cordis `4.1.0` while keeping the compatibility range for `0.2.1-rc.5` / Cordis `4.0.5`.

Version 0.1.14 also targets large repositories and crowded tab strips. The file watcher skips large trees such as `vendor`, `third_party`/`third_part`, `build`, `dist`, `out`, `target`, `.venv`, and `__pycache__` by default, with extra exclusions configurable in workbench settings; running out of watches now disables auto-refresh instead of crashing DSH at the inotify limit. Tabs stay on one line with ellipsis and no native scrollbar, the close-all action stays pinned to the right, and the active tab scrolls into view. The bottom status bar is hidden by default and can be re-enabled in settings.

Version 0.1.15 unifies the dark palette: the activity bar, sidebar, tab strip, bottom panel and status bar share `#191a1b`, the editor uses `#121314`, inputs and overlays use `#202122` / `#252526`, and text and accents move to one VS Code-style scale (`#bfbfbf` / `#8c8c8c` / `#6e6e6e`, `#307e9f`). Monaco and the terminal use the same surfaces, and the dark status bar no longer switches to a separate blue background. The light theme follows VS Code Light: the sidebar and terminal use `#f8f8f8`, the editor uses `#fff`, separators use `#e5e5e5`, and the sidebar/editor and editor/terminal boundaries get dividers with 8px rounded corners. Settings gain a font size slider (11–20px) that applies to the workbench UI, the Monaco editor and the terminal. The DSH conversation panel follows the same surfaces in the fixed dark theme. The workbench entry moves into the DSH sidebar panel list next to Plugins and Scheduled Tasks instead of using a floating button, and the DSH conversation panel toggles from the whale icon in the activity bar.

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
