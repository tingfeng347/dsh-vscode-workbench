import { useEffect, useRef, useState } from 'react'

export type ResizeDirection = 1 | -1

/** Calculate a panel dimension from pointer movement, clamped to its usable range. */
export function resizedPanelWidth(startWidth: number, startX: number, nextX: number, direction: ResizeDirection, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(startWidth + (nextX - startX) * direction)))
}

interface PanelResizerProps {
  className: string
  label: string
  size: number
  min: number
  max: number
  defaultSize: number
  direction: ResizeDirection
  orientation?: 'vertical' | 'horizontal'
  hideBelow?: number
  onHide?(): void
  onResize(size: number): void
}

/** Pointer and keyboard resizer shared by editor panes and SSH sections. */
export function PanelResizer({ className, label, size, min, max, defaultSize, direction, orientation = 'vertical', hideBelow, onHide, onResize }: PanelResizerProps) {
  const adjustsHeight = orientation === 'horizontal'
  const coordinate = (event: { clientX: number; clientY: number }) => adjustsHeight ? event.clientY : event.clientX
  const decreaseKey = adjustsHeight ? 'ArrowUp' : 'ArrowLeft'
  const increaseKey = adjustsHeight ? 'ArrowDown' : 'ArrowRight'
  const [dragging, setDragging] = useState(false)
  const stopDragging = useRef<() => void>(() => {})
  useEffect(() => () => stopDragging.current(), [])
  const stop = () => stopDragging.current()

  return <div className={className} data-dragging={dragging || undefined} role="separator" aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(size)} tabIndex={0} title={`${label}，双击恢复默认`} onDoubleClick={() => onResize(defaultSize)} onKeyDown={event => {
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(defaultSize)
      return
    }
    if (event.key !== decreaseKey && event.key !== increaseKey) return
    event.preventDefault()
    const pointerDelta = event.key === increaseKey ? 10 : -10
    onResize(resizedPanelWidth(size, 0, pointerDelta, direction, min, max))
  }} onPointerDown={event => {
    if (event.button !== 0) return
    event.preventDefault()
    stop()
    const start = coordinate(event)
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = adjustsHeight ? 'ns-resize' : 'ew-resize'
    document.body.style.userSelect = 'none'
    setDragging(true)
    const move = (next: PointerEvent) => onResize(resizedPanelWidth(size, start, coordinate(next), direction, min, max))
    const cleanup = (commit = false, end = start) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setDragging(false)
      stopDragging.current = () => {}
      if (!commit) return
      const nextSize = Math.round(size + (end - start) * direction)
      if (hideBelow !== undefined && nextSize < hideBelow) {
        onHide?.()
        return
      }
      onResize(Math.max(min, Math.min(max, nextSize)))
    }
    const up = (next: PointerEvent) => cleanup(true, coordinate(next))
    const cancel = () => cleanup()
    stopDragging.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
  }}/>
}
