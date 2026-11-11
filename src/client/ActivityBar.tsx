import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

export interface ActivityView {
  id: string
  label: string
  icon: ReactNode
  active: boolean
  disabled?: boolean
  onActivate(): void
}

/** Keep known ids in saved order, appending newly added views at the end. */
export function normalizeActivityOrder(value: unknown, known: readonly string[]): string[] {
  const saved = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && known.includes(id)) : []
  return [...new Set(saved), ...known.filter(id => !saved.includes(id))]
}

/** Move `id` before `before` (or to the end when absent), leaving unknown ids untouched. */
export function moveActivity(order: readonly string[], id: string, before: string | undefined): string[] {
  if (!order.includes(id) || (before !== undefined && !order.includes(before))) return [...order]
  const next = order.filter(value => value !== id)
  const index = before === undefined ? next.length : next.indexOf(before)
  next.splice(index, 0, id)
  return next
}

export function toggleActivityHidden(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter(value => value !== id) : [...hidden, id]
}

/** VS Code-style activity bar: pointer drag with a floating ghost and live reordering, right-click hide. */
export function ActivityBar({ views, fixed, bottom = [], order, hidden, onOrderChange, onHiddenChange }: {
  views: ActivityView[]
  fixed: ActivityView[]
  bottom?: ActivityView[]
  order: string[]
  hidden: string[]
  onOrderChange(order: string[]): void
  onHiddenChange(hidden: string[]): void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; target?: string }>()
  const drag = useRef<{ id: string; x: number; y: number; active: boolean }>()
  const nodes = useRef(new Map<string, HTMLButtonElement>())
  const flip = useRef<Map<string, number>>()
  const suppressClick = useRef(false)
  const [draggingId, setDraggingId] = useState<string>()
  const [ghost, setGhost] = useState<{ x: number; y: number }>()
  const [preview, setPreview] = useState<string[]>()

  useEffect(() => {
    if (menu === undefined) return
    const close = () => setMenu(undefined)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [menu])

  // Animate the neighbours into their new slots after a live reorder, like VS Code's activity bar.
  useLayoutEffect(() => {
    const before = flip.current
    flip.current = undefined
    if (before === undefined) return
    for (const [id, element] of nodes.current) {
      const previous = before.get(id)
      if (previous === undefined) continue
      const delta = previous - element.getBoundingClientRect().top
      if (Math.abs(delta) < 1) continue
      element.animate?.([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease' })
    }
  })

  const visible = views.filter(view => !hidden.includes(view.id))
  const currentOrder = preview ?? order
  const ordered = currentOrder.flatMap(id => visible.filter(view => view.id === id))
  const toggled = (id: string) => onHiddenChange(toggleActivityHidden(hidden, id))
  const target = menu?.target === undefined ? undefined : views.find(view => view.id === menu.target)

  const capturePositions = () => { flip.current = new Map([...nodes.current].map(([id, element]) => [id, element.getBoundingClientRect().top])) }
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return
    drag.current = { id, x: event.clientX, y: event.clientY, active: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    const state = drag.current
    if (state === undefined || state.id !== id) return
    if (!state.active) {
      if (Math.abs(event.clientX - state.x) + Math.abs(event.clientY - state.y) < 5) return
      state.active = true; setDraggingId(id)
    }
    setGhost({ x: event.clientX, y: event.clientY })
    const element = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-act-id]')
    if (element === null || element === undefined) return
    const targetId = element.dataset.actId
    if (targetId === undefined || targetId === id || !visible.some(view => view.id === targetId)) return
    const rect = element.getBoundingClientRect()
    const ids = currentOrder.filter(value => visible.some(view => view.id === value))
    const index = ids.indexOf(targetId)
    if (index < 0) return
    const next = moveActivity(currentOrder, id, event.clientY > rect.top + rect.height / 2 ? ids[index + 1] : targetId)
    if (next.join('|') === currentOrder.join('|')) return
    capturePositions()
    setPreview(next)
  }
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current; drag.current = undefined
    if (state?.active) {
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
      if (preview !== undefined) onOrderChange(preview)
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDraggingId(undefined); setGhost(undefined); setPreview(undefined)
  }
  const cancelDrag = () => { drag.current = undefined; setDraggingId(undefined); setGhost(undefined); setPreview(undefined) }
  const renderView = (view: ActivityView) => <button
    key={view.id}
    ref={element => { if (element === null) nodes.current.delete(view.id); else nodes.current.set(view.id, element) }}
    className="dvw-act"
    data-act-id={view.id}
    data-active={view.active}
    data-dragging={draggingId === view.id || undefined}
    disabled={view.disabled}
    title={view.label}
    onPointerDown={event => beginDrag(event, view.id)}
    onPointerMove={event => moveDrag(event, view.id)}
    onPointerUp={event => endDrag(event)}
    onPointerCancel={cancelDrag}
    onClick={() => { if (!suppressClick.current) view.onActivate() }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, target: view.id }) }}
  >{view.icon}</button>

  return <>
    <nav className="dvw-activity" onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }) }}>
      {ordered.length === 0 ? <span className="dvw-activity-empty" aria-hidden="true"/> : ordered.map(renderView)}
      {fixed.map(view => <button key={view.id} className="dvw-act" data-act-id={view.id} data-active={view.active} disabled={view.disabled} title={view.label} onClick={view.onActivate}>{view.icon}</button>)}
      <div className="dvw-activity-bottom">{bottom.map(view => <button key={view.id} className="dvw-act" data-act-id={view.id} data-active={view.active} disabled={view.disabled} title={view.label} onClick={view.onActivate}>{view.icon}</button>)}</div>
    </nav>
    {draggingId !== undefined && ghost !== undefined && <div className="dvw-activity-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">{views.find(view => view.id === draggingId)?.icon}</div>}
    {menu !== undefined && <div className="dvw-context-menu dvw-activity-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
      {target !== undefined && <button role="menuitem" onClick={() => { toggled(target.id); setMenu(undefined) }}>隐藏“{target.label}”</button>}
      {target !== undefined && <div className="dvw-menu-separator"/>}
      {views.map(view => <button role="menuitem" key={view.id} data-checked={!hidden.includes(view.id)} onClick={() => { toggled(view.id); setMenu(undefined) }}>
        <span className="dvw-menu-check">{hidden.includes(view.id) ? '' : '✓'}</span>{view.label}
      </button>)}
      <div className="dvw-menu-separator"/>
      <button role="menuitem" disabled={hidden.length === 0} onClick={() => { onHiddenChange([]); setMenu(undefined) }}>恢复所有视图</button>
    </div>}
  </>
}
