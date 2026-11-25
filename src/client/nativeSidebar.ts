import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'

/**
 * The slice of the host's right-sidebar service this plugin depends on.
 *
 * Declared structurally rather than imported so the plugin keeps working on DSH builds that predate
 * the `ISidebarRight` export: `ctx.sidebarRight` is absent there, the entry is hidden, and nothing
 * else changes.
 */
export interface NativeSidebarApi {
  readonly mounted: { subscribe(listener: () => void): () => void; getSnapshot(): string | undefined }
  isExpanded(): boolean
  toggleExpanded(): void
}

const ignoreMount = () => () => {}
const noSession = () => undefined
const presentation = 'data-dvw-native-sidebar'
const sidebarWidth = '--dvw-native-sidebar-width'

/** Lift the host's current dock above the workbench without moving its React tree. */
export function watchNativeSidebar(sessionId: string, onOpen: (open: boolean) => void): () => void {
  let panel: HTMLElement | undefined
  let column: HTMLElement | null = null
  let open: boolean | undefined

  const release = () => {
    resize?.disconnect()
    column?.removeAttribute(presentation)
    document.body.style.removeProperty(sidebarWidth)
  }
  const measure = () => {
    if (panel === undefined) return
    const width = panel.dataset.sidebarRightPanel === 'push' ? panel.getBoundingClientRect().width : 0
    const cssWidth = `${width}px`
    if (document.body.style.getPropertyValue(sidebarWidth) !== cssWidth) {
      document.body.style.setProperty(sidebarWidth, cssWidth)
    }
  }
  const update = () => {
    const next = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-rightbar-col] [data-sidebar-right-panel][data-sidebar-right-open="true"]',
    )).find(node => node.dataset.sidebarRightSession === sessionId)
    if (next !== panel) {
      release()
      panel = next
      column = panel?.closest<HTMLElement>('[data-rightbar-col]') ?? null
      column?.setAttribute(presentation, '')
      if (panel !== undefined) resize?.observe(panel)
    }
    measure()
    if (open !== (panel !== undefined)) {
      open = panel !== undefined
      onOpen(open)
    }
  }

  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
  const observer = new MutationObserver(update)
  const columns = Array.from(document.querySelectorAll('[data-rightbar-col]'))
  for (const target of columns.length ? columns : [document.body]) {
    observer.observe(target, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-sidebar-right-session', 'data-sidebar-right-open', 'data-sidebar-right-panel'],
    })
  }
  window.addEventListener('resize', measure)
  update()
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', measure)
    release()
  }
}

export function useNativeSidebar(sidebar: NativeSidebarApi | undefined, sessionId: string | undefined, visible: boolean) {
  const mounted = useSyncExternalStore(
    sidebar?.mounted.subscribe ?? ignoreMount,
    sidebar?.mounted.getSnapshot ?? noSession,
  )
  const ready = sidebar !== undefined && sessionId !== undefined && mounted === sessionId
  const [requestedSession, setRequestedSession] = useState<string>()
  const [openSession, setOpenSession] = useState<string>()
  const dismiss = useCallback(() => setRequestedSession(undefined), [])

  useLayoutEffect(() => {
    if (!visible || requestedSession !== sessionId) setRequestedSession(undefined)
  }, [visible, sessionId, requestedSession])

  useLayoutEffect(() => {
    if (!visible || !ready || requestedSession !== sessionId || sessionId === undefined) return
    // Browser tabs can expand the DSH dock internally. Present it only after the workbench toggle
    // was used, and stop presenting when DSH's own collapse control closes it.
    let wasOpen = false
    const stop = watchNativeSidebar(sessionId, open => {
      setOpenSession(open ? sessionId : undefined)
      if (!open && wasOpen) setRequestedSession(undefined)
      wasOpen = open
    })
    return () => {
      stop()
      setOpenSession(undefined)
    }
  }, [visible, ready, requestedSession, sessionId])

  const shown = visible && ready && requestedSession === sessionId && openSession === sessionId
  const toggle = () => {
    if (sidebar === undefined || sessionId === undefined || sidebar.mounted.getSnapshot() !== sessionId) return
    if (shown) {
      dismiss()
      if (sidebar.isExpanded()) sidebar.toggleExpanded()
    } else {
      setRequestedSession(sessionId)
      if (!sidebar.isExpanded()) sidebar.toggleExpanded()
    }
  }
  return { ready, shown, toggle, dismiss }
}
