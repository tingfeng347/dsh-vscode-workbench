import { useLayoutEffect } from 'react'

/** Locate the resident DSH conversation without depending on generated CSS module names. */
export function findDshConversationRoot(documentRoot: Document = document): HTMLElement | null {
  const scroller = documentRoot.querySelector<HTMLElement>('[data-conversation-scroll]')
  const root = scroller?.parentElement
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
    const observer = new MutationObserver(attach)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      attached?.removeAttribute('data-dvw-conversation-panel')
      attached?.style.removeProperty('--dvw-chat-width')
      attached?.style.removeProperty('--dvw-status-height')
    }
  }, [visible, width, statusHeight])
  return null
}

/** Temporarily align the official DSH palette with a fixed workbench palette. */
export function DshConversationTheme({ visible, colorScheme, followDsh }: { visible: boolean; colorScheme: 'dark' | 'light'; followDsh: boolean }) {
  useLayoutEffect(() => {
    if (!visible || followDsh) return
    const body = document.body
    const root = document.documentElement
    const wasDark = body.hasAttribute('data-ds-dark-theme')
    const previousColorScheme = root.style.colorScheme
    body.toggleAttribute('data-ds-dark-theme', colorScheme === 'dark')
    root.style.colorScheme = colorScheme
    return () => {
      body.toggleAttribute('data-ds-dark-theme', wasDark)
      if (previousColorScheme === '') root.style.removeProperty('color-scheme')
      else root.style.colorScheme = previousColorScheme
    }
  }, [visible, colorScheme, followDsh])
  return null
}
