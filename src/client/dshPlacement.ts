/** Follow an editor or conversation slot when layout or the floating frame moves. */
export function watchDshPlacement(selectAnchor: () => HTMLElement | null, place: (rect?: DOMRect) => void) {
  const overlay = document.querySelector('.dvw-overlay')
  let anchor: HTMLElement | null = null
  let frame = 0
  const update = () => {
    const next = selectAnchor()
    if (next !== anchor) {
      if (anchor !== null) resize?.unobserve(anchor)
      anchor = next
      if (anchor !== null) resize?.observe(anchor)
    }
    place(anchor?.getBoundingClientRect())
  }
  const schedule = () => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => { frame = 0; update() })
  }
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
  const observer = new MutationObserver(records => {
    if (selectAnchor() !== anchor || records.some(({ target }) => !overlay?.contains(target))) schedule()
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dvw-focused-editor'] })
  const frameObserver = new MutationObserver(schedule)
  if (overlay !== null) frameObserver.observe(overlay, { attributes: true, attributeFilter: ['style', 'data-dvw-float-fullscreen'] })
  window.addEventListener('resize', schedule)
  update()
  return () => {
    observer.disconnect()
    frameObserver.disconnect()
    resize?.disconnect()
    window.removeEventListener('resize', schedule)
    cancelAnimationFrame(frame)
  }
}

/** DSH portals its CSS-anchored menus to body. Their anchors are only visible
 * to the positioning engine if the menus are also in the top layer. */
function followDshMenus(surface: HTMLElement) {
  const menus = new Set<HTMLElement>()
  const release = (menu: HTMLElement) => {
    if (menu.matches(':popover-open')) menu.hidePopover()
    menu.removeAttribute('popover')
    menus.delete(menu)
  }
  const update = () => {
    for (const menu of menus) {
      if (menu.parentElement !== document.body) release(menu)
    }
    const pending = [...document.body.querySelectorAll<HTMLElement>(':scope > [data-anchor-side][data-anchor-align]:not([popover])')]
    if (pending.length === 0) return
    const anchors = new Set([surface, ...surface.querySelectorAll<HTMLElement>('[style*="anchor-name"]')]
      .flatMap(node => node.style.getPropertyValue('anchor-name').split(/\s*,\s*/))
      .filter(Boolean))
    for (const menu of pending) {
      if (!anchors.has(menu.style.getPropertyValue('position-anchor'))) continue
      menu.setAttribute('popover', 'manual')
      menu.showPopover()
      menus.add(menu)
    }
  }
  const observer = new MutationObserver(update)
  observer.observe(document.body, { childList: true })
  update()
  return () => {
    observer.disconnect()
    for (const menu of menus) release(menu)
  }
}

/** Present a host-owned node without moving it out of DSH's React tree. */
export function placeDshSurface(node: HTMLElement, floating: boolean) {
  const properties = ['left', 'top', 'width', 'height'] as const
  const styles = properties.map(property => [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)] as const)
  const popover = node.getAttribute('popover')
  const canShowPopover = floating && typeof node.showPopover === 'function'
  let stopMenus: (() => void) | undefined
  let fullscreen = document.fullscreenElement
  if (floating) node.setAttribute('data-dvw-floating-surface', '')
  if (canShowPopover) node.setAttribute('popover', 'manual')

  return {
    place(rect?: DOMRect) {
      if (rect === undefined || rect.width <= 0 || rect.height <= 0) return
      for (const property of properties) {
        const value = `${Math.round(rect[property])}px`
        if (node.style.getPropertyValue(property) !== value || node.style.getPropertyPriority(property) !== 'important') {
          node.style.setProperty(property, value, 'important')
        }
      }
      if (canShowPopover && node.isConnected) {
        if (fullscreen !== document.fullscreenElement && node.matches(':popover-open')) node.hidePopover()
        fullscreen = document.fullscreenElement
        if (!node.matches(':popover-open')) {
          stopMenus?.()
          node.showPopover()
          stopMenus = followDshMenus(node)
        }
      }
    },
    restore() {
      stopMenus?.()
      if (canShowPopover) {
        if (node.matches(':popover-open')) node.hidePopover()
        if (popover === null) node.removeAttribute('popover')
        else node.setAttribute('popover', popover)
      }
      if (floating) node.removeAttribute('data-dvw-floating-surface')
      for (const [property, value, priority] of styles) node.style.setProperty(property, value, priority)
    },
  }
}
