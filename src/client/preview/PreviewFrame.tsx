import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon.tsx'
import { OpenWith } from '../workspace/OpenWith.tsx'

export function PreviewStatus({ children, error = false, retry }: { children: ReactNode; error?: boolean; retry?: () => void }) {
  return <div className="dvw-preview-status" role={error ? 'alert' : 'status'}>
    <span>{children}</span>
    {retry !== undefined && <button type="button" className="dvw-preview-retry" onClick={retry}><Icon name="refresh"/>重试</button>}
  </div>
}

/** Keep the file path and host handoff available through loading and failure. */
export function PreviewFrame({ src, path, children }: { src: string; path: string; children: ReactNode }) {
  const url = new URL(src, location.href)
  const sessionId = url.searchParams.get('sessionId')
  const local = url.pathname === '/dsh-vscode/file' && !url.searchParams.has('commit')
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? path
  return <section className="dvw-document-preview" aria-label={name + ' 预览'}>
    <header className="dvw-preview-header">
      <span className="dvw-preview-path" title={path}>{path}</span>
      {local && sessionId !== null && <OpenWith key={JSON.stringify([sessionId, path])} sessionId={sessionId} path={path}/>}
      <a className="dvw-icon" href={src} download={name} aria-label="下载文件" title="下载文件"><Icon name="cloud-download"/></a>
    </header>
    <div className="dvw-preview-body">{children}</div>
  </section>
}
