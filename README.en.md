<h1 align="center">DSH VS Code Workbench</h1>

<p align="center">A VS Code-style local development workbench for DeepSeek Harness.</p>
<p align="center"><a href="README.md">中文</a> · <b>English</b></p>

## Highlights

- **Genuine VS Code feel**: explorer / search / source-control views, an activity bar, and `Ctrl+Shift+E/F/G` shortcuts — the workflow you already know.
- **Reliable saves**: atomic writes with revision checks; conflicts are raised instead of silently overwriting.
- **External-change awareness**: a WebSocket watches the workspace, flagging files changed on disk in the tab and status bar.
- **Commit graph**: a swimlane commit graph visualizes branch history.
- **Per-workspace restore**: active view, tabs, widths, panels, and tree expansion persist per workspace across reloads.

## Features

### Explorer
A lazily loaded tree with create, upload, rename, delete, and refresh. Drop local files onto the workspace root or any directory; Git file markers show `A`, `M`, and other status codes.

### Editor
Monaco tabs with dirty tracking, atomic saves, and revision-conflict plus external-change notices.

### Preview
Markdown rendered by default with source and outline modes; workspace-relative links, image and common file previews.

### Search
`@vscode/ripgrep` full-text search with case, whole-word, regex, and include / exclude controls.

### Git
Grouped status, stage, unstage, discard, commit, branch switching, inline / side-by-side diffs, and a commit graph.

### Layout
Resizable and collapsible primary view, an extensible bottom panel, and a status bar; theme and widths centralized in settings.

### DSH conversation
Reuses the official conversation UI with messages, coding tools, models, attachments, and permissions.

### Terminal
The workbench includes an interactive local terminal powered by `node-pty` and xterm. Use the terminal icon in the left activity bar to open the bottom panel; it supports multiple terminals, renaming, resize, ANSI output, and Ctrl+C.

### Restore
Persists the active view, tabs, widths, and panel state per workspace across reloads.

The workbench mounts through the official `sidebar.footer.action` and `shell.overlay` extension points. It does not replace or disable `ui-layout`.

## Screenshots

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

```bash
dsh plugin --profile web add dsh-vscode-workbench
```

### First terminal installation

The terminal uses `node-pty`. On the first install, pnpm 11 may block its build script, so `dsh plugin ... add` can report `Ignored build scripts` and end with an error. This is an expected safety check: the dependency has already been written to the profile. Following the approach used by [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar), run this on the machine that runs DSH:

```bash
cd ~/.dsh/profiles/web
pnpm approve-builds --all
```

This approves the `node-pty` build and completes the installation. Restart `dsh web` afterwards. If the terminal still reports that `node-pty` cannot load, run:

```bash
cd ~/.dsh/profiles/web
pnpm approve-builds --all && pnpm rebuild node-pty
```

pnpm can also delay versions published less than 24 hours ago. Retry after the waiting period, or use DSH's "Update now" action when it is offered.

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

The host accepts only paths relative to the active DSH session workspace and rejects traversal and symlink escape. Saves use revision checks and atomic replacement. Git and ripgrep run with argument arrays rather than shell-concatenated commands. The terminal accepts same-origin loopback requests only, starts in the session workspace, and removes API keys, tokens, secrets, and similar environment variables.

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
