/** Adapt DSH's native turn rail, preserving its previews and history-aware navigation. */
export function installConversationNavigation(enabled: boolean): () => void {
  const rails = new Map<HTMLElement, HTMLElement>()
  const railSelector = ':is([data-phase], [data-dvw-native-conversation]) [data-conversation-scroll] nav[aria-label]'
  const mountSelector = '[data-phase], [data-dvw-native-conversation], [data-conversation-scroll], nav[aria-label], button[data-index]'
  let frame = 0

  const release = (rail: HTMLElement, slot: HTMLElement) => {
    rail.removeAttribute('data-dvw-turn-navigation')
    slot.removeAttribute('data-dvw-turn-navigation-slot')
  }
  const update = () => {
    frame = 0
    for (const [rail, slot] of rails) {
      if (rail.isConnected && rail.matches(railSelector) && rail.parentElement === slot) continue
      release(rail, slot)
      rails.delete(rail)
    }
    for (const rail of document.querySelectorAll<HTMLElement>(railSelector)) {
      // Native marks carry virtual-list indexes and localized jump labels.
      if (!rail.querySelector('button[data-index][aria-label]') || rail.parentElement === null) continue
      const slot = rail.parentElement
      const state = enabled ? 'on' : 'off'
      if (rail.getAttribute('data-dvw-turn-navigation') !== state) rail.setAttribute('data-dvw-turn-navigation', state)
      if (slot.getAttribute('data-dvw-turn-navigation-slot') !== state) slot.setAttribute('data-dvw-turn-navigation-slot', state)
      rails.set(rail, slot)
    }
  }
  const observer = new MutationObserver(records => {
    if (frame !== 0) return
    const changed = records.some(record => {
      // Streaming text and virtualized marks already inside a managed rail need no rescan.
      const target = record.target instanceof Element ? record.target : null
      if (target?.closest('[data-dvw-turn-navigation]')) return false
      if (record.type === 'attributes') return target?.matches('button[data-index][aria-label]') === true
      return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
        && (node.matches(mountSelector) || node.querySelector(mountSelector) !== null))
    })
    if (changed) frame = requestAnimationFrame(update)
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-index', 'aria-label'] })
  update()
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    for (const [rail, slot] of rails) release(rail, slot)
    rails.clear()
  }
}
