# Architecture

This page describes the workbench's current extension points, host services, and data boundaries. See [Installation](INSTALL.en.md) for setup and [Changelog](CHANGELOG.md) for release history.

## Mounting and UI

- The workbench mounts through Harness's official `sidebar.footer.action` and `shell.overlay` extension points. It does not replace `ui-layout`.
- The DSH conversation uses the official conversation UI. It can stay in the sidebar or appear as an editor tab, sharing editor groups with files.
- Floating mode renders in the overlay of the same native window. It uses fixed positioning for movement and resizing; it is not a separate system window.
- When the workbench conversation is closed, opening the official right sidebar goes directly to its final layout, avoiding a flash of hidden chat content. The official transition remains when the conversation is visible.

## Host services

- The client registers UI contributions through `ui-renderer` slots and reads the active session from `ui-session`.
- File, search, Git, and terminal operations resolve the workspace from the active Session's `workingDirectory`.
- HTTP and WebSocket requests use Harness authentication and validate Host/Origin. Terminal routes are additionally restricted to loopback.
- The official `ClientTerminals` controller owns terminal processes; the official browser panel owns browser pages. The workbench creates neither custom terminal processes nor browser pages.

## Source layout

| Path | Contents |
| --- | --- |
| `src/host/` | Host-side file, Git, SSH, debug, preview, HTTP API, and file-watching features. |
| `src/client/` | Workbench, DSH integration, editor, and Git, terminal, SSH, settings, search, LSP, and preview UI and services. |
| `src/shared/` | Types and pure logic shared by the host and client. |
| `build/`, `tests/` | Build and packaging entry points; tests are grouped by feature, with shared helpers in `tests/support/`. |

## Security and data protection

- Local file paths are confined to the active workspace, with traversal and symlink escape checks.
- Saves validate file revisions and use atomic replacement; drafts are isolated by Session and workspace.
- SSH file operations validate normalized remote paths to keep access inside the selected workspace.
- See [Data protection and recovery](features/reliability.md) and [Official terminal and browser](features/native-tools.md) for details.

## Harness compatibility

Plugin `0.5.0` declares Harness `>=0.2.1-rc.1` in `package.json`. Development and CI use Harness `0.2.2-rc.5` and Cordis `4.1.0` as the validation baseline. The install preflight checks `engines.dsh` and the relevant peer dependencies. See [installation troubleshooting](INSTALL.en.md#install-fails-incompatible-harness) if installation is rejected.

For older releases and features, see the [changelog](CHANGELOG.md).

## Search and replace API

The API is served under the authenticated `/dsh-vscode/api/` route and uses `sessionId` to select a session.

| Method | Request | Response |
| --- | --- | --- |
| `search` | `query`, with optional `caseSensitive`, `wholeWord`, `regex`, `include`, `exclude`, and `captureGroups`. | `matches` contains relative paths, line and column, text, and optional capture groups. `limited` indicates truncated results. |
| `search.replace` | `cwd` and `files` grouped by relative path. Each edit provides `line`, `column`, match `length`, `lineHash`, and replacement `text`. | `changed` lists successful files; `failures` returns per-file errors. |

Replacement rechecks matching lines and file revisions. Binary, non-UTF-8, over-5-MiB, or stale files are not written.
