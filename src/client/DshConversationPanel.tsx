import { useLayoutEffect } from 'react'

/** Locate the resident DSH conversation without depending on generated CSS module names. */
export function findDshConversationRoot(documentRoot: Document = document): HTMLElement | null {
  const scroller = documentRoot.querySelector<HTMLElement>('[data-phase] [data-conversation-scroll]')
  const root = scroller?.closest('[data-phase]')
  return root instanceof HTMLElement && root.dataset.phase !== undefined ? root : null
}

/** Keep the official conversation mounted while presenting it in the workbench's right column. */
export function DshConversationPanel({ visible, width, statusHeight }: { visible: boolean; width: number; statusHeight: number }) {
  useLayoutEffect(() => {
    if (!visible) return
    let attached: HTMLElement | null = null
    const attach = () => {
      const next = findDshConversationRoot()
      if (next === attached) return
      attached?.removeAttribute('data-dvw-conversation-panel')
      attached?.style.removeProperty('--dvw-chat-width')
      attached?.style.removeProperty('--dvw-status-height')
      attached = next
      attached?.setAttribute('data-dvw-conversation-panel', '')
      attached?.style.setProperty('--dvw-chat-width', `${width}px`)
      attached?.style.setProperty('--dvw-status-height', `${statusHeight}px`)
    }
    attach()
    document.body.setAttribute('data-dvw-conversation-active', '')
    // Monaco rebuilds its line DOM on every scroll frame; skip workbench-only
    // mutations and coalesce the rest so the document-wide query runs at most once a frame.
    let frame = 0
    const observer = new MutationObserver(records => {
      if (frame !== 0 || records.every(record => record.target instanceof Element && record.target.closest('.dvw-overlay') !== null)) return
      frame = requestAnimationFrame(() => { frame = 0; attach() })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      document.body.removeAttribute('data-dvw-conversation-active')
      attached?.removeAttribute('data-dvw-conversation-panel')
      attached?.style.removeProperty('--dvw-chat-width')
      attached?.style.removeProperty('--dvw-status-height')
    }
  }, [visible, width, statusHeight])
  return null
}

/** Temporarily align the official DSH panel palette with a fixed workbench palette. */
export function DshConversationTheme({ visible, colorScheme, followDsh }: { visible: boolean; colorScheme: 'dark' | 'light' | 'white' | 'eyecare'; followDsh: boolean }) {
  useLayoutEffect(() => {
    if (!visible) return
    const body = document.body
    if (followDsh) {
      body.removeAttribute('data-dvw-palette')
      return
    }
    body.setAttribute('data-dvw-palette', colorScheme)
    return () => body.removeAttribute('data-dvw-palette')
  }, [visible, colorScheme, followDsh])
  return null
}
