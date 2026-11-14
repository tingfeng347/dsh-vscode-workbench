<h1 align="center">DSH VS Code Workbench</h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/branding/dsh-official-style-v3/dsh-workbench.gif" width="220" alt="DSH VS Code Workbench Logo">
</p>

<p align="center">A VS Code-style local workbench inside DeepSeek Harness: editor, search, Git, terminal, document and web preview in one place.</p>

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
- **Complete file experience**: open text, Markdown, images, PDF, Word, Excel, and PowerPoint files directly; the tree supports drag-and-drop uploads and common file operations.
- **Reliable and live**: atomic saves and revision checks prevent silent overwrites, while WebSocket updates flag external workspace changes.
- **Visual Git workflow**: status, staging, commits, branches, diffs, commit files, a swimlane commit graph, and AI-generated commit messages from the current changes.
- **Persistent workspace context**: restore tabs, tree, views, panels, and widths per workspace; terminals support multiple sessions, splits, and rename.
- **Two ways to open**: fill the window as before, or float the workbench over DSH with dragging, eight-way resizing, and real fullscreen.
- **Built for DSH**: reuse the DSH conversation surface on the right and manage theme and layout from the Workbench page in DSH settings.

## Demo

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/workbench-light.png" width="800" alt="Explorer, Markdown preview, terminal, and DSH conversation">
  <br><em>Explorer, Markdown preview, terminal, and DSH conversation</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/references-light.png" width="800" alt="Find references with Peek results in the editor">
  <br><em>Find references with Peek results in the editor</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/source-control-light.png" width="800" alt="Source control, commit graph, and inline/split diffs">
  <br><em>Source control, commit graph, and inline/split diffs</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/welcome-light.png" width="800" alt="Start a terminal or open the browser from the empty editor">
  <br><em>Start a terminal or open the browser from the empty editor</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/settings-light.png" width="800" alt="The DSH Workbench page inside DSH settings: theme, font size, layout, commit messages, and language services">
  <br><em>Settings live in DSH's own dialog: theme, font size, layout, commit messages, and language services</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/tingfeng347/dsh-vscode-workbench/main/assets/screenshots/workspace-switcher-light.png" width="800" alt="Open a workspace, switch sessions, or create a new workspace">
  <br><em>Open a workspace, switch sessions, or create a new workspace</em>
</p>

## Installation

Plugin 0.2.9 supports DeepSeek Harness `0.2.1-rc.1` and newer (default baseline `0.2.2-rc.1`, Cordis `4.1.0`). Anything below `0.2.1-rc.1` is rejected by the install gate:

```bash
npm i -g @deepseek-ai/dsh@0.2.2-rc.1
dsh plugin --profile web add dsh-vscode-workbench
```

Installing from the DSH Plugins page or a marketplace enables the plugin automatically. After a CLI install, add `dsh-vscode-workbench` to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json` and restart `dsh web`. Terminals use the official Harness service, and the bundled Browser is enabled automatically; no additional terminal or sidebar plugin is needed. See [Installation](https://github.com/tingfeng347/dsh-vscode-workbench/blob/main/docs/INSTALL.en.md) for upgrades and Harness compatibility failures.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+E` | Open Explorer |
| `Ctrl+Shift+F` | Open Search |
| `Ctrl+Shift+G` | Open Source Control |
| `Ctrl/Cmd+Click` | Toggle one Explorer item |
| `Shift+Click` | Select the visible range from the anchor |
| `Ctrl/Cmd+A` | Select every visible Explorer item |
| `Shift+Up/Down` | Extend or shrink the contiguous selection |
| `Ctrl/Cmd+C` | Copy selected relative paths, one per line |
| `Delete` / `Backspace` | Delete selected Explorer items |
| `Esc` | Clear the selection or close the delete confirmation |
| `Ctrl+S` | Save the active file |
| `Ctrl+Alt+B` | Toggle the DSH conversation panel |
| `Ctrl+\`` | Show or hide the terminal |
| `Ctrl+Shift+\`` | Create a terminal |

## Security

All plugin routes require Harness authentication. The host accepts only paths relative to the active DSH session workspace and rejects traversal and symlink escape. Saves use revision checks and atomic replacement. Git and ripgrep run with argument arrays rather than shell-concatenated commands. Terminals use the official Harness controller, connection authentication and execution environment. Credential filtering belongs to the official subprocess provider.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Requires Node.js `^22.19 || >=24`, pnpm 11.7 and system Git. The workbench no longer installs its own native terminal module.

## Docs

- [Architecture](https://github.com/tingfeng347/dsh-vscode-workbench/blob/main/docs/ARCHITECTURE.en.md): mounting, DSH services, and Harness compatibility.
- [Installation](https://github.com/tingfeng347/dsh-vscode-workbench/blob/main/docs/INSTALL.en.md): CLI and marketplace installs, terminal prerequisites, upgrades, and troubleshooting.
- [Changelog](https://github.com/tingfeng347/dsh-vscode-workbench/releases): release notes.
- [Release checklist](https://github.com/tingfeng347/dsh-vscode-workbench/blob/main/docs/RELEASE-CHECKLIST.md): validation and packaging steps.

## License

[MIT](LICENSE)

Web links and HTML files open in the browser selected under Settings → Workbench → Default browser (built-in or system). Use Cmd+T on macOS or Ctrl+T to open another official browser page. Terminals retain the bottom layout, session list, rename and split controls. Old workbench terminal processes cannot migrate to the official controller; create new terminals after updating.

Set Settings → Workbench → Window → Open mode to Floating window to keep the workbench as a layer over DSH, with the conversation and sidebar still visible around it: drag the title bar to move, drag an edge to resize, and double-click the title bar to maximize. The position and size are remembered, and Reset position and size restores the default. It reuses DSH's existing native window; it is not a second OS window.
