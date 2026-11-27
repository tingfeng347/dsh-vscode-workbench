import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../transport/api.ts'
import { Icon } from '../ui/Icon.tsx'

export interface NativeApp {
  id: string
  name: string
  default: boolean
  icon: string | null
}

interface ApplicationsResult {
  available: boolean
  applications: NativeApp[]
}

/** Hand a workspace path to the host desktop, the same way DSH's own preview does. */
export async function openExternal(sessionId: string, path: string, options?: { application?: string; reveal?: boolean }): Promise<void> {
  await api('fs.openExternal', {
    sessionId,
    path,
    ...(options?.application === undefined ? {} : { application: options.application }),
    ...(options?.reveal === true ? { action: 'reveal' } : {}),
  })
}

/** The open-with control DSH shows for files its preview cannot render. */
export function OpenWith({ sessionId, path }: { sessionId: string; path: string }) {
  const [applications, setApplications] = useState<NativeApp[]>()
  const [unavailable, setUnavailable] = useState<string>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setApplications(undefined)
    setUnavailable(undefined)
    setOpen(false)
    void api<ApplicationsResult>('fs.applications', { sessionId, path }, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        if (!result.available) setUnavailable('当前环境没有提供本地应用列表')
        else setApplications(result.applications)
      })
      .catch(reason => {
        if (!controller.signal.aborted) setUnavailable(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [sessionId, path])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [open])
  const run = async (options?: { application?: string; reveal?: boolean }) => {
    setBusy(true)
    setError(undefined)
    setOpen(false)
    try {
      await openExternal(sessionId, path, options)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  const fallback = applications?.find(application => application.default)
  // No handler for this format: offer the file's location instead of an open button that cannot work.
  const revealOnly = unavailable !== undefined || (applications !== undefined && applications.length === 0)
  return <div className="dvw-open-with">
    {revealOnly
      ? <div className="dvw-open-with-buttons">
          <button type="button" className="dvw-open-with-main" disabled={busy} onClick={() => void run({ reveal: true })}>
            <Icon name="folder-opened"/>{busy ? '正在显示…' : '显示文件位置'}
          </button>
        </div>
      : <div className="dvw-open-with-buttons">
          <button type="button" className="dvw-open-with-main" disabled={busy} onClick={() => void run()}>
            {fallback?.icon === null || fallback?.icon === undefined ? <Icon name="link-external"/> : <img src={fallback.icon} alt="" width={18} height={18}/>}
            {busy ? '正在打开…' : '打开'}
          </button>
          <button type="button" className="dvw-open-with-more" aria-label="更多打开方式" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}>
            <Icon name="chevron-down"/>
          </button>
        </div>}
    {open && <div ref={menu} className="dvw-context-menu dvw-open-with-menu" role="menu" onPointerDown={event => event.stopPropagation()}>
      {(applications ?? []).map(application => <button key={application.id} role="menuitem" onClick={() => void run({ application: application.id })}>
        {application.icon === null ? <Icon name="link-external"/> : <img src={application.icon} alt="" width={16} height={16}/>}
        {application.name}{application.default ? '（默认）' : ''}
      </button>)}
      {applications !== undefined && <div className="dvw-menu-separator"/>}
      <button role="menuitem" onClick={() => void run({ reveal: true })}><Icon name="folder-opened"/>显示文件位置</button>
    </div>}
    {error !== undefined && <span className="dvw-open-with-note dvw-open-with-error">{error}</span>}
  </div>
}

/**
 * Fill the editor body of files the workbench cannot render. It portals into the active editor so the
 * control sits exactly where DSH's own preview puts its open button instead of floating over the layout.
 */
export function CenteredOpenWith({ sessionId, path, label }: { sessionId: string; path: string; label: string }) {
  const [host, setHost] = useState<HTMLElement>()
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.dvw-editor[data-dvw-focused-editor] .dvw-editor-body')
      ?? document.querySelector<HTMLElement>('.dvw-editor-body')
      ?? undefined)
  }, [path])
  if (host === undefined) return null
  const icon = /\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv)$/i.test(path) ? 'file-media' : 'file'
  return createPortal(<div className="dvw-unsupported"><Icon name={icon} className="dvw-unsupported-icon"/><span className="dvw-unsupported-label">{label}</span><OpenWith sessionId={sessionId} path={path}/></div>, host)
}
