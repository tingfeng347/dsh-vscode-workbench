import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'

type NativeSidebarApi = Pick<ISidebarRight, 'mounted' | 'isExpanded' | 'toggleExpanded'>

const ignoreMount = () => () => {}
const noSession = () => undefined
const presentation = 'data-dvw-native-sidebar'
const sidebarWidth = '--dvw-native-sidebar-width'
const panelSelector = '[data-rightbar-col] [data-sidebar-right-panel][data-sidebar-right-session]'
const fullscreenFallbacks = new WeakMap<NativeSidebarApi, Set<string>>()

interface DockLayout { width: number; fullscreen: boolean; pushAvailable: boolean }

function findPanel(sessionId: string, open = false) {
  return Array.from(document.querySelectorAll<HTMLElement>(panelSelector)).find(node =>
    node.dataset.sidebarRightSession === sessionId && node.closest('[hidden]') === null
      && (!open || node.dataset.sidebarRightOpen === 'true'),
  )
}

function findExpandButton(panel: HTMLElement) {
  const frame = panel.closest('[data-rightbar-col]')?.parentElement
  const buttons = frame?.querySelectorAll<HTMLButtonElement>('[data-sidebar-right-expand]:not(:disabled)') ?? []
  return Array.from(buttons).find(button => button.closest('[hidden]') === null)
}

function restorePushMode(sidebar: NativeSidebarApi, sessionId: string) {
  const fallbacks = fullscreenFallbacks.get(sidebar)
  if (!fallbacks?.has(sessionId) || sidebar.mounted.getSnapshot() !== sessionId) return
  const panel = findPanel(sessionId)
  if (panel === undefined) return
  if (panel.dataset.sidebarRightPanel === 'push') {
    fallbacks.delete(sessionId)
    return
  }
  const exit = panel.querySelector<HTMLButtonElement>('[data-sidebar-right-mode="push"]')
  if (!exit) return
  const expanded = sidebar.isExpanded()
  const collapse = panel.querySelector<HTMLButtonElement>('[data-sidebar-right-toggle]')
  if (!expanded) {
    if (!collapse) return
    // The host only changes modes on an expanded dock. Batch the native
    // opener, mode change and collapse to preserve its final visibility.
    findExpandButton(panel)?.click()
    if (!sidebar.isExpanded()) return
  }
  fallbacks.delete(sessionId)
  exit.click()
  if (!expanded && sidebar.isExpanded()) collapse?.click()
}

/** Lift the host's current dock above the workbench without moving its React tree. */
function watchNativeSidebar(sessionId: string, onLayout: (layout: DockLayout | undefined) => void): () => void {
  let panel: HTMLElement | undefined
  let column: HTMLElement | null = null
  let measured: DockLayout | undefined

  const release = () => {
    resize?.disconnect()
    column?.removeAttribute(presentation)
    document.body.style.removeProperty(sidebarWidth)
  }
  const measure = () => {
    const fullscreen = panel?.dataset.sidebarRightPanel === 'fullscreen'
    const pushAvailable = fullscreen && (column?.getBoundingClientRect().width ?? 0) > 0
    const layout = panel === undefined ? undefined : { width: fullscreen ? 0 : panel.getBoundingClientRect().width, fullscreen, pushAvailable }
    if (layout?.width === measured?.width && layout?.fullscreen === measured?.fullscreen && layout?.pushAvailable === measured?.pushAvailable) return
    measured = layout
    if (layout !== undefined) {
      column?.setAttribute(presentation, fullscreen ? 'fullscreen' : 'push')
      document.body.style.setProperty(sidebarWidth, `${layout.width}px`)
    }
    onLayout(layout)
  }
  const update = () => {
    const next = findPanel(sessionId, true)
    const nextColumn = next?.closest<HTMLElement>('[data-rightbar-col]') ?? null
    if (next !== panel || nextColumn !== column) {
      release()
      // A replacement panel may have exactly the same width as its predecessor.
      if (next !== undefined) measured = undefined
      panel = next
      column = nextColumn
      if (column !== null) resize?.observe(column)
      if (panel !== undefined) resize?.observe(panel)
    }
    measure()
  }

  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
  const rightbarColumn = '[data-rightbar-col]'
  const observer = new MutationObserver(records => {
    if (records.some(record => (record.target instanceof Element && record.target.closest(rightbarColumn) !== null)
      || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
        && (node.matches(rightbarColumn) || node.querySelector(rightbarColumn) !== null)))) update()
  })
  observer.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-sidebar-right-session', 'data-sidebar-right-open', 'data-sidebar-right-panel', 'hidden'],
  })
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
  const [dock, setDock] = useState<(DockLayout & { sessionId: string })>()
  const dismiss = useCallback(() => setRequestedSession(undefined), [])

  useLayoutEffect(() => {
    if (!visible || requestedSession !== sessionId) setRequestedSession(undefined)
  }, [visible, sessionId, requestedSession])

  useLayoutEffect(() => {
    if (ready && fullscreenFallbacks.get(sidebar)?.has(sessionId)) {
      queueMicrotask(() => restorePushMode(sidebar, sessionId))
    }
  }, [ready, sidebar, sessionId])

  useLayoutEffect(() => {
    if (!visible || !ready || requestedSession !== sessionId) return
    // Browser tabs can expand the DSH dock internally. Present it only after the workbench toggle
    // was used, and stop presenting when DSH's own collapse control closes it.
    let wasOpen = false
    const stop = watchNativeSidebar(sessionId, layout => {
      const open = layout !== undefined
      setDock(layout === undefined ? undefined : { sessionId, ...layout })
      if (layout && (!layout.fullscreen || layout.pushAvailable)) restorePushMode(sidebar, sessionId)
      if (!open && wasOpen) setRequestedSession(undefined)
      wasOpen = open
    })
    return () => {
      stop()
      // The host opener can be clicked again once the collapse commit ends.
      // During that commit its store has not yet accepted a new expansion.
      if (fullscreenFallbacks.get(sidebar)?.has(sessionId)) {
        queueMicrotask(() => restorePushMode(sidebar, sessionId))
      }
      setDock(undefined)
    }
  }, [visible, ready, requestedSession, sessionId])

  const shown = visible && ready && requestedSession === sessionId && dock !== undefined && dock.sessionId === sessionId
  const toggle = () => {
    if (sidebar === undefined || sessionId === undefined || sidebar.mounted.getSnapshot() !== sessionId) return
    if (shown) {
      restorePushMode(sidebar, sessionId)
      dismiss()
      if (sidebar.isExpanded()) sidebar.toggleExpanded()
    } else {
      setRequestedSession(sessionId)
      if (!sidebar.isExpanded()) {
        const panel = findPanel(sessionId)
        const pushWidth = panel?.style.getPropertyValue('--dsh-sidebar-right-panel-width').trim() || panel?.style.width
        const fullscreen = pushWidth === '0px' && panel?.dataset.sidebarRightPanel === 'push'
          ? panel.querySelector<HTMLButtonElement>('[data-sidebar-right-mode="fullscreen"]') : null
        const expand = panel && findExpandButton(panel)
        if (fullscreen && expand) {
          // The native opener writes without flushing. Set fullscreen in the same React event,
          // before the host checks the push track. The public toggle flushes immediately.
          const fallbacks = fullscreenFallbacks.get(sidebar) ?? new Set<string>()
          fullscreenFallbacks.set(sidebar, fallbacks)
          fallbacks.add(sessionId)
          expand.click()
          fullscreen.click()
        } else sidebar.toggleExpanded()
      }
    }
  }
  return { ready, shown, fullscreen: shown && dock.fullscreen, width: shown ? dock.width : 0, toggle, dismiss }
}

export function fitNativeSidebarLayout({ viewportWidth, dockWidth, sideWidth, chatWidth, minChatWidth, chatVisible, sideVisible, editorVisible }: {
  viewportWidth: number; dockWidth: number; sideWidth: number; chatWidth: number; minChatWidth: number
  chatVisible: boolean; sideVisible: boolean; editorVisible: boolean
}) {
  const available = Math.max(0, Math.floor(viewportWidth - dockWidth - 48))
  // Open content always retains a quarter of the editor/chat area; empty editors yield it all.
  const minContentWidth = editorVisible ? Math.ceil(minChatWidth * 4 / 3) : minChatWidth
  const chatFits = available >= minContentWidth
  const contentReserve = chatVisible && chatFits ? minContentWidth : editorVisible ? 100 : 0
  const sideLimit = Math.max(0, available - contentReserve)
  const fittedSideWidth = sideVisible ? Math.min(sideWidth, sideLimit) : 0
  const contentWidth = Math.max(0, available - fittedSideWidth)
  const chatLimit = editorVisible ? Math.floor(contentWidth * 3 / 4) : contentWidth
  const fittedChatWidth = !editorVisible && chatVisible ? chatLimit : Math.min(chatWidth, chatLimit)
  return { sideWidth: fittedSideWidth, chatWidth: fittedChatWidth, chatFits, sideLimit, chatLimit }
}
