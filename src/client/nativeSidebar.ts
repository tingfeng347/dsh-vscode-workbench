import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'

type NativeSidebarApi = Pick<ISidebarRight, 'mounted' | 'isExpanded' | 'toggleExpanded'>

const ignoreMount = () => () => {}
const noSession = () => undefined
const presentation = 'data-dvw-native-sidebar'
const sidebarWidth = '--dvw-native-sidebar-width'

/** Lift the host's current dock above the workbench without moving its React tree. */
function watchNativeSidebar(sessionId: string, onWidth: (width: number | undefined) => void): () => void {
  let panel: HTMLElement | undefined
  let column: HTMLElement | null = null
  let measuredWidth: number | undefined

  const release = () => {
    resize?.disconnect()
    column?.removeAttribute(presentation)
    document.body.style.removeProperty(sidebarWidth)
  }
  const measure = () => {
    const width = panel === undefined ? undefined
      : panel.dataset.sidebarRightPanel === 'push' ? panel.getBoundingClientRect().width : 0
    if (width === measuredWidth) return
    measuredWidth = width
    if (width !== undefined) document.body.style.setProperty(sidebarWidth, `${width}px`)
    onWidth(width)
  }
  const update = () => {
    const next = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-rightbar-col] [data-sidebar-right-panel][data-sidebar-right-open="true"]',
    )).find(node => node.dataset.sidebarRightSession === sessionId)
    if (next !== panel) {
      release()
      // A replacement panel may have exactly the same width as its predecessor.
      if (next !== undefined) measuredWidth = undefined
      panel = next
      column = panel?.closest<HTMLElement>('[data-rightbar-col]') ?? null
      column?.setAttribute(presentation, '')
      if (panel !== undefined) resize?.observe(panel)
    }
    measure()
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
  const [dock, setDock] = useState<{ sessionId: string; width: number }>()
  const dismiss = useCallback(() => setRequestedSession(undefined), [])

  useLayoutEffect(() => {
    if (!visible || requestedSession !== sessionId) setRequestedSession(undefined)
  }, [visible, sessionId, requestedSession])

  useLayoutEffect(() => {
    if (!visible || !ready || requestedSession !== sessionId || sessionId === undefined) return
    // Browser tabs can expand the DSH dock internally. Present it only after the workbench toggle
    // was used, and stop presenting when DSH's own collapse control closes it.
    let wasOpen = false
    const stop = watchNativeSidebar(sessionId, width => {
      const open = width !== undefined
      setDock(open ? { sessionId, width } : undefined)
      if (!open && wasOpen) setRequestedSession(undefined)
      wasOpen = open
    })
    return () => {
      stop()
      setDock(undefined)
    }
  }, [visible, ready, requestedSession, sessionId])

  const shown = visible && ready && requestedSession === sessionId && dock !== undefined && dock.sessionId === sessionId
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
  return { ready, shown, width: shown ? dock.width : 0, toggle, dismiss }
}

export function fitNativeSidebarLayout(viewportWidth: number, dockWidth: number, sideWidth: number, chatWidth: number, minChatWidth: number, chatVisible: boolean) {
  if (dockWidth === 0) return { sideWidth, chatWidth, chatFits: true }
  // Keep room for the 48px activity rail and at least 100px of editor space.
  const available = Math.max(0, viewportWidth - dockWidth - 148)
  const chatFits = available >= minChatWidth
  const fittedChatWidth = Math.min(chatWidth, available)
  const visibleChatWidth = chatVisible && chatFits ? fittedChatWidth : 0
  return { sideWidth: Math.min(sideWidth, available - visibleChatWidth), chatWidth: fittedChatWidth, chatFits }
}
