import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GitCommit, GitCommitSummary } from '../types.ts'
import { api } from './api.ts'
import { Icon } from './Icon.tsx'

export function CommitHover({ commit, anchor, sessionId, onEnter, onLeave, onClose, onCopy }: {
  commit: GitCommit; anchor: HTMLElement; sessionId?: string
  onEnter(): void; onLeave(): void; onClose(): void; onCopy(): void
}) {
  const card = useRef<HTMLDivElement>(null)
  const [stats, setStats] = useState<GitCommitSummary>()
  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    void api<GitCommitSummary>('git.action', { sessionId, action: 'commit.summary', value: commit.hash }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setStats(result) }).catch(() => {})
    return () => controller.abort()
  }, [commit.hash, sessionId])
  useLayoutEffect(() => {
    const node = card.current!
    node.setAttribute('popover','manual')
    node.showPopover?.()
    const place = () => {
      const row = anchor.getBoundingClientRect()
      const side = anchor.closest('.dvw-side')?.getBoundingClientRect()
      const right = side?.right ?? row.right
      const left = right + node.offsetWidth <= innerWidth - 4 ? right : Math.max(4, innerWidth - node.offsetWidth - 4)
      node.style.left = left + 'px'
      node.style.top = Math.max(4, Math.min(row.top, innerHeight - node.offsetHeight - 4)) + 'px'
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    observer?.observe(node)
    window.addEventListener('resize', place)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor])
  const date = new Date(commit.date)
  const minutes = Math.round((date.getTime() - Date.now()) / 60000)
  const unit = Math.abs(minutes) < 60 ? 'minute' : Math.abs(minutes) < 1440 ? 'hour' : 'day'
  const relative = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(Math.round(minutes / (unit === 'minute' ? 1 : unit === 'hour' ? 60 : 1440)), unit)
  return <div ref={card} id="dvw-commit-hover" className="dvw-commit-hover" role="group" aria-label="提交信息"
    onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter} onBlur={onLeave}
    onKeyDown={event => { if (event.key === 'Escape') { anchor.focus(); onClose() } }}>
    <div><b>{commit.author}</b> · <time dateTime={commit.date}>{relative}（{date.toLocaleString('zh-CN')}）</time></div>
    <p>{commit.subject}</p>
    {stats && <div className="dvw-commit-stats">已更改 {stats.files} 个文件，<span>+{stats.added}</span>，<span>−{stats.removed}</span></div>}
    {commit.refs.length > 0 && <div className="dvw-hover-refs">{commit.refs.map(ref => <span className="dvw-ref" key={ref}>{ref}</span>)}</div>}
    <div className="dvw-hover-actions"><button onClick={onCopy} title="复制提交哈希"><Icon name="git-commit"/> {commit.hash.slice(0,7)} <Icon name="copy"/></button>
      {stats?.url && <a href={stats.url} target="_blank" rel="noreferrer">在 GitHub 上打开</a>}
    </div>
  </div>
}
