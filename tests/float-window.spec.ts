import { describe, expect, it } from 'vitest'
import {
  applyFloatGesture,
  clampFloatRect,
  defaultFloatRect,
  FLOAT_BAR_HEIGHT,
  FLOAT_MIN_HEIGHT,
  FLOAT_MIN_WIDTH,
  openModeValue,
  readFloatMax,
  readFloatRect,
  readOpenMode,
  writeOpenMode,
} from '../src/client/floatWindow.ts'

const viewport = { width: 1440, height: 900 }
const top = 48

describe('floating workbench geometry', () => {
  it('only treats the explicit floating value as a mode change', () => {
    expect(openModeValue('floating')).toBe('floating')
    expect(openModeValue('current')).toBe('current')
    expect(openModeValue('window')).toBe('current')
    expect(openModeValue(null)).toBe('current')
  })

  it('reads and writes the mode through the storage contract', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    expect(readOpenMode(storage)).toBe('current')
    writeOpenMode('floating', storage)
    expect(readOpenMode(storage)).toBe('floating')
  })

  it('falls back to the current layout when storage throws', () => {
    const denied = { getItem: () => { throw new Error('denied') } }
    expect(readOpenMode(denied as unknown as Pick<Storage, 'getItem'>)).toBe('current')
  })

  it('starts with a centred window that leaves the DSH title bar reachable', () => {
    const rect = defaultFloatRect(viewport, top)
    expect(rect.width).toBeGreaterThanOrEqual(FLOAT_MIN_WIDTH)
    expect(rect.height).toBeGreaterThanOrEqual(FLOAT_MIN_HEIGHT)
    expect(rect.x).toBeGreaterThan(0)
    expect(rect.y).toBeGreaterThanOrEqual(top)
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height)
  })

  it('clamps stored sizes and keeps an escape strip on screen', () => {
    expect(clampFloatRect({ x: 0, y: 0, width: 100, height: 100 }, viewport, top))
      .toEqual({ x: 0, y: top, width: FLOAT_MIN_WIDTH, height: FLOAT_MIN_HEIGHT })
    expect(clampFloatRect({ x: 0, y: 0, width: 5000, height: 5000 }, viewport, top))
      .toEqual({ x: 0, y: top, width: viewport.width - 32, height: viewport.height - top - 16 })
    expect(clampFloatRect({ x: -5000, y: 5000, width: 900, height: 520 }, viewport, top).x).toBe(-900 + 160)
    expect(clampFloatRect({ x: 5000, y: 5000, width: 900, height: 520 }, viewport, top)).toMatchObject({ x: viewport.width - 900 - 16, y: viewport.height - 520 - 16 })
  })

  it('moves without changing size and keeps the opposite edge while resizing', () => {
    const start = { x: 100, y: 100, width: 900, height: 520 }
    expect(applyFloatGesture('move', start, 100, 80, viewport, top)).toEqual({ x: 200, y: 180, width: 900, height: 520 })
    expect(applyFloatGesture('e', start, 200, 0, viewport, top)).toEqual({ x: 100, y: 100, width: 1100, height: 520 })
    expect(applyFloatGesture('w', start, 100, 0, viewport, top)).toEqual({ x: 100, y: 100, width: 900, height: 520 })
    expect(applyFloatGesture('s', start, 0, 120, viewport, top)).toEqual({ x: 100, y: 100, width: 900, height: 640 })
  })

  it('does not let a drag push the window above the DSH title bar', () => {
    expect(applyFloatGesture('move', { x: 100, y: 100, width: 900, height: 520 }, 0, -500, viewport, top).y).toBe(top)
  })

  it('restores a saved rect and rejects corrupt geometry', () => {
    expect(readFloatRect(JSON.stringify({ x: 120, y: 90, width: 1000, height: 600 }), viewport, top))
      .toEqual({ x: 120, y: 90, width: 1000, height: 600 })
    expect(readFloatRect('{not json', viewport, top)).toEqual(defaultFloatRect(viewport, top))
    expect(readFloatRect(JSON.stringify({ x: 'a', y: 1, width: 900, height: 520 }), viewport, top)).toEqual(defaultFloatRect(viewport, top))
    expect(readFloatRect(null, viewport, top)).toEqual(defaultFloatRect(viewport, top))
  })

  it('remembers the maximized state and exposes the shared bar height', () => {
    expect(readFloatMax('1')).toBe(true)
    expect(readFloatMax('true')).toBe(true)
    expect(readFloatMax('0')).toBe(false)
    expect(readFloatMax(null)).toBe(false)
    expect(FLOAT_BAR_HEIGHT).toBe(34)
  })
})
