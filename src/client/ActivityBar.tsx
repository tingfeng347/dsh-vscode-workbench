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

/**
 * VS Code-style activity bar: every view can be dragged into a new slot while `fixed` actions stay pinned on
 * top and `bottom` actions stay pinned at the foot. Reordering is computed from pointer position so it keeps
 * working when the DOM shifts under a fast drag.
 */
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
  const draggingRef = useRef(false)
  const nodes = useRef(new Map<string, HTMLButtonElement>())
  const flip = useRef<Map<string, number>>()
  const didDrag = useRef(false)
  const [draggingId, setDraggingId] = useState<string>()
  const [ghost, setGhost] = useState<{ x: number; y: number }>()
  const [preview, setPreview] = useState<string[]>()
  const previewRef = useRef<string[]>()
  const orderRef = useRef(order)
  const visibleRef = useRef<ActivityView[]>([])
  previewRef.current = preview
  orderRef.current = order

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
    // Reordering mid-drag must not animate: transformed rects would feed back into the next hit test.
    if (draggingRef.current) return
    for (const [id, element] of nodes.current) {
      const previous = before.get(id)
      if (previous === undefined) continue
      const delta = previous - element.getBoundingClientRect().top
      if (Math.abs(delta) < 1) continue
      element.animate?.([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease' })
    }
  })

  const visible = views.filter(view => !hidden.includes(view.id))
  visibleRef.current = visible
  const currentOrder = preview ?? order
  const ordered = currentOrder.flatMap(id => visible.filter(view => view.id === id))
  const toggled = (id: string) => onHiddenChange(toggleActivityHidden(hidden, id))
  const target = menu?.target === undefined ? undefined : views.find(view => view.id === menu.target)

  const capturePositions = () => { flip.current = new Map([...nodes.current].map(([id, element]) => [id, element.getBoundingClientRect().top])) }
  const moveDrag = (clientX: number, clientY: number) => {
    const state = drag.current
    if (state === undefined) return
    if (!state.active) {
      if (Math.abs(clientX - state.x) + Math.abs(clientY - state.y) < 5) return
      state.active = true
      draggingRef.current = true
      setDraggingId(state.id)
    }
    setGhost({ x: clientX, y: clientY })
    const base = previewRef.current ?? orderRef.current
    const visibleIds = new Set(visibleRef.current.map(view => view.id))
    const slots = base.filter(id => visibleIds.has(id) && id !== state.id)
    let index = 0
    for (const id of slots) {
      const element = nodes.current.get(id)
      if (element === undefined) continue
      const rect = element.getBoundingClientRect()
      if (clientY > rect.top + rect.height / 2) index += 1
    }
    const next = moveActivity(base, state.id, slots[index])
    if (next.join('|') === base.join('|')) return
    capturePositions()
    previewRef.current = next
    setPreview(next)
  }
  const endDrag = () => {
    const state = drag.current
    drag.current = undefined
    if (state?.active) {
      const next = previewRef.current
      // Only a reorder swallows the click; a shaky click that crosses the drag threshold still activates the view.
      if (next !== undefined && next.join('|') !== orderRef.current.join('|')) { didDrag.current = true; onOrderChange(next) }
    }
    draggingRef.current = false
    previewRef.current = undefined
    setDraggingId(undefined); setGhost(undefined); setPreview(undefined)
  }
  const cancelDrag = () => {
    drag.current = undefined
    draggingRef.current = false
    previewRef.current = undefined
    setDraggingId(undefined); setGhost(undefined); setPreview(undefined)
  }
  const handlers = useRef({ moveDrag, endDrag, cancelDrag })
  handlers.current = { moveDrag, endDrag, cancelDrag }
  useEffect(() => {
    const move = (event: PointerEvent) => handlers.current.moveDrag(event.clientX, event.clientY)
    const up = () => handlers.current.endDrag()
    const cancel = () => handlers.current.cancelDrag()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [])
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return
    didDrag.current = false
    drag.current = { id, x: event.clientX, y: event.clientY, active: false }
  }
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
    onClick={() => { if (didDrag.current) { didDrag.current = false; return } view.onActivate() }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, target: view.id }) }}
  >{view.icon}</button>

  return <>
    <nav className="dvw-activity" onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }) }}>
      {fixed.map(view => <button key={view.id} className="dvw-act" data-act-id={view.id} data-active={view.active} disabled={view.disabled} title={view.label} onClick={view.onActivate}>{view.icon}</button>)}
      {ordered.length === 0 ? <span className="dvw-activity-empty" aria-hidden="true"/> : ordered.map(renderView)}
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
