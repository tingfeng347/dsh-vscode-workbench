import type { IRange, editor } from 'monaco-editor'

type Pair<T> = [T, T]
type Span = Pair<number>
export const GIT_DIFF_ACCENTS = { modified: '#647fc9', added: '#45a58e', deleted: '#cb4053' } as const
type ChangeKind = keyof typeof GIT_DIFF_ACCENTS
type Block = { lines: Pair<Span>; kind: ChangeKind | 'fold' }
type Plot = { edges: Pair<Span>; endThrough: Pair<number>; startFrom: Pair<number>; kind: Block['kind']; lines: Pair<Span>; start: number }
type Point = { at: number; offsets: Pair<number> }
type CodeEditor = editor.IStandaloneCodeEditor & { setHiddenAreas(ranges: IRange[], source?: object): void }
export interface GitSplitReviewActions {
  onAsk(range: GitDiffLineRange): void
}
export interface GitDiffLineRange {
  startLine: number
  endLine: number
}
const FOLD_HEIGHT = 20
const GUIDE_HEIGHT = 2
const ACTION_HIDE_DELAY = 700
const ACTION_OFFSET_X = 4
const NS = 'http://www.w3.org/2000/svg'

function interpolate(points: Point[], pos: number, input: (point: Point) => number, output: (point: Point) => number): number {
  let low = 0, high = points.length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (input(points[mid]!) < pos) low = mid + 1
    else high = mid
  }
  const to = points[low]!, from = points[Math.max(0, low - 1)]!
  const width = input(to) - input(from)
  if (width <= 0) return output(to)
  const fraction = Math.max(0, Math.min(1, (pos - input(from)) / width))
  return output(from) + fraction * (output(to) - output(from))
}

export function linkedScrollOffset(points: Point[], position: number, height: number, side: number): number {
  const anchor = Math.min(position, height / 2)
  return Math.max(0, interpolate(points, position + anchor, point=>point.at, point=>point.offsets[side]!) - anchor)
}

function centerAt(position: number, height: number): number {
  const half = height / 2
  return position < height ? position / 2 : position - half
}

function changedBlocks(changes: editor.ILineChange[]): Array<Block & { kind: ChangeKind }> {
  const lines = (start: number, end: number): Span => end === 0 ? [start + 1, start + 1] : [start, end + 1]
  return changes.map(change=>({
    lines: [lines(change.originalStartLineNumber, change.originalEndLineNumber), lines(change.modifiedStartLineNumber, change.modifiedEndLineNumber)],
    kind: change.originalEndLineNumber===0 ? 'added' : change.modifiedEndLineNumber===0 ? 'deleted' : 'modified',
  }))
}

export function colorInlineGitDiff(pane: editor.ICodeEditor, overviewLane: editor.OverviewRulerLane) {
  const modifiedLines = pane.createDecorationsCollection()
  let originalBlocks: Block[] = []

  function colorOriginalZones() {
    const host = pane.getDomNode()
    if (!host) return
    const zones = host.querySelectorAll<HTMLElement>('.view-zones > .view-lines.line-delete')
    const margins = host.querySelectorAll<HTMLElement>('.margin-view-zones > .inline-deleted-margin-view-zone')
    // Monaco inserts its deleted-code view zones and their margins in diff order.
    for (const elements of [zones, margins]) {
      elements.forEach((element, index) => {
        element.classList.toggle('dvw-diff-line-modified',
          elements.length === originalBlocks.length && originalBlocks[index]?.kind === 'modified')
      })
    }
  }

  const observer = new MutationObserver(colorOriginalZones)
  return {
    update(changes: editor.ILineChange[]) {
      pane.getDomNode()?.querySelectorAll('.view-zones,.margin-view-zones').forEach(node => observer.observe(node, { childList: true }))
      const blocks = changedBlocks(changes)
      originalBlocks = blocks.filter(block => block.kind !== 'added')
      const lastLine = pane.getModel()?.getLineCount() ?? 1
      modifiedLines.set(blocks.map(({ kind, lines: [, [start, end]] }) => {
        // A deletion has no modified line. Anchor its overview mark to the adjacent line.
        const first = Math.min(start, lastLine)
        const last = Math.max(first, end - 1)
        const overviewRuler = { color: GIT_DIFF_ACCENTS[kind], position: overviewLane }
        const className = `dvw-diff-line-${kind}`
        return {
          range: { startLineNumber: first, endLineNumber: last, startColumn: 1, endColumn: 1 },
          options: kind === 'deleted' ? { overviewRuler } : {
            isWholeLine: true, className, marginClassName: className, overviewRuler,
          },
        }
      }))
      colorOriginalZones()
    },
    dispose() {
      observer.disconnect()
      modifiedLines.clear()
      originalBlocks = []
      colorOriginalZones()
    },
  }
}

export function connectGitSplit(
  root: HTMLElement,
  panes: Pair<editor.IStandaloneCodeEditor>,
  ribbons: SVGSVGElement,
  overview: HTMLInputElement,
  marks: HTMLElement,
  preview: HTMLElement,
  actionLayer?: HTMLElement,
  reviewActions?: () => GitSplitReviewActions | undefined,
) {
  const sides = panes as Pair<CodeEditor>
  const hosts = sides.map(side=>side.getContainerDomNode()) as Pair<HTMLElement>
  const models = sides.map(side=>side.getModel()!) as Pair<editor.ITextModel>
  const zones: Pair<string[]> = [[], []]
  const opened = new Set<string>()
  const foldSource = {}
  let changes: editor.ILineChange[] = []
  let folded = true
  let position = 0
  let height = 0
  let contentTop = 0
  let max = 0
  let width = 0
  let paneWidths: Pair<number> = [0, 0]
  let points: Point[] = []
  let plots: Plot[] = []
  let selectedPlot: Plot | undefined
  const actionGroups = new Map<Plot, HTMLElement>()
  let blocks: Block[] = []
  const paths: { element: SVGPathElement; kind: Block['kind']; shape: string }[] = []
  let visiblePaths = 0
  let writing = false
  let frame = 0
  let hideTimer: number | undefined
  let geometryDirty = true
  let wheelDelta = 0
  let wheelRemainder = 0
  let lastWheelFrame = 0
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  let originalDrivesScroll = false
  let resumingParallax = false
  const appliedTop: Pair<number> = [0,0]

  const length = (side: number) => models[side]!.getLineCount()
  function lineEdge(side: number, line: number): number {
    return line > length(side) ? sides[side]!.getBottomForLineNumber(length(side)) : sides[side]!.getTopForLineNumber(line)
  }

  function createActionLayer() {
    actionGroups.clear()
    actionLayer?.replaceChildren()
    if (actionLayer === undefined || reviewActions === undefined) return
    for (const plot of plots) {
      if (plot.kind === 'fold') continue
      const group = document.createElement('div')
      group.className = 'dvw-diff-hunk-actions'
      group.dataset.kind = plot.kind
      group.setAttribute('role', 'group')
      group.setAttribute('aria-label', '变更 AI 操作')
      group.hidden = true
      group.addEventListener('pointerenter', cancelHideActions)
      group.addEventListener('pointerleave', scheduleHideActions)
      group.addEventListener('pointerdown', event => event.stopPropagation())
      group.addEventListener('mousedown', event => event.stopPropagation())
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.action = 'ask'
      const label = '询问 AI，把此变更添加到 DSH 对话'
      button.title = label
      button.setAttribute('aria-label', label)
      const mark = document.createElement('span')
      mark.className = 'codicon codicon-sparkle'
      mark.setAttribute('aria-hidden', 'true')
      button.append(mark)
      button.addEventListener('click', event => {
        event.stopPropagation()
        const current = reviewActions()
        if (current === undefined) return
        const side = plot.kind === 'deleted' ? 0 : 1
        const [start, end] = plot.lines[side]
        const lastLine = length(side)
        const startLine = Math.max(1, Math.min(lastLine, start))
        current.onAsk({ startLine, endLine: Math.max(startLine, Math.min(lastLine, end - 1)) })
      })
      group.append(button)
      actionGroups.set(plot, group)
      actionLayer.append(group)
    }
    refreshActions()
  }

  function refreshActions() {
    const current = reviewActions?.()
    for (const group of actionGroups.values()) {
      for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
        button.disabled = current === undefined
      }
    }
  }

  function selectPlot(side: number, line: number | undefined) {
    const next = line === undefined ? undefined : plots.find(plot => {
      if (plot.kind === 'fold') return false
      const lines = plot.lines[side]
      if (lines === undefined) return false
      const [start, end] = lines
      return line >= start && line < Math.max(start + 1, end)
    })
    if (next === undefined) {
      scheduleHideActions()
      return
    }
    cancelHideActions()
    if (next === selectedPlot) return
    selectedPlot = next
    draw()
  }

  function scheduleHideActions() {
    if (hideTimer !== undefined) return
    hideTimer = window.setTimeout(() => {
      hideTimer = undefined
      selectedPlot = undefined
      draw()
    }, ACTION_HIDE_DELAY)
  }

  function cancelHideActions() {
    if (hideTimer === undefined) return
    window.clearTimeout(hideTimer)
    hideTimer = undefined
  }

  function draw() {
    if (!width) return
    const currentActions = reviewActions?.()
    for (const group of actionGroups.values()) group.hidden = true
    const mid = width / 2
    const [left, right] = appliedTop
    let low = 0, high = plots.length
    // A band can cross the viewport even when its two ends are both offscreen.
    while (low < high) {
      const index = (low + high) >>> 1
      const [l, r] = plots[index]!.endThrough
      if (l < left && r < right) low = index + 1
      else high = index
    }
    let used = 0
    for (let i = low; i < plots.length; i++) {
      const plot = plots[i]!
      const { edges: [[l0,l1],[r0,r1]], startFrom: [nextLeft,nextRight], kind } = plot
      if (nextLeft > left + height && nextRight > right + height) break
      const a = l0 - left, b = l1 - left
      const c = r0 - right, d = r1 - right
      if (Math.max(b,d) < 0 || Math.min(a,c) > height) continue
      const group = actionGroups.get(plot)
      if (plot === selectedPlot && group !== undefined && currentActions !== undefined) {
        const leftMiddle = (a + b) / 2
        const rightMiddle = (c + d) / 2
        const visibleTop = Math.max(0, Math.min(height, Math.min(
          Math.max(0, a), Math.max(0, b), Math.max(0, c), Math.max(0, d),
        )))
        const visibleBottom = Math.max(0, Math.min(height, Math.max(
          Math.min(height, a), Math.min(height, b), Math.min(height, c), Math.min(height, d),
        )))
        const center = contentTop + (visibleTop + visibleBottom) / 2
        group.hidden = false
        const halfHeight = (group.offsetHeight || 78) / 2
        const minimum = contentTop + halfHeight
        const maximum = contentTop + height - halfHeight
        group.hidden = center < minimum || center > maximum
        if (!group.hidden) {
          group.style.left = `${paneWidths[0] + width / 2 + ACTION_OFFSET_X}px`
          group.style.top = `${contentTop + Math.max(visibleTop, Math.min(visibleBottom, (leftMiddle + rightMiddle) / 2))}px`
        }
      }
      // Paint both panes and the connector as one fill under the editor text.
      const guide = kind === 'fold' ? 0 : GUIDE_HEIGHT
      const topLeft = a - guide
      const topRight = c - guide
      const shape = `M${-paneWidths[0]},${topLeft} H0 C${mid},${topLeft} ${mid},${topRight} ${width},${topRight} H${width+paneWidths[1]}`
        + ` V${d} H${width} C${mid},${d} ${mid},${b} 0,${b} H${-paneWidths[0]} Z`
      let path = paths[used]
      if (path === undefined) {
        const element = document.createElementNS(NS, 'path')
        element.dataset.change = kind
        element.setAttribute('d', shape)
        path = { element, kind, shape }
        paths.push(path)
        ribbons.appendChild(element)
      } else {
        if (path.kind !== kind) path.element.dataset.change = path.kind = kind
        if (path.shape !== shape) path.element.setAttribute('d', path.shape = shape)
        if (used >= visiblePaths) path.element.style.removeProperty('display')
      }
      used++
    }
    for (let i = used; i < visiblePaths; i++) paths[i]!.element.style.display = 'none'
    visiblePaths = used
  }

  function schedule() {
    if (frame !== 0) return
    frame = requestAnimationFrame(now=>{
      frame = 0
      if (geometryDirty) rebuildGeometry()
      const delta = wheelDelta
      wheelDelta = 0
      // A wheel notch adds travel to one shared timeline. Closely spaced notches
      // build speed, and the remaining distance decays at the same rate on 60/120 Hz.
      const directPosition = Math.max(0, Math.min(max, position + delta))
      const remaining = Math.max(-directPosition, Math.min(max - directPosition, wheelRemainder))
      const elapsed = Math.max(0, now - lastWheelFrame)
      const step = Math.abs(remaining) < 0.5 ? remaining : remaining * -Math.expm1(-elapsed / 24)
      wheelRemainder = remaining - step
      lastWheelFrame = now
      applyScroll(delta + step)
      draw()
      if (wheelRemainder !== 0) schedule()
    })
  }

  function invalidateGeometry() {
    geometryDirty = true
    schedule()
  }

  function positionForRightTop(top: number) {
    if (top === 0) return 0
    const nearby = Math.max(0, Math.min(max, position + top - appliedTop[1]))
    if (Math.round(linkedScrollOffset(points, nearby, height, 1)) === top) return nearby
    let low = 0, high = max
    for (let count = 0; count < 20; count++) {
      const mid = (low + high) / 2
      if (linkedScrollOffset(points, mid, height, 1) < top) low = mid
      else high = mid
    }
    return high
  }

  function applyScroll(delta: number) {
    position = Math.max(0, Math.min(max, position + delta))
    writing = true
    const previous: Pair<number> = [...appliedTop]
    let aligned = true
    sides.forEach((side, index)=>{
      const current = side.getScrollTop()
      if (originalDrivesScroll && index === 0) {
        appliedTop[0] = current
        return
      }
      const limit = Math.max(0,side.getScrollHeight() - side.getLayoutInfo().height)
      let top: number
      if (originalDrivesScroll) {
        // A single original row can correspond to hundreds of inserted rows. Follow
        // the user's actual motion, including reversals, without inverting that mapping.
        top = Math.max(0, Math.min(limit, previous[1] + appliedTop[0] - previous[0]))
        position = positionForRightTop(top)
      } else {
        const mapped = Math.min(limit, Math.round(linkedScrollOffset(points, position, height, index)))
        // On handoff the two panes may be far from the parallax curve. Rejoin
        // it in the direction of the gesture without snapping either pane back.
        const from = current + Math.min(0, delta), to = current + Math.max(0, delta)
        top = resumingParallax ? Math.max(from, Math.min(to, mapped)) : mapped
        if (top !== mapped) aligned = false
      }
      if (current !== top) side.setScrollTop(top)
      appliedTop[index] = current === top ? current : side.getScrollTop()
    })
    if (aligned) resumingParallax = false
    // Monaco usually queues its view render for the next frame. Flush the dirty
    // views here so the ribbon and both code panes are painted at the same offsets.
    sides.forEach((side,index)=>{
      if (appliedTop[index] !== previous[index]) side.render()
    })
    writing = false
    const value = String(position)
    if (overview.value !== value) overview.value = value
  }

  function move(target: number) {
    originalDrivesScroll = false
    resumingParallax = false
    wheelDelta = wheelRemainder = 0
    position = Math.max(0, Math.min(max, target))
    schedule()
  }

  function rebuildGeometry() {
    geometryDirty = false
    height = Math.min(...sides.map(side=>side.getLayoutInfo().height))
    paneWidths = [hosts[0].getBoundingClientRect().width, hosts[1].getBoundingClientRect().width]
    // The scroller's inset is layout geometry, independent of its scroll offset. Read it
    // before applyScroll renders Monaco's token DOM, which would force layout here per frame.
    contentTop = Math.max(0, ...sides.map(side => {
      const pane = side.getDomNode()
      if (pane === null) return 0
      const scroller = pane.querySelector<HTMLElement>('.monaco-scrollable-element')
      return scroller === null ? 0 : scroller.getBoundingClientRect().top - pane.getBoundingClientRect().top
    }))
    points = [{at:0,offsets:[0,0]}]
    plots = []
    selectedPlot = undefined
    function append(offsets: Pair<number>) {
      const last = points.at(-1)!
      const next: Pair<number> = [Math.max(last.offsets[0],offsets[0]),Math.max(last.offsets[1],offsets[1])]
      const distance = Math.max(next[0]-last.offsets[0],next[1]-last.offsets[1])
      if (distance > 0) points.push({at:last.at + distance,offsets:next})
      return points.at(-1)!.at
    }
    for (const block of blocks) {
      const edges = block.lines.map(([start,end], index): Span=>{
        if (block.kind==='fold') {
          const bottom = lineEdge(index,end)
          return [bottom - FOLD_HEIGHT,bottom]
        }
        const top = lineEdge(index,start)
        if (end === start) {
          const at = start > 1 ? sides[index]!.getBottomForLineNumber(start-1) : top
          return [at,at]
        }
        return [top,sides[index]!.getBottomForLineNumber(end-1)]
      }) as Pair<Span>
      const start = append([edges[0][0],edges[1][0]])
      append([edges[0][1],edges[1][1]])
      const previous = plots.at(-1)?.endThrough
      plots.push({
        edges, kind: block.kind, lines: block.lines, start,
        endThrough: [Math.max(edges[0][1],previous?.[0] ?? 0),Math.max(edges[1][1],previous?.[1] ?? 0)],
        startFrom: [edges[0][0],edges[1][0]],
      })
    }
    for (let i = plots.length - 2; i >= 0; i--) {
      const [left,right] = plots[i+1]!.startFrom
      const start = plots[i]!.startFrom
      start[0] = Math.min(start[0],left)
      start[1] = Math.min(start[1],right)
    }
    append([lineEdge(0,length(0)+1),lineEdge(1,length(1)+1)])
    createActionLayer()
    const total = points.at(-1)!.at
    max = total > height ? total - height / 2 : 0
    overview.max = String(max)
    overview.disabled = max === 0
    marks.replaceChildren(...plots.filter(plot=>plot.kind!=='fold').map(plot=>{
      const mark = document.createElement('i')
      mark.dataset.change = plot.kind
      mark.style.top = `${total > 0 ? 100*plot.start/total : 0}%`
      return mark
    }))
  }

  function render() {
    const edits = changedBlocks(changes)
    const folds: Block[] = []
    const ends: Pair<number> = [1,1]
    if (folded && edits.length) {
      for (const next of [...edits, {lines:[[length(0)+1,length(0)+1],[length(1)+1,length(1)+1]] as Pair<Span>}]) {
        const lines: Pair<Span> = [[Math.max(2,ends[0]+3),next.lines[0][0]-3],[Math.max(2,ends[1]+3),next.lines[1][0]-3]]
        if (lines.every(([start,end])=>end-start>=4) && !opened.has(String(lines[0][0]))) folds.push({lines,kind:'fold'})
        ends[0] = next.lines[0][1]
        ends[1] = next.lines[1][1]
      }
    }
    blocks = [...edits,...folds].sort((a,b)=>a.lines[0][0]-b.lines[0][0] || a.lines[1][0]-b.lines[1][0])
    writing = true
    sides.forEach((side,index)=>{
      const ranges = folds.map(({lines})=>{
        const [start,end] = lines[index]!
        return {startLineNumber:start, endLineNumber:end-1, startColumn:1, endColumn:1}
      })
      side.setHiddenAreas(ranges,foldSource)
      side.changeViewZones(accessor=>{
        zones[index]!.forEach(id=>accessor.removeZone(id))
        zones[index] = folds.map(({lines})=>{
          const [start,end] = lines[index]!
          const node = document.createElement('button')
          node.type = 'button'
          node.className = 'dvw-diff-fold-row'
          node.textContent = `${end-start} 行未改动`
          node.onclick = ()=>{ opened.add(String(lines[0][0])); render() }
          return accessor.addZone({afterLineNumber:start-1, heightInPx:FOLD_HEIGHT, domNode:node, showInHiddenAreas:true})
        })
      })
    })
    writing = false
    invalidateGeometry()
  }

  function wheel(event: WheelEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) < Math.abs(event.deltaX) || event.deltaY === 0) return
    // Let Monaco scroll the original directly. Its scroll event drives only the follower.
    if (sides[0].getDomNode()?.contains(event.target as Node)) {
      wheelDelta = wheelRemainder = 0
      return
    }
    if (originalDrivesScroll) resumingParallax = true
    originalDrivesScroll = false
    event.preventDefault()
    event.stopPropagation()
    const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? height : 1
    const delta = event.deltaY * unit
    // Fine pixel deltas usually include the touchpad driver's own inertia.
    if (reducedMotion?.matches || (event.deltaMode === 0 && (Math.abs(delta) < 40 || !Number.isInteger(delta)))) {
      wheelDelta += wheelRemainder + delta
      wheelRemainder = 0
    } else {
      if (Math.sign(wheelRemainder) !== Math.sign(delta)) {
        wheelDelta += wheelRemainder
        wheelRemainder = 0
        lastWheelFrame = performance.now()
      }
      // Apply most travel on the first paint; only the small tail needs easing.
      wheelDelta += delta * 0.65
      wheelRemainder += delta * 0.35
    }
    schedule()
  }

  const listeners = sides.flatMap((side,index)=>[
    side.onDidLayoutChange(invalidateGeometry),
    side.onDidContentSizeChange(event=>{ if (event.contentHeightChanged) invalidateGeometry() }),
    side.onMouseDown(event=>selectPlot(index,event.target.position?.lineNumber)),
    side.onMouseMove(event=>selectPlot(index,event.target.position?.lineNumber)),
    side.onDidChangeCursorSelection(event=>selectPlot(index,event.selection.positionLineNumber)),
    side.onDidScrollChange(event=>{
      if (writing) return
      if (event.scrollLeftChanged) {
        writing = true
        sides[index===0?1:0].setScrollLeft(event.scrollLeft)
        writing = false
      }
      if (!event.scrollTopChanged || !points.length || event.scrollTop === appliedTop[index]) return
      if (index === 0) {
        originalDrivesScroll = true
        wheelDelta = wheelRemainder = 0
        if (!geometryDirty) {
          applyScroll(0)
          draw()
        } else schedule()
        return
      }
      move(positionForRightTop(event.scrollTop))
    }),
  ])
  const slide = () => move(Number(overview.value))
  const hover = (event: PointerEvent) => {
    const rect = overview.getBoundingClientRect()
    const target = Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)) * (points.at(-1)?.at ?? 0)
    const sideLine = (index: number) => {
      const offset = interpolate(points,target,point=>point.at,point=>point.offsets[index]!)
      let low=1, high=length(index)
      while (low<high) {
        const middle=Math.ceil((low+high)/2)
        if (lineEdge(index,middle)<=offset) low=middle
        else high=middle-1
      }
      return low
    }
    const left=sideLine(0), right=sideLine(1)
    preview.textContent = `原版本 · ${left}\n${models[0].getLineContent(left).trim().slice(0,90)}\n对比版本 · ${right}\n${models[1].getLineContent(right).trim().slice(0,90)}`
    preview.hidden = false
    preview.style.top = `${Math.max(0,Math.min(rect.height-preview.offsetHeight,event.clientY-rect.top))}px`
  }
  const leave = () => { preview.hidden = true }
  const leaveDiff = () => {
    cancelHideActions()
    selectedPlot = undefined
    draw()
  }
  root.addEventListener('wheel',wheel,{capture:true,passive:false})
  root.addEventListener('pointerleave',leaveDiff)
  overview.addEventListener('input',slide)
  overview.addEventListener('pointermove',hover)
  overview.addEventListener('pointerleave',leave)
  const resize = new ResizeObserver(entries=>{
    const gap = entries.find(entry=>entry.target===ribbons)
    if (gap !== undefined) width = gap.contentRect.width
    invalidateGeometry()
  })
  resize.observe(ribbons)
  hosts.forEach(host=>resize.observe(host))
  rebuildGeometry()
  schedule()
  return {
    update(next: editor.ILineChange[], collapse: boolean) {
      if (folded !== collapse || changes !== next) opened.clear()
      changes = next
      folded = collapse
      selectedPlot = undefined
      render()
    },
    navigate(direction: 'next' | 'previous') {
      const center = position + Math.min(position,height/2)
      const diffs = plots.filter(plot=>plot.kind!=='fold')
      const next = direction==='next' ? diffs.find(plot=>plot.start>center+1) ?? diffs[0]
        : [...diffs].reverse().find(plot=>plot.start<center-1) ?? diffs.at(-1)
      if (next) move(centerAt(next.start,height))
    },
    refreshActions,
    dispose() {
      listeners.forEach(listener=>listener.dispose())
      cancelAnimationFrame(frame)
      cancelHideActions()
      resize.disconnect()
      root.removeEventListener('wheel',wheel,true)
      root.removeEventListener('pointerleave',leaveDiff)
      overview.removeEventListener('input',slide)
      overview.removeEventListener('pointermove',hover)
      overview.removeEventListener('pointerleave',leave)
      leave()
      actionLayer?.replaceChildren()
      ribbons.replaceChildren()
      marks.replaceChildren()
    },
  }
}
