export type WorkbenchOpenMode = 'current' | 'floating'
export type FloatGesture = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface FloatRect { x: number; y: number; width: number; height: number }
export interface FloatViewport { width: number; height: number }

export const OPEN_MODE_KEY = 'dvw:open-mode'
export const FLOAT_RECT_KEY = 'dvw:float-rect'
export const FLOAT_MAX_KEY = 'dvw:float-max'
export const FLOAT_MIN_WIDTH = 900
export const FLOAT_MIN_HEIGHT = 520
export const FLOAT_MARGIN = 16
export const FLOAT_KEEP_X = 160
export const FLOAT_KEEP_Y = 40
/** Height of the workbench's own drag bar in the floating layout. */
export const FLOAT_BAR_HEIGHT = 34

/** Only the explicit "floating" value changes the behaviour; unknown or unreadable storage keeps the current layout. */
export function openModeValue(value: string | null): WorkbenchOpenMode {
  return value === 'floating' ? 'floating' : 'current'
}

export function readOpenMode(storage?: Pick<Storage, 'getItem'>): WorkbenchOpenMode {
  try { return openModeValue((storage ?? globalThis.localStorage).getItem(OPEN_MODE_KEY)) } catch { return 'current' }
}

export function writeOpenMode(value: WorkbenchOpenMode, storage?: Pick<Storage, 'setItem'>): void {
  try { (storage ?? globalThis.localStorage).setItem(OPEN_MODE_KEY, value) } catch { /* Storage can be denied; the in-memory setting still applies. */ }
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Keep the floating window usable on every display size while leaving an escape strip on screen. */
export function clampFloatRect(rect: FloatRect, viewport: FloatViewport, top: number): FloatRect {
  const maxWidth = Math.max(FLOAT_MIN_WIDTH, viewport.width - FLOAT_MARGIN * 2)
  const maxHeight = Math.max(FLOAT_MIN_HEIGHT, viewport.height - top - FLOAT_MARGIN)
  const width = Math.min(Math.max(Math.round(number(rect.width, FLOAT_MIN_WIDTH)), FLOAT_MIN_WIDTH), maxWidth)
  const height = Math.min(Math.max(Math.round(number(rect.height, FLOAT_MIN_HEIGHT)), FLOAT_MIN_HEIGHT), maxHeight)
  // Prefer keeping the whole window on screen; only fall back to the 160px escape strip
  // when the viewport is too small to contain the minimum size.
  const minX = -width + FLOAT_KEEP_X
  const fitX = viewport.width - width - FLOAT_MARGIN
  const x = Math.min(
    Math.max(Math.round(number(rect.x, 0)), minX),
    Math.max(minX, Math.min(Math.max(0, fitX), viewport.width - FLOAT_KEEP_X)),
  )
  const minY = top
  const fitY = viewport.height - height - FLOAT_MARGIN
  const y = Math.min(
    Math.max(Math.round(number(rect.y, top)), minY),
    Math.max(minY, Math.min(Math.max(top, fitY), viewport.height - FLOAT_KEEP_Y)),
  )
  return { x, y, width, height }
}

/** A generous centred window that still leaves the DSH title bar and edges reachable. */
export function defaultFloatRect(viewport: FloatViewport, top: number): FloatRect {
  const width = Math.min(Math.max(FLOAT_MIN_WIDTH, Math.round(viewport.width * 0.86)), Math.max(FLOAT_MIN_WIDTH, viewport.width - 24))
  const height = Math.min(Math.max(FLOAT_MIN_HEIGHT, Math.round(viewport.height * 0.82)), Math.max(FLOAT_MIN_HEIGHT, viewport.height - 24))
  return clampFloatRect({
    x: Math.round((viewport.width - width) / 2),
    y: Math.max(top + 8, Math.round((viewport.height - height) / 2)),
    width,
    height,
  }, viewport, top)
}

/** Apply one pointer gesture; moving preserves size, resizing keeps the opposite edge fixed. */
export function applyFloatGesture(mode: FloatGesture, rect: FloatRect, dx: number, dy: number, viewport: FloatViewport, top: number): FloatRect {
  let { x, y, width, height } = rect
  if (mode === 'move') {
    x += dx
    y += dy
  } else {
    if (mode.includes('e')) width += dx
    if (mode.includes('s')) height += dy
    if (mode.includes('w')) { width -= dx; x += dx }
    if (mode.includes('n')) { height -= dy; y += dy }
    if (width < FLOAT_MIN_WIDTH) {
      if (mode.includes('w')) x = rect.x + rect.width - FLOAT_MIN_WIDTH
      width = FLOAT_MIN_WIDTH
    }
    if (height < FLOAT_MIN_HEIGHT) {
      if (mode.includes('n')) y = rect.y + rect.height - FLOAT_MIN_HEIGHT
      height = FLOAT_MIN_HEIGHT
    }
  }
  return clampFloatRect({ x, y, width, height }, viewport, top)
}

export function readFloatRect(raw: string | null, viewport: FloatViewport, top: number): FloatRect {
  if (raw === null) return defaultFloatRect(viewport, top)
  try {
    const value = JSON.parse(raw) as Partial<FloatRect>
    if ([value.x, value.y, value.width, value.height].some(item => typeof item !== 'number' || !Number.isFinite(item))) {
      return defaultFloatRect(viewport, top)
    }
    return clampFloatRect(value as FloatRect, viewport, top)
  } catch { return defaultFloatRect(viewport, top) }
}

export function readFloatMax(raw: string | null): boolean {
  return raw === '1' || raw === 'true'
}
