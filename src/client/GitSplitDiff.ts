import type { IRange, editor } from 'monaco-editor'

type Pair<T> = [T, T]
type Span = Pair<number>
export const GIT_DIFF_ACCENTS = { modified: '#647fc9', added: '#45a58e', deleted: '#cb4053' } as const
type ChangeKind = keyof typeof GIT_DIFF_ACCENTS
type Block = { lines: Pair<Span>; kind: ChangeKind | 'fold' }
type Plot = { edges: Pair<Span>; endThrough: Pair<number>; startFrom: Pair<number>; kind: Block['kind']; start: number }
type Point = { at: number; offsets: Pair<number> }
type CodeEditor = editor.IStandaloneCodeEditor & { setHiddenAreas(ranges: IRange[], source?: object): void }
const FOLD_HEIGHT = 20
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
) {
  const sides = panes as Pair<CodeEditor>
  const models = sides.map(side=>side.getModel()!) as Pair<editor.ITextModel>
  const zones: Pair<string[]> = [[], []]
  const decorations = sides.map(side=>side.createDecorationsCollection())
  const opened = new Set<string>()
  const foldSource = {}
  let changes: editor.ILineChange[] = []
  let folded = true
  let position = 0
  let height = 0
  let max = 0
  let width = 0
  let points: Point[] = []
  let plots: Plot[] = []
  let blocks: Block[] = []
  const paths: { element: SVGPathElement; kind: Block['kind']; shape: string }[] = []
  let visiblePaths = 0
  let writing = false
  let frame = 0
  let geometryDirty = true
  let wheelDelta = 0
  const appliedTop: Pair<number> = [0,0]

  const length = (side: number) => models[side]!.getLineCount()
  function lineEdge(side: number, line: number): number {
    return line > length(side) ? sides[side]!.getBottomForLineNumber(length(side)) : sides[side]!.getTopForLineNumber(line)
  }

  function draw() {
    if (!width) return
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
      const { edges: [[l0,l1],[r0,r1]], startFrom: [nextLeft,nextRight], kind } = plots[i]!
      if (nextLeft > left + height && nextRight > right + height) break
      const a = l0 - left, b = l1 - left
      const c = r0 - right, d = r1 - right
      if (Math.max(b,d) < 0 || Math.min(a,c) > height) continue
      const bottomLeft = Math.max(a+1,b)
      const bottomRight = Math.max(c+1,d)
      const shape = `M0,${a} C${mid},${a} ${mid},${c} ${width},${c} L${width},${bottomRight} C${mid},${bottomRight} ${mid},${bottomLeft} 0,${bottomLeft} Z`
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
    frame = requestAnimationFrame(()=>{
      frame = 0
      if (geometryDirty) rebuildGeometry()
      const delta = wheelDelta
      wheelDelta = 0
      applyScroll(position + delta)
      draw()
    })
  }

  function invalidateGeometry() {
    geometryDirty = true
    schedule()
  }

  function applyScroll(target: number) {
    position = Math.max(0, Math.min(max, target))
    writing = true
    const previous = [...appliedTop]
    sides.forEach((side, index)=>{
      const current = side.getScrollTop()
      const limit = Math.max(0,side.getScrollHeight() - side.getLayoutInfo().height)
      const top = Math.min(limit,Math.round(linkedScrollOffset(points,position,height,index)))
      if (current !== top) side.setScrollTop(top)
      appliedTop[index] = current === top ? current : side.getScrollTop()
    })
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
    position = Math.max(0, Math.min(max, target))
    schedule()
  }

  function rebuildGeometry() {
    geometryDirty = false
    height = Math.min(...sides.map(side=>side.getLayoutInfo().height))
    points = [{at:0,offsets:[0,0]}]
    plots = []
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
        edges, kind: block.kind, start,
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
          const margin = document.createElement('div')
          margin.className = 'dvw-diff-fold-margin'
          return accessor.addZone({afterLineNumber:start-1, heightInPx:FOLD_HEIGHT, domNode:node, marginDomNode:margin, showInHiddenAreas:true})
        })
      })
      const fullLines = edits.flatMap(({lines,kind})=>{
        const [start,end] = lines[index]!
        if (start === end) return []
        const className = `dvw-diff-line-${kind}`
        return [{range:{startLineNumber:start,endLineNumber:end-1,startColumn:1,endColumn:1},
          options:{isWholeLine:true,className,marginClassName:className}}]
      })
      decorations[index]!.set(fullLines)
    })
    writing = false
    invalidateGeometry()
  }

  function wheel(event: WheelEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.shiftKey || Math.abs(event.deltaY) < Math.abs(event.deltaX) || event.deltaY === 0) return
    event.preventDefault()
    event.stopPropagation()
    const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? height : 1
    wheelDelta += event.deltaY * unit
    schedule()
  }

  const listeners = sides.flatMap((side,index)=>[
    side.onDidLayoutChange(invalidateGeometry),
    side.onDidContentSizeChange(event=>{ if (event.contentHeightChanged) invalidateGeometry() }),
    side.onDidScrollChange(event=>{
      if (writing) return
      if (event.scrollLeftChanged) {
        writing = true
        sides[index===0?1:0].setScrollLeft(event.scrollLeft)
        writing = false
      }
      if (!event.scrollTopChanged || !points.length || event.scrollTop === appliedTop[index]) return
      const top = event.scrollTop
      let low=0, high=max
      for (let count=0; count<20; count++) {
        const mid=(low+high)/2
        const predicted=linkedScrollOffset(points,mid,height,index)
        if (predicted < top) low=mid
        else high=mid
      }
      move(top===0?0:high)
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
  root.addEventListener('wheel',wheel,{capture:true,passive:false})
  overview.addEventListener('input',slide)
  overview.addEventListener('pointermove',hover)
  overview.addEventListener('pointerleave',leave)
  const resize = new ResizeObserver(([entry])=>{
    if (entry === undefined || width === entry.contentRect.width) return
    width = entry.contentRect.width
    schedule()
  })
  resize.observe(ribbons)
  rebuildGeometry()
  schedule()
  return {
    update(next: editor.ILineChange[], collapse: boolean) {
      if (folded !== collapse || changes !== next) opened.clear()
      changes = next
      folded = collapse
      render()
    },
    navigate(direction: 'next' | 'previous') {
      const center = position + Math.min(position,height/2)
      const diffs = plots.filter(plot=>plot.kind!=='fold')
      const next = direction==='next' ? diffs.find(plot=>plot.start>center+1) ?? diffs[0]
        : [...diffs].reverse().find(plot=>plot.start<center-1) ?? diffs.at(-1)
      if (next) move(centerAt(next.start,height))
    },
    dispose() {
      listeners.forEach(listener=>listener.dispose())
      cancelAnimationFrame(frame)
      resize.disconnect()
      root.removeEventListener('wheel',wheel,true)
      overview.removeEventListener('input',slide)
      overview.removeEventListener('pointermove',hover)
      overview.removeEventListener('pointerleave',leave)
      leave()
      ribbons.replaceChildren()
      marks.replaceChildren()
    },
  }
}
