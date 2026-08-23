<p align="center"><a href="README.md">中文</a> · <b>English</b></p>

<h1 align="center">DSH VS Code Workbench</h1>

<p align="center">A VS Code-style local development workbench for DeepSeek Harness.</p>

## Features

- Explorer: lazy directory loading with create, rename, delete, and refresh actions.
- Editor: Monaco tabs, dirty state, atomic saves, revision conflicts, and external-change notices.
- Preview: rendered Markdown by default with source and outline modes, workspace-relative links, and image previews.
- Search: `@vscode/ripgrep` full-text search with case, whole-word, regex, and include/exclude controls.
- Git: grouped status, stage, unstage, discard, commit, branch switching, inline/side-by-side diffs, and a commit graph.
- Layout: resizable and collapsible primary view, bottom panel, and status bar, with centralized theme and width settings.
- DSH conversation: reuses the official conversation UI with messages, coding tools, models, attachments, and permissions.
- Restore: persists the active view, tabs, widths, and panel state per workspace across reloads.

The workbench mounts through the official `sidebar.footer.action` and `shell.overlay` extension points. It does not replace or disable `ui-layout`.

## Installation

Install the aggregate package for the complete workbench with terminal integration:

```bash
dsh plugin --profile web add dsh-vscode-plugin
```

Install only the workbench and its extension API:

```bash
dsh plugin --profile web add dsh-vscode-workbench
```

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+E` | Open Explorer |
| `Ctrl+Shift+F` | Open Search |
| `Ctrl+Shift+G` | Open Source Control |
| `Ctrl+S` | Save the active file |
| `Ctrl+Alt+B` | Toggle the DSH conversation panel |

Terminal shortcuts are registered by `dsh-vscode-plugin`.

## Extension API

The browser exposes a `vscodeWorkbench` service for registering bottom panels and commands and controlling workbench visibility. `dsh-vscode-plugin` uses this API to mount `@xterm/xterm`.

## Security

The host accepts only paths relative to the active DSH session workspace and rejects traversal and symlink escape. Saves use revision checks and atomic replacement. Git and ripgrep run with argument arrays rather than shell-concatenated commands.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Requires Node.js `^22.19 || >=24`, pnpm 11.7, and system Git.

## License

[MIT](LICENSE)
