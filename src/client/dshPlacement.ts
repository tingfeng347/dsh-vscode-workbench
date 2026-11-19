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

/** Present a host-owned node without moving it out of DSH's React tree. */
export function placeDshSurface(node: HTMLElement, floating: boolean) {
  const properties = ['left', 'top', 'width', 'height'] as const
  const styles = properties.map(property => [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)] as const)
  const popover = node.getAttribute('popover')
  const canShowPopover = floating && typeof node.showPopover === 'function'
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
        if (!node.matches(':popover-open')) node.showPopover()
      }
    },
    restore() {
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
