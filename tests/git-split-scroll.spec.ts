// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { editor } from 'monaco-editor'
import { connectGitSplit, type GitSplitReviewActions } from '../src/client/GitSplitDiff.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(addedLines = 0, reviewActions?: GitSplitReviewActions) {
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
    observe(target: Element) { this.callback([{ target, contentRect: new DOMRect(0, 0, 48, 160) } as ResizeObserverEntry], this) }
    unobserve() {}
    disconnect() {}
  })

  const fakePane = (lines: number) => {
    const node = document.createElement('div')
    root.append(node)
    let notifyScroll = (_top: number) => {}
    let mouseHandler: ((event: editor.IEditorMouseEvent) => void) | undefined
    let leaveHandler: (() => void) | undefined
    let top = 0
    const subscribe = () => ({ dispose() {} })
    return {
      getModel: () => ({ getLineCount: () => lines }),
      getDomNode: () => node,
      getContainerDomNode: () => node,
      getLayoutInfo: () => ({ height: 160, width: 400 }),
      getScrollHeight: () => lines * 20,
      getScrollTop: () => top,
      setScrollTop: vi.fn((next: number) => { top = next }),
      render: vi.fn(),
      getTopForLineNumber: (line: number) => (line - 1) * 20,
      getBottomForLineNumber: (line: number) => line * 20,
      onDidLayoutChange: subscribe,
      onDidContentSizeChange: subscribe,
      onMouseDown(handler: (event: editor.IEditorMouseEvent) => void) {
        mouseHandler = handler
        return subscribe()
      },
      onMouseMove(handler: (event: editor.IEditorMouseEvent) => void) {
        mouseHandler = handler
        return subscribe()
      },
      onMouseLeave(handler: () => void) {
        leaveHandler = handler
        return subscribe()
      },
      onDidChangeCursorSelection() {
        return subscribe()
      },
      onDidScrollChange(handler: (event: { scrollTopChanged: boolean; scrollTop: number }) => void) {
        notifyScroll = scrollTop => handler({ scrollTopChanged: true, scrollTop })
        return subscribe()
      },
      nativeScroll(next: number) { top = next; notifyScroll(top) },
      setHiddenAreas() {},
      changeViewZones() {},
      createDecorationsCollection: () => ({ set() {} }),
      selectLine(line: number) {
        mouseHandler?.({ target: { position: { lineNumber: line, column: 1 } } } as editor.IEditorMouseEvent)
      },
      leave() {
        leaveHandler?.()
      },
    }
  }
  const root = document.createElement('div')
  const ribbons = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const overview = document.createElement('input')
  overview.type = 'range'
  const marks = document.createElement('div')
  const controls = document.createElement('div')
  const left = fakePane(200), right = fakePane(200 + addedLines)
  for (const pane of [left, right]) {
    vi.spyOn(pane.getContainerDomNode(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 160))
  }
  const split = connectGitSplit(root, [left, right] as unknown as [editor.IStandaloneCodeEditor, editor.IStandaloneCodeEditor],
    ribbons, overview, marks, document.createElement('div'), controls, () => reviewActions)
  const wheel = (deltaY: number) => root.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true }))
  return { split, left, right, ribbons, marks, controls, frames, wheel, flushFrame }
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
    const guide = ribbons.querySelector('[data-change=added]')?.getAttribute('d')
    expect(guide).toBe('M-400,118 H0 C24,118 24,118 48,118 H448 V720 H48 C24,720 24,120 0,120 H-400 Z')
    const nativeWheel = new WheelEvent('wheel', { deltaY: 20, bubbles: true, cancelable: true })
    left.getDomNode().dispatchEvent(nativeWheel)
    expect(nativeWheel.defaultPrevented).toBe(false)
    for (const top of [20, 40, 60, 80, 100, 80, 60, 40, 20, 0]) {
      left.nativeScroll(top)
      flushFrame()
      expect(left.setScrollTop).not.toHaveBeenCalled()
      expect(left.getScrollTop()).toBe(top)
      expect(right.getScrollTop()).toBe(top)
    }
    left.nativeScroll(160)
    flushFrame()
    wheel(10)
    flushFrame()
    expect(left.getScrollTop()).toBe(160)
    expect(right.getScrollTop()).toBe(170)
    // Return to the top, then use the right pane to traverse the insertion.
    wheel(-170)
    flushFrame()
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

it('extends the two ends of added, deleted and modified ribbons to their pane edges', () => {
  const { split, ribbons, flushFrame } = setup()
  try {
    split.update([
      { originalStartLineNumber: 1, originalEndLineNumber: 0, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 },
      { originalStartLineNumber: 4, originalEndLineNumber: 4, modifiedStartLineNumber: 4, modifiedEndLineNumber: 0 },
      { originalStartLineNumber: 6, originalEndLineNumber: 6, modifiedStartLineNumber: 6, modifiedEndLineNumber: 6 },
    ].map(change => ({ ...change, charChanges: undefined })), false)
    flushFrame()
    for (const [kind, left, leftBottom, right, rightBottom] of [
      ['added', 20, 20, 20, 40], ['deleted', 60, 80, 80, 80], ['modified', 100, 120, 100, 120],
    ] as const) {
      const shape = ribbons.querySelector(`[data-change=${kind}]`)?.getAttribute('d')
      expect(shape).toBe(`M-400,${left-2} H0 C24,${left-2} 24,${right-2} 48,${right-2} H448 V${rightBottom} H48 C24,${rightBottom} 24,${leftBottom} 0,${leftBottom} H-400 Z`)
    }
  } finally {
    split.dispose()
  }
})

it('keeps compact review controls in the centre gap for each visible change', () => {
  const actions: GitSplitReviewActions = {
    onAsk: vi.fn(),
  }
  const { split, left, ribbons, controls, wheel, flushFrame } = setup(0, actions)
  try {
    split.update([
      { originalStartLineNumber: 4, originalEndLineNumber: 4, modifiedStartLineNumber: 4, modifiedEndLineNumber: 4, charChanges: undefined },
      { originalStartLineNumber: 12, originalEndLineNumber: 13, modifiedStartLineNumber: 12, modifiedEndLineNumber: 14, charChanges: undefined },
    ], false)
    flushFrame()

    const groups = controls.querySelectorAll<HTMLElement>('.dvw-diff-hunk-actions')
    expect(groups).toHaveLength(2)
    expect(groups[0]?.hidden).toBe(true)
    expect(groups[1]?.hidden).toBe(true)
    expect(groups[0]?.querySelectorAll('button')).toHaveLength(1)
    expect(groups[0]?.querySelector('[data-action=ask] .codicon-sparkle')).not.toBeNull()
    left.selectLine(4)
    expect(groups[0]?.style.left).toBe('428px')
    expect(groups[0]?.hidden).toBe(false)
    expect(groups[1]?.hidden).toBe(true)
    groups[0]?.querySelector<HTMLButtonElement>('[data-action=ask]')!.click()
    expect(actions.onAsk).toHaveBeenCalledWith({ startLine: 4, endLine: 4 })

    wheel(50)
    flushFrame()
    expect(groups[0]?.hidden).toBe(true)
    expect(ribbons.querySelector('path')?.style.display).toBe('')

    wheel(90)
    flushFrame()
    left.selectLine(12)
    expect(groups[0]?.hidden).toBe(true)
    expect(groups[1]?.hidden).toBe(false)
    groups[1]?.querySelector<HTMLButtonElement>('[data-action=ask]')!.click()
    expect(actions.onAsk).toHaveBeenLastCalledWith({ startLine: 12, endLine: 14 })

    wheel(600)
    flushFrame()
    expect(groups[0]?.hidden).toBe(true)
    expect(groups[1]?.hidden).toBe(true)
  } finally {
    split.dispose()
  }
})

it('keeps the selected change controls reachable from the edited pane', () => {
  vi.useFakeTimers()
  const actions: GitSplitReviewActions = {
    onAsk: vi.fn(),
  }
  const { split, left, controls, flushFrame } = setup(0, actions)
  try {
    split.update([
      { originalStartLineNumber: 4, originalEndLineNumber: 4, modifiedStartLineNumber: 4, modifiedEndLineNumber: 4, charChanges: undefined },
    ], false)
    flushFrame()

    const group = controls.querySelector<HTMLElement>('.dvw-diff-hunk-actions')!
    left.selectLine(4)
    expect(group.hidden).toBe(false)
    left.leave()
    vi.advanceTimersByTime(2000)
    expect(group.hidden).toBe(false)
    group.dispatchEvent(new Event('pointerleave'))
    vi.advanceTimersByTime(700)
    expect(group.hidden).toBe(true)
  } finally {
    split.dispose()
  }
})
