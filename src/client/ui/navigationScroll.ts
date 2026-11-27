/** Let the browser animate navigation unless the user requests reduced motion. */
export function navigationScrollBehavior(): ScrollBehavior {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
}

export function scrollNavigationLeft(list: HTMLElement, left: number) {
  if (typeof list.scrollTo === 'function') {
    list.scrollTo({ left, behavior: left === list.scrollLeft ? 'instant' : navigationScrollBehavior() })
  } else {
    list.scrollLeft = left
  }
}
