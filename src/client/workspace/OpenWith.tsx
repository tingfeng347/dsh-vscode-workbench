import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** Application images keep their icon-sized fallback when the host icon cannot load. */
function ApplicationIcon({ source, size }: { source: string | null; size: number }) {
  const [failed, setFailed] = useState(false)
  return source === null || failed
    ? <Icon name="link-external"/>
    : <img src={source} alt="" width={size} height={size} draggable={false} onError={() => setFailed(true)}/>
}

/** DSH's compact header action and labeled unsupported-file action share the same file handoff. */
export function OpenWith({ sessionId, path, compact = false }: { sessionId: string; path: string; compact?: boolean }) {
  const [applications, setApplications] = useState<NativeApp[]>()
  const [unavailable, setUnavailable] = useState<string>()
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const anchor = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, maxHeight: 300 })
  useEffect(() => {
    const controller = new AbortController()
    setApplications(undefined)
    setUnavailable(undefined)
    setError(undefined)
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
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      more.current?.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const bounds = anchor.current!.getBoundingClientRect()
      const popup = menu.current!.getBoundingClientRect()
      const list = menu.current!.querySelector<HTMLElement>('.dvw-open-with-applications')!
      const height = Math.min(600, popup.height + list.scrollHeight - list.clientHeight)
      const below = window.innerHeight - bounds.bottom - 12
      const above = bounds.top - 12
      const down = below >= Math.min(220, height) || below >= above
      const maxHeight = Math.max(0, Math.min(600, down ? below : above))
      setMenuPosition({
        left: Math.max(8, Math.min(bounds.right - popup.width, window.innerWidth - popup.width - 8)),
        top: down ? bounds.bottom + 4 : Math.max(8, bounds.top - Math.min(height, maxHeight) - 4),
        maxHeight,
      })
    }
    position()
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open])
  const run = async (options?: { application?: string; reveal?: boolean }) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(undefined)
    setOpen(false)
    try {
      await openExternal(sessionId, path, options)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const preferred = applications?.find(application => application.default) ?? applications?.[0]
  const loading = applications === undefined && unavailable === undefined
  const revealOnly = !loading && preferred === undefined
  const hasMenu = loading || unavailable !== undefined || (applications?.length ?? 0) > 0
  const primaryLabel = loading ? '正在加载打开方式' : revealOnly ? '显示文件位置' : '用 ' + preferred!.name + ' 打开'
  return <div ref={anchor} className="dvw-open-with" data-size={compact ? 'compact' : 'large'}>
    <div className="dvw-open-with-buttons">
      <button type="button" className="dvw-open-with-main" aria-label={primaryLabel} title={primaryLabel} aria-busy={loading || busy} disabled={busy || loading} onClick={() => void run(revealOnly ? { reveal: true } : preferred?.default ? undefined : { application: preferred?.id })}>
        {loading ? <span className="dvw-open-with-skeleton" data-open-target-skeleton aria-hidden="true"/>
          : revealOnly ? <Icon name="folder-opened"/>
          : <ApplicationIcon key={preferred?.icon} source={preferred?.icon ?? null} size={compact ? 13 : 18}/>}
        {!compact && (revealOnly ? '显示文件位置' : '打开')}
      </button>
      {hasMenu && <button ref={more} type="button" className="dvw-open-with-more" aria-label="更多打开方式" aria-haspopup="menu" aria-expanded={open} disabled={busy || loading} onClick={() => setOpen(value => !value)}>
        <Icon name="chevron-down"/>
      </button>}
    </div>
    {open && createPortal(<div ref={menu} className="dvw-context-menu dvw-open-with-menu" role="menu" aria-label="打开方式" style={menuPosition} onKeyDown={event => {
      if (event.key === 'Tab') { setOpen(false); more.current?.focus(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }}>
      <div className="dvw-open-with-applications" role="group" aria-label="应用程序">
        {(applications ?? []).map(application => <button key={application.id} type="button" role="menuitem" onClick={() => void run({ application: application.id })}>
          <ApplicationIcon key={application.icon} source={application.icon} size={14}/>
          {application.name}{application.id === preferred?.id ? '（默认）' : ''}
        </button>)}
        {unavailable !== undefined && <button type="button" role="menuitem" disabled title={unavailable}>无法加载应用列表</button>}
      </div>
      <div className="dvw-menu-separator" role="separator"/>
      <button type="button" role="menuitem" onClick={() => void run({ reveal: true })}><Icon name="folder-opened"/>显示文件位置</button>
    </div>, anchor.current?.closest('.dvw-overlay') ?? document.body)}
    {error !== undefined && <span className="dvw-open-with-note dvw-open-with-error" role="alert">{error}</span>}
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
