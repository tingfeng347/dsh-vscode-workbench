import { useLayoutEffect } from 'react'

/** Present the original browser DOM without moving React-owned nodes or rebuilding webviews. */
const PALETTE: Record<string, string> = {
  '--dsw-alias-bg-base': '--dvw-surface-1', '--dsw-alias-bg-layer-1': '--dvw-surface-2',
  '--dsw-alias-bg-layer-2': '--dvw-surface-3', '--dsw-alias-label-primary': '--dvw-text',
  '--dsw-alias-label-secondary': '--dvw-text-2', '--dsw-alias-label-tertiary': '--dvw-text-3',
  '--dsw-alias-border-l2': '--dvw-border', '--dsw-alias-border-l3': '--dvw-border-soft',
  '--dsw-alias-interactive-bg-hover': '--dvw-hover', '--dsw-alias-interactive-bg-active': '--dvw-active',
}

export function DshBrowserPage({ sessionId, tabId, active, colorScheme }: { sessionId: string; tabId: string; active: boolean; colorScheme: 'dark' | 'light' | 'white' | 'eyecare' }) {
  useLayoutEffect(() => {
    let page: HTMLElement | undefined
    let restore: (() => void) | undefined
    let frame = 0
    const place = () => {
      const next = [...document.querySelectorAll<HTMLElement>('div[data-sidebar-right-tab]')].find(node => node.dataset.sidebarRightTab === tabId && node.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session') === sessionId)
      if (next !== page) {
        restore?.(); page = next
        if (page !== undefined) {
          const node = page
          const popover = node.getAttribute('popover')
          const properties = ['left', 'top', 'width', 'height', 'color-scheme', ...Object.keys(PALETTE)]
          const styles = properties.map(property => [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)])
          node.setAttribute('popover', 'manual')
          node.setAttribute('data-dvw-browser-page', '')
          restore = () => {
            if (node.matches(':popover-open')) node.hidePopover()
            if (popover === null) node.removeAttribute('popover'); else node.setAttribute('popover', popover)
            node.removeAttribute('data-dvw-browser-page')
            for (const [property, value, priority] of styles) node.style.setProperty(property!, value!, priority)
          }
        }
      }
      if (page === undefined) return
      const rect = document.querySelector('.dvw-editor')?.getBoundingClientRect()
      const visible = active && rect !== undefined && rect.width > 0 && rect.height > 0
      if (!visible) { if (page.matches(':popover-open')) page.hidePopover(); return }
      for (const [property, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })) page.style.setProperty(property, `${Math.round(value)}px`, 'important')
      const overlay = document.querySelector('.dvw-overlay')
      if (overlay !== null) {
        const palette = getComputedStyle(overlay)
        for (const [alias, token] of Object.entries(PALETTE)) page.style.setProperty(alias, palette.getPropertyValue(token))
      }
      page.style.setProperty('color-scheme', colorScheme === 'dark' ? 'dark' : 'light')
      // The top layer escapes dockkit clipping while keeping the original DOM parent and lease.
      if (!page.matches(':popover-open')) page.showPopover()
    }
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(() => { frame = 0; place() }) }
    place()
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    const editor = document.querySelector('.dvw-editor')
    if (editor !== null) resize?.observe(editor)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    return () => { observer.disconnect(); resize?.disconnect(); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame); restore?.() }
  }, [sessionId, tabId, active, colorScheme])
  return null
}
