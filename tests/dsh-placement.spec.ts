// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { placeDshSurface } from '../src/client/dshPlacement.ts'

afterEach(() => { document.body.replaceChildren() })

function popoverNode() {
  const node = document.createElement('div')
  const matches = node.matches.bind(node)
  let open = false
  node.showPopover = vi.fn(() => { open = true })
  node.hidePopover = vi.fn(() => { open = false })
  node.matches = selector => selector === ':popover-open' ? open : matches(selector)
  return node
}

function setAnchorStyle(node: HTMLElement, property: string, name: string) {
  node.setAttribute('style', `${property}: ${name}`)
  const read = node.style.getPropertyValue.bind(node.style)
  vi.spyOn(node.style, 'getPropertyValue').mockImplementation(key => key === property ? name : read(key))
}

it('opens only a docked surface’s own native menu in the top layer and gives it back on release', async () => {
  const surface = popoverNode()
  const anchor = document.createElement('button')
  setAnchorStyle(anchor, 'anchor-name', '--native-trigger')
  surface.append(anchor)
  document.body.append(surface)
  const placement = placeDshSurface(surface, true)
  placement.place(new DOMRect(100, 80, 400, 500))

  const makeMenu = (name: string) => {
    const node = popoverNode()
    node.dataset.anchorSide = 'bottom'
    node.dataset.anchorAlign = 'start'
    setAnchorStyle(node, 'position-anchor', name)
    return node
  }
  const nativeMenu = makeMenu('--native-trigger')
  const otherMenu = makeMenu('--elsewhere')
  document.body.append(nativeMenu, otherMenu)
  await Promise.resolve()
  try {
    expect(nativeMenu.matches(':popover-open')).toBe(true)
    expect(otherMenu.showPopover).not.toHaveBeenCalled()
  } finally {
    placement.restore()
  }
  expect(nativeMenu.matches(':popover-open')).toBe(false)
  expect(nativeMenu.hasAttribute('popover')).toBe(false)
})
