export type CodiconName =
  | 'case-sensitive' | 'whole-word' | 'regex' | 'preserve-case' | 'replace' | 'replace-all' | 'ellipsis' | 'clear-all' | 'collapse-all' | 'expand-all'
  | 'add' | 'arrow-left' | 'arrow-right' | 'comment-discussion' | 'copy' | 'check' | 'check-all' | 'chevron-down' | 'chevron-up' | 'chevron-right' | 'close' | 'close-all' | 'cloud-download' | 'cloud-upload' | 'code' | 'color-mode' | 'edit'
  | 'diff' | 'diff-sidebyside' | 'diff-single' | 'discard' | 'file' | 'file-code' | 'file-media' | 'file-pdf' | 'file-zip'
  | 'files' | 'folder' | 'folder-opened' | 'git-branch' | 'git-commit' | 'globe' | 'graph' | 'gripper' | 'home' | 'link-external' | 'list-tree' | 'new-file'
  | 'layout-sidebar-right' | 'layout-sidebar-right-off' | 'new-folder' | 'preview' | 'refresh' | 'remove' | 'screen-full' | 'screen-normal' | 'search' | 'settings' | 'source-control' | 'sparkle' | 'split-horizontal' | 'terminal' | 'trash' | 'history' | 'tools' | 'debug-alt' | 'play' | 'debug-stop' | 'warning' | 'error' | 'info' | 'fold' | 'unfold' | 'lock'
  | 'remote' | 'remote-explorer' | 'server' | 'plug' | 'debug-disconnect' | 'account' | 'eye' | 'eye-closed'

/** Render one glyph from Microsoft's VS Code Codicon font. */
export function Icon({ name, className = '' }: { name: CodiconName; className?: string }) {
  return <span aria-hidden="true" className={`codicon codicon-${name} ${className}`.trim()} />
}
