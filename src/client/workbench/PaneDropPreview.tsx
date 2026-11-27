import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { watchDshPlacement } from '../dsh/dshPlacement.ts'
import type { PaneDropPosition } from './panes.ts'

/** A drag hint must paint above host-owned conversations, including their floating top layer. */
export function PaneDropPreview({ group, direction, position, vertical }: PaneDropPosition & { group: string }) {
  const preview = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = preview.current!
    const topLayer = typeof node.showPopover === 'function'
    if (topLayer) node.setAttribute('popover', 'manual')
    const stop = watchDshPlacement(
      () => [...document.querySelectorAll<HTMLElement>('.dvw-pane')].find(pane => pane.dataset.group === group) ?? null,
      rect => {
        if (rect === undefined || rect.width <= 0 || rect.height <= 0) return
        const pane = [...document.querySelectorAll<HTMLElement>('.dvw-pane')].find(pane => pane.dataset.group === group)!
        node.style.setProperty('--dvw-accent', getComputedStyle(pane).getPropertyValue('--dvw-accent'))
        const halfWidth = direction === 'row'
        const halfHeight = direction === 'column' || vertical !== undefined
        node.style.left = `${rect.left + (halfWidth && position === 'second' ? rect.width / 2 : 0)}px`
        node.style.top = `${rect.top + (halfHeight && (vertical ?? position) === 'second' ? rect.height / 2 : 0)}px`
        node.style.width = `${rect.width / (halfWidth ? 2 : 1)}px`
        node.style.height = `${rect.height / (halfHeight ? 2 : 1)}px`
        if (topLayer && !node.matches(':popover-open')) node.showPopover()
      },
    )
    return () => {
      stop()
      if (topLayer && node.matches(':popover-open')) node.hidePopover()
    }
  }, [group, direction, position, vertical])
  return createPortal(<div ref={preview} className="dvw-pane-drop" data-direction={direction} data-position={position} data-vertical={vertical} aria-hidden="true"/>, document.body)
}
