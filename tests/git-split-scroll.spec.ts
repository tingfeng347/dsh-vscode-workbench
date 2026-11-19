// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { editor } from 'monaco-editor'
import { connectGitSplit } from '../src/client/GitSplitDiff.ts'

afterEach(() => vi.unstubAllGlobals())

function setup(addedLines = 0) {
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

  const fakePane = (lines: number) => {
    const node = document.createElement('div')
    root.append(node)
    let notifyScroll = (_top: number) => {}
    let top = 0
    const subscribe = () => ({ dispose() {} })
    return {
      getModel: () => ({ getLineCount: () => lines }),
      getDomNode: () => node,
      getLayoutInfo: () => ({ height: 160, width: 400 }),
      getScrollHeight: () => lines * 20,
      getScrollTop: () => top,
      setScrollTop: vi.fn((next: number) => { top = next }),
      render: vi.fn(),
      getTopForLineNumber: (line: number) => (line - 1) * 20,
      getBottomForLineNumber: (line: number) => line * 20,
      onDidLayoutChange: subscribe,
      onDidContentSizeChange: subscribe,
      onDidScrollChange(handler: (event: { scrollTopChanged: boolean; scrollTop: number }) => void) {
        notifyScroll = scrollTop => handler({ scrollTopChanged: true, scrollTop })
        return subscribe()
      },
      nativeScroll(next: number) { top = next; notifyScroll(top) },
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
  const left = fakePane(200), right = fakePane(200 + addedLines)
  const split = connectGitSplit(root, [left, right] as unknown as [editor.IStandaloneCodeEditor, editor.IStandaloneCodeEditor],
    ribbons, overview, marks, document.createElement('div'))
  const wheel = (deltaY: number) => root.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true }))
  return { split, left, right, ribbons, marks, frames, wheel, flushFrame }
}

it('coalesces wheel events and reuses visible ribbons in the scroll frame', () => {
  const { split, left, right, ribbons, marks, frames, wheel, flushFrame } = setup()
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

it('keeps the original pane in control across a long insertion and resumes parallax on the right', () => {
  const { split, left, right, ribbons, wheel, flushFrame } = setup(30)
  try {
    split.update([{ originalStartLineNumber: 6, originalEndLineNumber: 0,
      modifiedStartLineNumber: 7, modifiedEndLineNumber: 36, charChanges: undefined }], false)
    flushFrame()
    expect(ribbons.querySelector('[data-change=added]')?.getAttribute('d')).toContain('M0,120 h-400 v1 H0 Z')
    const nativeWheel = new WheelEvent('wheel', { deltaY: 20, bubbles: true, cancelable: true })
    left.getDomNode().dispatchEvent(nativeWheel)
    expect(nativeWheel.defaultPrevented).toBe(false)
    for (const top of [20, 40, 60, 80, 100, 80, 60, 40, 20, 0]) {
      left.nativeScroll(top)
      flushFrame()
      expect(left.setScrollTop).not.toHaveBeenCalled()
      expect(left.getScrollTop()).toBe(top)
      if (top >= 80) expect(right.getScrollTop()).toBe(top + 600)
    }
    wheel(200)
    flushFrame()
    expect(left.getScrollTop()).toBe(40)
    expect(right.getScrollTop()).toBe(200)
    wheel(100)
    flushFrame()
    expect(left.getScrollTop()).toBe(40)
    expect(right.getScrollTop()).toBe(300)
  } finally {
    split.dispose()
  }
})
