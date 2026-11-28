import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../ui/Icon.tsx'

/** Kept by the editor tab, without a workbench render for every scroll event. */
export interface PreviewView {
  zoom?: number
  scrollTop?: number
  scrollLeft?: number
  pdfPageSizes?: Record<number, { width: number; height: number }>
}

export function clampPdfScale(scale: number, minimum = 0.5): number {
  return Math.max(minimum, Math.min(3, Math.round(scale * 100) / 100))
}

/** Like DSH, fit-width shrinks wide documents and keeps small images at actual size. */
export function fitPreviewWidth(viewport: number, width: number): number {
  return width > 0 ? Math.min(1, Math.max(1, viewport - 24) / width) : 1
}

/** Shared reading surface and bottom zoom controls for PDF, Office and images. */
export function PreviewViewport({ width, view, children }: {
  width: number
  view?: PreviewView
  children(scale: number): ReactNode
}) {
  const scrollport = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const value = useRef<HTMLSpanElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [preference, setPreference] = useState(view?.zoom)
  const [menu, setMenu] = useState(false)
  const fit = fitPreviewWidth(viewportWidth, width)
  const scale = preference ?? fit
  const minimumScale = Math.min(0.5, fit, scale)
  const currentScale = useRef(scale)
  const pinchTimer = useRef<ReturnType<typeof setTimeout>>()
  const restored = useRef(false)

  const showScale = useCallback((next: number, clientX?: number, clientY?: number) => {
    const node = scrollport.current
    if (node === null) return
    const bounds = node.getBoundingClientRect()
    const x = clientX === undefined ? node.clientWidth / 2 : clientX - bounds.left
    const y = clientY === undefined ? node.clientHeight / 2 : clientY - bounds.top
    const ratio = next / currentScale.current
    frame.current?.setAttribute('data-zoom-mode', 'fixed')
    frame.current?.style.setProperty('--dvw-preview-zoom', String(next))
    if (value.current !== null) value.current.textContent = Math.round(next * 100) + '%'
    node.scrollLeft = (node.scrollLeft + x) * ratio - x
    node.scrollTop = (node.scrollTop + y) * ratio - y
    currentScale.current = next
  }, [])
  const chooseScale = useCallback((next: number | undefined) => {
    clearTimeout(pinchTimer.current)
    pinchTimer.current = undefined
    if (next !== undefined) showScale(next)
    setPreference(next)
    if (view !== undefined) view.zoom = next
    if (frame.current?.querySelector('.dvw-preview-zoom-menu')?.contains(document.activeElement)) value.current?.parentElement?.focus({ preventScroll: true })
    setMenu(false)
  }, [showScale, view])

  useLayoutEffect(() => {
    const node = scrollport.current!
    const measure = () => setViewportWidth(node.clientWidth)
    measure()
    restored.current = false
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [view])
  useLayoutEffect(() => {
    if (restored.current || viewportWidth === 0 || width === 0) return
    const node = scrollport.current!
    node.scrollTop = view?.scrollTop ?? 0
    node.scrollLeft = view?.scrollLeft ?? 0
    restored.current = true
  }, [viewportWidth, width, view])
  useLayoutEffect(() => {
    if (pinchTimer.current !== undefined) return
    currentScale.current = scale
    frame.current?.setAttribute('data-zoom-mode', preference === undefined ? 'fit-width' : 'fixed')
    frame.current?.style.setProperty('--dvw-preview-zoom', String(scale))
  }, [scale, preference])
  useEffect(() => {
    const node = scrollport.current!
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      frame.current?.setAttribute('data-controls-visible', '')
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1
      const delta = Math.max(-40, Math.min(40, event.deltaY * unit))
      const next = clampPdfScale(currentScale.current * Math.exp(-delta * 0.01), Math.min(minimumScale, currentScale.current))
      showScale(next, event.clientX, event.clientY)
      clearTimeout(pinchTimer.current)
      pinchTimer.current = setTimeout(() => {
        pinchTimer.current = undefined
        setPreference(currentScale.current)
        if (view !== undefined) view.zoom = currentScale.current
        frame.current?.removeAttribute('data-controls-visible')
      }, 120)
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => { node.removeEventListener('wheel', wheel); clearTimeout(pinchTimer.current) }
  }, [minimumScale, showScale, view])
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !frame.current?.querySelector('.dvw-preview-controls')?.contains(event.target)) setMenu(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenu(false)
      value.current?.parentElement?.focus({ preventScroll: true })
    }
    frame.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus({ preventScroll: true })
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [menu])

  return <div ref={frame} className="dvw-preview-viewport" data-zoom-mode={preference === undefined ? 'fit-width' : 'fixed'} style={{ '--dvw-preview-zoom': scale, '--dvw-preview-available': Math.max(1, viewportWidth - 24) + 'px' } as CSSProperties}
    onPointerMove={event => {
      const node = event.currentTarget
      const visible = event.clientY >= node.getBoundingClientRect().bottom - 72
      if (node.hasAttribute('data-controls-visible') !== visible) node.toggleAttribute('data-controls-visible', visible)
    }}
    onPointerLeave={event => event.currentTarget.removeAttribute('data-controls-visible')}>
    <div ref={scrollport} className="dvw-preview-scrollport" onScroll={event => {
      if (view === undefined || !restored.current) return
      view.scrollTop = event.currentTarget.scrollTop
      view.scrollLeft = event.currentTarget.scrollLeft
    }}>{children(scale)}</div>
    {width > 0 && <div className="dvw-preview-controls-zone">
      <div className="dvw-preview-controls" role="group" aria-label="缩放控件" data-open={menu}>
        <button type="button" className="dvw-icon" aria-label="缩小" title="缩小" disabled={scale <= minimumScale} onClick={() => chooseScale(clampPdfScale(scale - 0.1, minimumScale))}><Icon name="remove"/></button>
        <button type="button" className="dvw-preview-zoom" aria-label="选择缩放比例" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)}><span ref={value}>{Math.round(scale * 100)}%</span><Icon name="chevron-down"/></button>
        <button type="button" className="dvw-icon" aria-label="放大" title="放大" disabled={scale >= 3} onClick={() => chooseScale(clampPdfScale(scale + 0.1, minimumScale))}><Icon name="add"/></button>
        {menu && <div className="dvw-preview-zoom-menu" role="menu" aria-label="选择缩放比例" onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
          const current = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }}>
          <button type="button" role="menuitemradio" aria-checked={preference === undefined} onClick={() => chooseScale(undefined)}>适应宽度</button>
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(zoom => <button type="button" role="menuitemradio" aria-checked={preference === zoom} key={zoom} onClick={() => chooseScale(zoom)}>{zoom * 100}%</button>)}
        </div>}
      </div>
    </div>}
  </div>
}
