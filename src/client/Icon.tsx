export type CodiconName =
  | 'add' | 'check' | 'check-all' | 'chevron-down' | 'chevron-right' | 'close' | 'close-all' | 'cloud-upload' | 'code' | 'color-mode' | 'edit'
  | 'diff' | 'diff-sidebyside' | 'diff-single' | 'discard' | 'file' | 'file-code' | 'file-media' | 'file-pdf' | 'file-zip'
  | 'files' | 'folder' | 'folder-opened' | 'git-branch' | 'git-commit' | 'graph' | 'home' | 'list-tree' | 'new-file'
  | 'layout-sidebar-right' | 'layout-sidebar-right-off' | 'new-folder' | 'preview' | 'refresh' | 'remove' | 'search' | 'settings' | 'source-control' | 'sparkle' | 'split-horizontal' | 'terminal' | 'trash'

/** Render one glyph from Microsoft's VS Code Codicon font. */
export function Icon({ name, className = '' }: { name: CodiconName; className?: string }) {
  return <span aria-hidden="true" className={`codicon codicon-${name} ${className}`.trim()} />
}

const CODE_EXTENSIONS = new Set(['c','cc','cpp','cs','css','go','h','hpp','html','java','js','jsx','json','kt','lua','mjs','py','rb','rs','scss','sh','sql','swift','ts','tsx','vue','xml','yaml','yml'])
const MEDIA_EXTENSIONS = new Set(['avif','bmp','gif','ico','jpeg','jpg','mp3','mp4','ogg','png','svg','webm','webp','wav'])

/** Select a Codicon for a file name without depending on a file-icon theme. */
export function fileIcon(name: string): CodiconName {
  const extension = name.includes('.') ? name.split('.').at(-1)?.toLowerCase() ?? '' : ''
  if (CODE_EXTENSIONS.has(extension)) return 'file-code'
  if (MEDIA_EXTENSIONS.has(extension)) return 'file-media'
  if (extension === 'pdf') return 'file-pdf'
  if (['zip','gz','tgz','tar','7z'].includes(extension)) return 'file-zip'
  return 'file'
}
