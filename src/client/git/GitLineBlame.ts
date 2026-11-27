import type { editor } from 'monaco-editor'
import type { GitBlameRange, GitBlameSource, GitLineBlame } from '../../shared/types.ts'
import { ApiError, api } from '../transport/api.ts'

type CodeEditor = editor.IStandaloneCodeEditor
type Monaco = typeof import('monaco-editor')

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
const BLOCK_SIZE = 96
const CACHE_BLOCKS = 24
type BlameContext = { sessionId: string; source: GitBlameSource }

export function lastBlameLine(model: editor.ITextModel | null): number {
  if (!model) return 0
  const last = model.getLineCount()
  return model.getLineMaxColumn(last) === 1 ? last - 1 : last
}

export function clickedCodeLine(monaco: Monaco, event: editor.IEditorMouseEvent, pane: CodeEditor): number | undefined {
  if (!event.event.leftButton || event.event.altKey || event.event.ctrlKey || event.event.metaKey || event.event.shiftKey) return
  const { type, position } = event.target
  const targets = monaco.editor.MouseTargetType
  if (type !== targets.CONTENT_TEXT && type !== targets.GUTTER_LINE_NUMBERS && type !== targets.CONTENT_EMPTY) return
  if (type === targets.CONTENT_EMPTY && event.target.detail.isAfterLines) return
  const model = pane.getModel()
  if (!position || !model || position.lineNumber > model.getLineCount()) return
  if (position.lineNumber === model.getLineCount() && model.getLineMaxColumn(position.lineNumber) === 1) return
  return position.lineNumber
}

/** Monaco draws original lines in inline diffs as view zones on the modified editor. */
export function clickedDeletedLine(monaco: Monaco, event: editor.IEditorMouseEvent, diff: editor.IStandaloneDiffEditor) {
  if (!event.event.leftButton || event.event.altKey || event.event.ctrlKey || event.event.metaKey || event.event.shiftKey ||
      event.target.type !== monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE) return
  const row = event.target.element?.closest<HTMLElement>('.view-line')
  const zone = row?.parentElement
  if (!row || !zone?.matches('.view-lines.line-delete')) return
  const rowIndex = Array.from(zone.children).indexOf(row)
  const afterLine = event.target.detail.positionBefore?.lineNumber ?? 0
  const change = diff.getLineChanges()?.find(item=>item.originalEndLineNumber > 0 &&
    (item.modifiedEndLineNumber === 0 ? item.modifiedStartLineNumber : item.modifiedStartLineNumber - 1) === afterLine)
  if (!change || rowIndex < 0 || zone.children.length !== change.originalEndLineNumber - change.originalStartLineNumber + 1) return
  const pane = diff.getModifiedEditor()
  const host = pane.getDomNode()
  if (!host) return
  const origin = host.getBoundingClientRect()
  const text = row.firstElementChild ?? row
  return {
    line: change.originalStartLineNumber + rowIndex,
    top: row.getBoundingClientRect().top - origin.top + pane.getScrollTop(),
    end: text.getBoundingClientRect().right - origin.left + pane.getScrollLeft(),
  }
}

export function createGitLineBlame() {
  let active: { pane: CodeEditor; key: string; dispose(): void } | undefined
  const cache = new Map<string, { abort: AbortController; request: Promise<GitBlameRange>; result?: GitBlameRange; expiresAt?: number }>()
  const warmups = new Set<() => void>()

  function loadBlock({sessionId,source}: BlameContext, line: number, last: number) {
    const startLine = Math.floor((line - 1) / BLOCK_SIZE) * BLOCK_SIZE + 1
    const endLine = Math.min(last,startLine+BLOCK_SIZE-1)
    const key = JSON.stringify([sessionId,source,startLine,endLine])
    const cached = cache.get(key)
    if (cached && (cached.expiresAt ?? Infinity) > Date.now()) {
      cache.delete(key)
      cache.set(key,cached)
      return cached
    }
    const abort = new AbortController()
    const entry: NonNullable<ReturnType<typeof cache.get>> = {
      abort,
      request: api<GitBlameRange>('git.blameRange',{sessionId,source,startLine,endLine},abort.signal).then(result=>{
        if (result.startLine !== startLine || result.lines.length !== endLine-startLine+1) {
          throw new Error('Git 返回的行范围不完整')
        }
        entry.result = result
        if (source.kind === 'document') entry.expiresAt = Date.now() + 30_000
        return result
      }).catch(error=>{
        if (cache.get(key) === entry) cache.delete(key)
        throw error
      }),
    }
    cache.delete(key)
    cache.set(key,entry)
    if (cache.size > CACHE_BLOCKS) {
      const oldest = cache.keys().next().value!
      cache.get(oldest)?.abort.abort()
      cache.delete(oldest)
    }
    return entry
  }

  function watch(pane: CodeEditor, lookup: ()=>BlameContext | undefined,
    extra?: (start: number, end: number) => { context: BlameContext; line: number; last: number } | undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined
    function schedule(delay = 0) {
      clearTimeout(timer)
      timer = setTimeout(()=>{
        const context = lookup()
        if (!context && !extra) return
        const last = lastBlameLine(pane.getModel())
        const ranges = last ? pane.getVisibleRanges() : []
        const start = ranges[0]?.startLineNumber ?? 1
        const end = ranges.at(-1)?.endLineNumber ?? start
        if (context && context.source.kind !== 'untracked' && last >= start) {
          const block = (line: number) => Math.floor((line - 1) / BLOCK_SIZE) * BLOCK_SIZE + 1
          const lines = new Set([block(start)])
          for (const range of ranges) {
            for (let line = block(range.startLineNumber); line <= Math.min(last,range.endLineNumber) && lines.size < 4; line += BLOCK_SIZE) lines.add(line)
            if (lines.size >= 4) break
          }
          if (lines.size < 4) lines.add(block(Math.min(last,end+20)))
          for (const line of lines) void loadBlock(context,line,last).request.catch(()=>{})
        }
        const other = extra?.(start,end)
        if (other && other.context.source.kind !== 'untracked' && other.line <= other.last) {
          void loadBlock(other.context,other.line,other.last).request.catch(()=>{})
        }
      },delay)
    }
    const warm = () => schedule()
    const subscriptions = [
      pane.onDidLayoutChange(warm),
      pane.onDidScrollChange(event=>{ if (event.scrollTopChanged) schedule(100) }),
    ]
    warmups.add(warm)
    warm()
    return {dispose() {
      clearTimeout(timer)
      subscriptions.forEach(item=>item.dispose())
      warmups.delete(warm)
    }}
  }

  function clear() {
    active?.dispose()
    active = undefined
  }

  function reset() {
    clear()
    cache.forEach(entry=>entry.abort.abort())
    cache.clear()
    warmups.forEach(warm=>warm())
  }

  function show(pane: CodeEditor, line: number, sessionId: string, source: GitBlameSource | undefined,
    deleted?: {top: number;end: number}, last = lastBlameLine(pane.getModel())) {
    if (line > last) return
    const key = JSON.stringify([sessionId, source, line, deleted])
    if (active?.pane === pane && active.key === key) return
    clear()
    const abort = new AbortController()
    const node = document.createElement('span')
    node.className = 'dvw-git-line-blame'
    node.setAttribute('role', 'status')
    let coordinates: editor.IOverlayWidgetPosition | null = null
    const widget: editor.IOverlayWidget = {
      getId: () => 'dvw.gitLineBlame',
      getDomNode: () => node,
      getPosition: () => coordinates,
    }
    function setText(text: string) {
      node.textContent = text
      node.title = text
    }
    function place() {
      const layout = pane.getLayoutInfo()
      const top = (deleted?.top ?? pane.getTopForLineNumber(line)) - pane.getScrollTop()
      const model = pane.getModel()
      const end = deleted ? deleted.end - pane.getScrollLeft()
        : model && top >= 0 && top < layout.height
          ? pane.getScrolledVisiblePosition({lineNumber:line,column:model.getLineMaxColumn(line)})?.left
          : undefined
      const left = end === undefined ? layout.width : Math.max(layout.contentLeft,end) + 16
      const available = layout.width - layout.verticalScrollbarWidth - left - 8
      node.hidden = top < 0 || top >= layout.height - layout.horizontalScrollbarHeight || available < 40
      if (node.hidden) return
      node.style.maxWidth = `${Math.min(available, 600)}px`
      coordinates = { preference: { top, left } }
      pane.layoutOverlayWidget(widget)
    }
    let frame: number | undefined
    function schedulePlacement() {
      if (frame !== undefined) return
      frame = requestAnimationFrame(()=>{
        frame = undefined
        place()
      })
    }
    const subscriptions = [
      pane.onDidScrollChange(event=>{ if (event.scrollTopChanged || event.scrollLeftChanged) schedulePlacement() }),
      pane.onDidLayoutChange(schedulePlacement),
      pane.onDidChangeHiddenAreas(clear),
      pane.onKeyDown(event=>{ if (event.browserEvent.key === 'Escape') clear() }),
    ]
    active = { pane, key, dispose() {
      abort.abort()
      if (frame !== undefined) cancelAnimationFrame(frame)
      subscriptions.forEach(item=>item.dispose())
      pane.removeOverlayWidget(widget)
    }}
    pane.addOverlayWidget(widget)
    place()
    if (!source) {
      setText('有未保存的改动')
      return
    }
    if (source.kind === 'untracked') {
      setText('尚未提交')
      return
    }
    function display(result: GitLineBlame) {
      if (result.kind !== 'commit') {
        setText(result.kind === 'uncommitted' ? '尚未提交' : '暂无 Git 提交信息')
        return
      }
      const date = new Date(result.timestamp * 1000)
      const time = Number.isNaN(date.valueOf()) ? '' : dateFormat.format(date)
      setText([result.author,time,result.hash.slice(0,8),result.subject].filter(Boolean).join(' · '))
    }
    const entry = loadBlock({sessionId,source},line,last)
    const cached = entry.result
    if (cached) {
      display(cached.lines[line-cached.startLine]!)
      return
    }
    void entry.request.then(result=>{
      if (!abort.signal.aborted) display(result.lines[line-result.startLine]!)
    },error=>{
      if (abort.signal.aborted) return
      if (active?.pane === pane && active.key === key) active.key = ''
      if (error instanceof ApiError && error.code === 'not-found' && error.message.includes('git.blameRange')) {
        setText('请重启 DSH 以加载逐行提交查询')
      } else {
        setText(error instanceof ApiError && error.code === 'stale-diff' ? error.message : '无法获取该行的提交信息')
        if (error instanceof Error) node.title = error.message
      }
    })
  }

  return { show, clear, watch, reset }
}
