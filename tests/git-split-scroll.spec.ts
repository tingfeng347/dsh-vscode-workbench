// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { editor } from 'monaco-editor'
import { connectGitSplit } from '../src/client/GitSplitDiff.ts'

afterEach(() => vi.unstubAllGlobals())

it('coalesces wheel events and reuses visible ribbons in the scroll frame', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  const flushFrame = () => {
    const current = [...frames.values()]
    frames.clear()
    current.forEach(callback => callback(0))
  }
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 48 } } as ResizeObserverEntry], this) }
    unobserve() {}
    disconnect() {}
  })

  const fakePane = () => {
    let top = 0
    const subscribe = () => ({ dispose() {} })
    return {
      getModel: () => ({ getLineCount: () => 200 }),
      getLayoutInfo: () => ({ height: 160 }),
      getScrollHeight: () => 4000,
      getScrollTop: () => top,
      setScrollTop: vi.fn((next: number) => { top = next }),
      render: vi.fn(),
      getTopForLineNumber: (line: number) => (line - 1) * 20,
      getBottomForLineNumber: (line: number) => line * 20,
      onDidLayoutChange: subscribe,
      onDidContentSizeChange: subscribe,
      onDidScrollChange: subscribe,
      setHiddenAreas() {},
      changeViewZones() {},
      createDecorationsCollection: () => ({ set() {} }),
    }
  }
  const root = document.createElement('div')
  const ribbons = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const overview = document.createElement('input')
  overview.type = 'range'
  const marks = document.createElement('div')
  const left = fakePane(), right = fakePane()
  const split = connectGitSplit(root, [left, right] as unknown as [editor.IStandaloneCodeEditor, editor.IStandaloneCodeEditor],
    ribbons, overview, marks, document.createElement('div'))
  const wheel = (deltaY: number) => root.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true }))
  try {
    split.update([4, 80].map(line => ({
      originalStartLineNumber: line, originalEndLineNumber: line,
      modifiedStartLineNumber: line, modifiedEndLineNumber: line,
      charChanges: undefined,
    })), false)
    flushFrame()
    const first = ribbons.firstElementChild!
    const initialShape = first.getAttribute('d')
    expect(ribbons.children).toHaveLength(1)
    expect(marks.children).toHaveLength(2)

    wheel(10)
    wheel(20)
    expect(frames.size).toBe(1)
    flushFrame()
    expect(left.setScrollTop.mock.calls).toEqual([[30]])
    expect(right.setScrollTop.mock.calls).toEqual([[30]])
    expect(left.render).toHaveBeenCalledOnce()
    expect(right.render).toHaveBeenCalledOnce()
    expect(ribbons.firstElementChild).toBe(first)
    expect(first.getAttribute('d')).not.toBe(initialShape)
    expect(frames.size).toBe(0)

    wheel(300)
    flushFrame()
    expect(first).toHaveProperty('style.display', 'none')
    wheel(1200)
    flushFrame()
    expect(ribbons.children).toHaveLength(1)
    expect(first).toHaveProperty('style.display', '')
  } finally {
    split.dispose()
  }
})
