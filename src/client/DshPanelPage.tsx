import { useLayoutEffect, useRef } from 'react'
import { findDshGlobalPanel } from './dshPanels.ts'

/**
 * Pin a DSH global panel over the workbench editor while its tab is active.
 * The official page keeps its own DOM and state; switching to a file only
 * hides it, so returning to the tab does not rebuild the page.
 */
export function DshPanelPage({ panelId, active }: { panelId: string; active: boolean }) {
  const activeRef = useRef(active)
  activeRef.current = active
  useLayoutEffect(() => {
    let panel: HTMLElement | null = null
    let frame = 0
    const clear = (node: HTMLElement) => {
      node.removeAttribute('data-dvw-dsh-page')
      node.removeAttribute('data-dvw-dsh-hidden')
      for (const property of ['left', 'top', 'width', 'height']) node.style.removeProperty(property)
    }
    const place = () => {
      const next = findDshGlobalPanel()
      if (next !== panel) {
        if (panel !== null) clear(panel)
        panel = next
        panel?.setAttribute('data-dvw-dsh-page', '')
      }
      if (panel === null) return
      panel.toggleAttribute('data-dvw-dsh-hidden', !activeRef.current)
      if (!activeRef.current) return
      const editor = document.querySelector<HTMLElement>('.dvw-editor')
      if (editor === null) return
      const rect = editor.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      panel.style.setProperty('left', `${Math.round(rect.left)}px`)
      panel.style.setProperty('top', `${Math.round(rect.top)}px`)
      panel.style.setProperty('width', `${Math.round(rect.width)}px`)
      panel.style.setProperty('height', `${Math.round(rect.height)}px`)
    }
    const schedule = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => { frame = 0; place() })
    }
    place()
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    const editor = document.querySelector<HTMLElement>('.dvw-editor')
    if (editor !== null) resize?.observe(editor)
    window.addEventListener('resize', schedule)
    // The page may mount after this effect, or rebuild its subtree on navigation.
    const observer = new MutationObserver(records => {
      if (records.every(record => record.target instanceof Element && record.target.closest('.dvw-overlay') !== null)) return
      schedule()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      resize?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      if (panel !== null) clear(panel)
    }
  }, [panelId, active])
  return null
}
