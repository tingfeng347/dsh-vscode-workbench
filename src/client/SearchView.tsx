import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchMatch, SearchReplaceResult, SearchRequest } from '../types.ts'
import { api } from './api.ts'
import { FileIcon } from './FileIcon.tsx'
import { Icon, type CodiconName } from './Icon.tsx'
import { replacementFor, referencedGroups } from './searchReplacement.ts'

const options = [
  ['caseSensitive', 'case-sensitive', '区分大小写'],
  ['wholeWord', 'whole-word', '全字匹配'],
  ['regex', 'regex', '使用正则表达式'],
] as const
type SearchResult = { matches: SearchMatch[]; limited: boolean }
interface Props {
  sessionId: string
  cwd: string
  visible: boolean
  focus?: { replace: boolean }
  isDirty(path: string): boolean
  onChanged(paths: string[]): void
  onOpen(path: string, line: number, column: number, match: string): void
}

function groupByFile(matches: SearchMatch[]): Map<string, SearchMatch[]> {
  const files = new Map<string, SearchMatch[]>()
  for (const row of matches) {
    const rows = files.get(row.path)
    if (rows) rows.push(row)
    else files.set(row.path, [row])
  }
  return files
}

function matchPrefix(row: SearchMatch): string {
  const prefix = row.preview.slice(0, row.column - 1)
  if (prefix.length <= 20) return prefix
  return '…' + prefix.slice(-10).replace(/^[\uDC00-\uDFFF]/u, '')
}

function Action({ icon, label, onClick, disabled, pressed, expanded, className = '' }: {
  icon: CodiconName; label: string; onClick(): void; disabled?: boolean; pressed?: boolean; expanded?: boolean; className?: string
}) {
  return <button type="button" title={label} aria-label={label} aria-pressed={pressed} aria-expanded={expanded}
    disabled={disabled} className={`dvw-icon ${className}`} onClick={onClick}><Icon name={icon}/></button>
}

export const SearchView = memo(function SearchView({ sessionId, cwd, visible, focus, isDirty, onChanged, onOpen }: Props) {
  const [criteria, setCriteria] = useState<SearchRequest>({ query: '' })
  const [replacement, setReplacement] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [details, setDetails] = useState(false)
  const [preserveCase, setPreserveCase] = useState(false)
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const [refresh, setRefresh] = useState(0)
  const captureKey = replaceOpen && criteria.regex ? referencedGroups(replacement).join(',') : ''
  const request = useMemo(() => ({ criteria, refresh, captureGroups: captureKey ? captureKey.split(',').map(Number) : [] }), [criteria, refresh, captureKey])
  const mounted = useRef(false)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [response, setResponse] = useState<{ request: typeof request; result?: SearchResult; error?: string }>()
  const [replacing, setReplacing] = useState(false)
  const [notice, setNotice] = useState('')
  const queryInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const seenFocus = useRef<Props['focus']>()
  useEffect(() => {
    if (!visible) return
    const openReplace = focus !== seenFocus.current && focus?.replace
    seenFocus.current = focus
    if (openReplace) setReplaceOpen(true)
    const frame = requestAnimationFrame(() => {
      const input = openReplace ? replaceInput.current : queryInput.current
      input?.focus()
      input?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, focus])

  useEffect(() => {
    if (!criteria.query) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const result = await api<SearchResult>('search', { sessionId, ...criteria, captureGroups: request.captureGroups }, controller.signal)
        if (!controller.signal.aborted) setResponse({ request, result })
      } catch (error) {
        if (!controller.signal.aborted) setResponse({ request, error: String(error) })
      }
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [sessionId, criteria, request])

  const current = response?.request === request ? response : undefined
  const result = current?.result
  const files = useMemo(() => groupByFile(result?.matches ?? []), [result])
  const showReplacePreview = replaceOpen && replacement.length > 0
  const preview = useMemo(() => {
    const values = new Map<SearchMatch, string>()
    if (!replaceOpen || !result) return values
    const render = replacementFor(criteria, replacement, preserveCase)
    for (const row of result.matches) values.set(row, render(row))
    return values
  }, [result, criteria, replacement, preserveCase, replaceOpen])
  const count = result?.matches.length ?? 0
  const allCollapsed = files.size > 0 && [...files.keys()].every(path => collapsed.has(path))
  const disabled = replacing || !count
  const update = (next: Partial<SearchRequest>) => { setNotice(''); setCriteria(previous => ({ ...previous, ...next })) }
  const rerun = () => setRefresh(value => value + 1)

  async function replace(rows: SearchMatch[], bulk = false) {
    if (disabled || !rows.length || (bulk && result?.limited)) return
    const grouped = groupByFile(rows)
    const dirty = [...grouped.keys()].filter(isDirty)
    if (dirty.length) { setNotice(`请先保存有未保存更改的文件：${dirty.join('、')}`); return }
    if (bulk && !window.confirm(`确定替换 ${grouped.size} 个文件中的 ${rows.length} 处匹配吗？`)) return
    setReplacing(true)
    setNotice('')
    try {
      const edits = [...grouped].map(([path, hits]) => ({
        path, edits: hits.map(row => ({ line: row.line, column: row.column, length: row.match.length,
          lineHash: row.lineHash, text: preview.get(row)! })),
      }))
      const { changed, failures } = await api<SearchReplaceResult>('search.replace', { sessionId, cwd, files: edits })
      if (!mounted.current) return
      if (changed.length) onChanged(changed)
      const total = changed.reduce((sum, path) => sum + grouped.get(path)!.length, 0)
      setNotice([`已替换 ${changed.length} 个文件中的 ${total} 处匹配。`, ...failures.map(f => `${f.path}：${f.message}`)].join('\n'))
    } catch (error) { setNotice(String(error)) }
    finally { setReplacing(false); rerun() }
  }

  return <section className="dvw-search" hidden={!visible} aria-label="工作区搜索">
    <div className="dvw-side-head dvw-search-head"><strong>搜索</strong><div>
      <Action icon="refresh" label="刷新搜索结果" disabled={!criteria.query || replacing} onClick={rerun}/>
      <Action icon="clear-all" label="清除搜索结果" disabled={!criteria.query || replacing} onClick={() => { update({ query: '' }); queryInput.current?.focus() }}/>
      <Action icon={allCollapsed ? 'expand-all' : 'collapse-all'} label={allCollapsed ? '全部展开' : '全部折叠'} disabled={!count} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(files.keys()))}/>
    </div></div>
    <form className="dvw-search-form" onSubmit={e => { e.preventDefault(); rerun() }}>
      <fieldset disabled={replacing}>
        <div className="dvw-search-widget">
          <Action className="dvw-search-disclosure" icon={replaceOpen ? 'chevron-down' : 'chevron-right'} label="切换替换" expanded={replaceOpen} onClick={() => setReplaceOpen(!replaceOpen)}/>
          <div className="dvw-search-box">
            <input ref={queryInput} aria-label="搜索" placeholder="搜索" value={criteria.query} onChange={e => update({ query: e.target.value })}/>
            {options.map(([key, icon, label]) => <Action key={key} icon={icon} label={label} pressed={Boolean(criteria[key])} onClick={() => update({ [key]: !criteria[key] })}/>)}
          </div>
          {replaceOpen && <div className="dvw-replace-row"><div className="dvw-search-box">
            <input ref={replaceInput} aria-label="替换" placeholder="替换" value={replacement} onChange={e => { setReplacement(e.target.value); setNotice('') }}/>
            <Action icon="preserve-case" label="保留大小写" pressed={preserveCase} onClick={() => setPreserveCase(!preserveCase)}/>
          </div><Action icon="replace-all" label="全部替换" disabled={disabled || result?.limited} onClick={() => void replace(result!.matches, true)}/></div>}
        </div>
        <div className="dvw-query-details">
          <Action className="dvw-search-more" icon="ellipsis" label="切换搜索详细信息" expanded={details} onClick={() => setDetails(!details)}/>
          {details && <>{(['include', 'exclude'] as const).map(key => <label key={key}>{key === 'include' ? '包含的文件' : '排除的文件'}
            <input className="dvw-input" placeholder={key === 'include' ? '例如 src/**' : '例如 **/*.test.ts'} value={criteria[key] ?? ''} onChange={e => update({ [key]: e.target.value })}/>
          </label>)}</>}
        </div>
      </fieldset>
    </form>
    {current?.error && <div role="alert" className="dvw-error">{current.error}</div>}
    <div className="dvw-search-status" role="status">
      {replacing ? '正在替换…' : notice}
      {criteria.query && (!current ? ' 正在搜索…' : result?.limited ? ' 仅显示前 2000 处匹配，请缩小范围后批量替换。' :
        result && (count ? ` 在 ${files.size} 个文件中找到 ${count} 处匹配` : ' 未找到结果'))}
    </div>
    <div className="dvw-results">{[...files].map(([path, rows]) => <div key={path}>
      <div className="dvw-search-result-row"><button className="dvw-result-file" aria-expanded={!collapsed.has(path)} title={path} onClick={() => {
        const next = new Set(collapsed); if (next.has(path)) next.delete(path); else next.add(path); setCollapsed(next)
      }}><Icon name={collapsed.has(path) ? 'chevron-right' : 'chevron-down'}/><FileIcon name={path.split('/').at(-1)!}/>
        <span>{path.split('/').at(-1)}</span><small>{path.slice(0, Math.max(0, path.lastIndexOf('/')))}</small><b>{rows.length}</b></button>
        {replaceOpen && <Action className="dvw-result-action" icon="replace-all" label={`替换此文件中的全部匹配：${path}`} disabled={disabled || result?.limited} onClick={() => void replace(rows, true)}/>}
      </div>
      {!collapsed.has(path) && rows.map(row => <div className="dvw-search-result-row" key={`${row.line}:${row.column}`}>
        <button className="dvw-result" title={`${path}:${row.line}:${row.column}　${row.preview}`} onClick={() => onOpen(path, row.line, row.column, row.match)}>
          <span className="dvw-line">{row.line}</span><span className="dvw-preview">{matchPrefix(row)}<mark data-replace={showReplacePreview}>{row.match}</mark>{showReplacePreview && <ins>{preview.get(row)}</ins>}{row.preview.slice(row.column - 1 + row.match.length)}</span>
        </button>{replaceOpen && <Action className="dvw-result-action" icon="replace" label={`替换此匹配：${path}:${row.line}:${row.column}`} disabled={disabled} onClick={() => void replace([row])}/>}
      </div>)}
    </div>)}</div>
  </section>
})
