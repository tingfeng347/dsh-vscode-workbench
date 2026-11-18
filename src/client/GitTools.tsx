import { useEffect, useRef, useState } from 'react'
import type { GitBranch, GitCommit, GitCommitFile, GitConflictVersions, GitDiff, GitStash, GitStatus } from '../types.ts'
import { ApiError, api } from './api.ts'
import { Icon } from './Icon.tsx'

export type GitToolsSelection = { path?: string; commit?: string; view?: View }

interface GitToolsProps {
  open: boolean
  sessionId: string
  status: GitStatus
  selection: GitToolsSelection
  onClose(): void
  onRefresh(): Promise<void>
  onOpenFile(path: string): void
  onDiff(key: string, diff: GitDiff | undefined, title?: string, sourcePath?: string, preview?: { commit: string; path: string }): void
}

type View = 'compare' | 'history' | 'stash' | 'conflicts' | 'remote'
type Comparison = { from: string; to: string; files: GitCommitFile[] }

const VIEWS: [View, string][] = [
  ['history', '提交历史'], ['compare', '版本比较'], ['stash', 'Stash'], ['conflicts', '冲突'], ['remote', '同步与分支'],
]
const OPERATION_NAMES = { merge: '合并', rebase: '变基', 'cherry-pick': '拣选', revert: '撤销提交' }

export function GitTools({ open, sessionId, status, selection, onClose, onRefresh, onOpenFile, onDiff }: GitToolsProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState<View>(selection.view ?? (selection.path || selection.commit ? 'history' : status.operation || status.changes.some(change=>change.conflicted) ? 'conflicts' : 'compare'))
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  const [from, setFrom] = useState('HEAD')
  const [to, setTo] = useState(selection.commit ?? '')
  const [comparison, setComparison] = useState<Comparison>()
  const [historyPath, setHistoryPath] = useState(selection.path ?? '')
  const [filter, setFilter] = useState('')
  const [history, setHistory] = useState<GitCommit[]>([])
  const [commit, setCommit] = useState<GitCommit>()
  const [files, setFiles] = useState<GitCommitFile[]>([])
  const [blame, setBlame] = useState<string>()
  const [stashes, setStashes] = useState<GitStash[]>([])
  const [stashMessage, setStashMessage] = useState('')
  const [branch, setBranch] = useState('')
  const [refName, setRefName] = useState('')
  const [versions, setVersions] = useState<GitConflictVersions>()
  const [mergeResult, setMergeResult] = useState('')
  const conflicts = status.changes.filter(change=>change.conflicted)
  const operation = status.operation

  function request<T>(action: string, path?: string, value?: string): Promise<T> {
    return api<T>('git.action', { sessionId, action, path, value })
  }

  async function loadRefs() {
    try {
      setRefs(await request<string[]>('refs'))
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.code !== 'bad-action') throw cause
      const local = await request<GitBranch[]>('branch.list')
      setRefs(local.map(({name})=>`refs/heads/${name}`))
    }
  }

  async function work(task: ()=>Promise<void>) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try { await task() }
    catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'bad-action'
        ? '当前 DSH 宿主不支持此 Git 操作。请重启 DSH 以加载新版工作台。'
        : cause instanceof Error ? cause.message : String(cause))
    }
    finally { running.current = false; setBusy(false) }
  }

  async function mutate(action: string, path?: string, value?: string) {
    await work(async()=>{
      try {
        await request(action, path, value)
      } finally {
        await onRefresh()
        window.dispatchEvent(new Event('dvw-files-changed'))
      }
      if (action.startsWith('branch.') || action.startsWith('tag.')) {
        await loadRefs()
        setBranch('')
        setRefName('')
      }
      if (action.startsWith('stash.')) setStashes(await request<GitStash[]>('stash.list'))
    })
  }

  async function loadHistory(path: string) {
    const rows = await request<GitCommit[]>(path ? 'file.history' : 'log.all', path || undefined)
    setHistory(rows)
    setCommit(undefined)
    setFiles([])
    setBlame(undefined)
  }

  async function showCommit(item: GitCommit) {
    setFiles(await request<GitCommitFile[]>('commit.files', undefined, item.hash))
    setCommit(item)
    setBlame(undefined)
  }

  async function compare(before: string, after: string) {
    const versions = await Promise.all([before, after].map((ref,index)=>index===1&&ref===':worktree:'?ref:request<string>('ref.resolve', undefined, ref)))
    const pair = JSON.stringify(versions)
    const files = await request<GitCommitFile[]>('compare.files', undefined, pair)
    setFrom(before)
    setTo(after)
    setComparison({ from: versions[0]!, to: versions[1]!, files })
    setView('compare')
  }

  async function showDiff(action: string, path: string, value: string, key: string, title?: string) {
    const diff = await request<GitDiff>(action, path, value)
    onDiff(`commit:${key}:${path}`, diff, title ?? path.split('/').at(-1), path, action === 'commit.file.diff' ? { commit: key, path } : undefined)
    onClose()
  }

  useEffect(()=>{
    const element = dialog.current
    if (open && element && !element.open) element.showModal()
    return ()=>element?.close()
  }, [open])

  useEffect(()=>{
    if (!open) return
    void work(async()=>{
      if (view === 'compare' || view === 'remote') await loadRefs()
      if (view === 'stash') setStashes(await request<GitStash[]>('stash.list'))
      if (view === 'history' && history.length === 0) {
        await loadHistory(historyPath)
        if (selection.commit) {
          const item = (await request<GitCommit[]>('commit.details', undefined, selection.commit))[0]
          if (item) await showCommit(item)
        }
      }
    })
  }, [view, open])

  const visibleHistory = history.filter(item=>`${item.hash} ${item.subject} ${item.author} ${item.refs.join(' ')}`.toLowerCase().includes(filter.toLowerCase()))
  const renderFiles = (rows: GitCommitFile[], onClick: (file: GitCommitFile)=>void) => rows.length === 0
    ? <p>没有文件差异。</p>
    : <ul className="dvw-git-tool-list">{rows.map(file=><li key={file.path}><button disabled={busy} onClick={()=>onClick(file)}><b>{file.status}</b> {file.previousPath ? `${file.previousPath} → ` : ''}{file.path}</button></li>)}</ul>

  return <dialog className="dvw-git-tools" ref={dialog} aria-label="Git 工具" onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
    <header><h2>Git 工具</h2><button className="dvw-icon" aria-label="关闭 Git 工具" disabled={busy} onClick={onClose}><Icon name="close"/></button></header>
    <nav aria-label="Git 工具视图">{VIEWS.map(([id, label])=><button key={id} aria-pressed={view===id} disabled={busy} onClick={()=>setView(id)}>{label}</button>)}</nav>
    <div className="dvw-git-tool-body">
      {busy&&<p role="status">正在执行 Git 操作…</p>}
      {error&&<pre role="alert" className="dvw-git-tool-error">{error}</pre>}
      {view==='compare'&&<>
        <form onSubmit={event=>{event.preventDefault();void work(()=>compare(from.trim(),to.trim()))}}>
          <label>原版本<input className="dvw-input" value={from} required list="dvw-git-refs" onChange={event=>setFrom(event.target.value)}/></label>
          <label>对比版本<input className="dvw-input" value={to} required list="dvw-git-refs" onChange={event=>setTo(event.target.value)}/></label>
          <datalist id="dvw-git-refs">{refs.map(ref=><option key={ref} value={ref}/>)}</datalist>
          <button disabled={busy||!from.trim()||!to.trim()}>比较</button>
          <button type="button" disabled={busy||!from.trim()} onClick={()=>void work(()=>compare(from.trim(),':worktree:'))}>与工作区比较</button>
        </form>
        {comparison&&<>
          <p><code>{comparison.from.slice(0, 12)}</code> → <code>{comparison.to===':worktree:'?'工作区（已跟踪）':comparison.to.slice(0, 12)}</code></p>
          {renderFiles(comparison.files,file=>void work(()=>showDiff('compare.diff',file.path,JSON.stringify([comparison.from,comparison.to]),`${comparison.from}:${comparison.to}`)))}
        </>}
      </>}
      {view==='history'&&<>
        <form onSubmit={event=>{event.preventDefault();void work(()=>loadHistory(historyPath.trim()))}}>
          <label>文件路径<input className="dvw-input" value={historyPath} placeholder="留空查看所有引用" onChange={event=>setHistoryPath(event.target.value)}/></label>
          <button disabled={busy}>加载历史</button>
          <button type="button" disabled={busy||!historyPath.trim()} onClick={()=>void work(async()=>setBlame(await request<string>('file.blame',historyPath.trim())))}>逐行归属</button>
        </form>
        {blame!==undefined?<pre className="dvw-git-blame">{blame}</pre>:<div className="dvw-git-history">
          <section>
            <input className="dvw-input" aria-label="筛选提交" value={filter} placeholder="筛选消息、作者、引用或哈希" onChange={event=>setFilter(event.target.value)}/>
            <ul className="dvw-git-tool-list">{visibleHistory.map(item=><li key={item.hash}><button aria-pressed={commit?.hash===item.hash} disabled={busy} onClick={()=>void work(()=>showCommit(item))}><strong>{item.subject}</strong><small>{item.hash.slice(0,8)} · {item.author} · {item.date.slice(0,10)} {item.refs.join(', ')}</small></button></li>)}</ul>
            {!busy&&visibleHistory.length===0&&<p>没有匹配的提交。</p>}
          </section>
          {commit&&<section>
            <h3>{commit.subject}</h3>
            <p>{commit.author} · <code>{commit.hash}</code></p>
            <div className="dvw-git-tool-actions">
              <button disabled={busy} onClick={()=>{setFrom(commit.hash);setTo('HEAD');setView('compare')}}>与 HEAD 比较</button>
              <button disabled={busy} onClick={()=>void mutate('cherry-pick',undefined,commit.hash)}>拣选</button>
              <button disabled={busy} onClick={()=>void mutate('revert',undefined,commit.hash)}>撤销此提交</button>
            </div>
            {renderFiles(files,file=>void work(()=>showDiff('commit.file.diff',file.path,commit.hash,commit.hash)))}
          </section>}
        </div>}
      </>}
      {view==='stash'&&<>
        <form onSubmit={event=>{event.preventDefault();void mutate('stash.push',undefined,stashMessage)}}>
          <label>备注<input className="dvw-input" value={stashMessage} onChange={event=>setStashMessage(event.target.value)}/></label>
          <button disabled={busy||!status.changes.length}>保存工作区与未跟踪文件</button>
        </form>
        {!busy&&!stashes.length&&<p>没有 Stash。</p>}
        <ul className="dvw-git-tool-list">{stashes.map(stash=><li className="dvw-git-stash" key={stash.ref}>
          <div><strong>{stash.ref}</strong> {stash.subject}</div>
          <div className="dvw-git-tool-actions">
            <button disabled={busy} onClick={()=>void work(()=>compare(`${stash.hash}^1`,stash.hash))}>比较已跟踪改动</button>
            <button disabled={busy} onClick={()=>void mutate('stash.apply',undefined,JSON.stringify([stash.ref,stash.hash]))}>应用并保留</button>
            <button disabled={busy} onClick={()=>{if(confirm(`删除 ${stash.ref}？`))void mutate('stash.drop',undefined,JSON.stringify([stash.ref,stash.hash]))}}>删除</button>
          </div>
        </li>)}</ul>
      </>}
      {view==='conflicts'&&<>
        {operation&&<div className="dvw-git-tool-actions">
          <strong>{OPERATION_NAMES[operation]}中</strong>
          <button disabled={busy||conflicts.length>0} onClick={()=>void mutate('operation.continue',undefined,operation)}>继续</button>
          <button disabled={busy} onClick={()=>{if(confirm(`中止${OPERATION_NAMES[operation]}？`))void mutate('operation.abort',undefined,operation)}}>中止</button>
        </div>}
        {!conflicts.length&&<p>没有未解决的文件。</p>}
        <ul className="dvw-git-tool-list">{conflicts.map(change=><li className="dvw-git-stash" key={change.path}>
          <strong>{change.path}</strong>
          <div className="dvw-git-tool-actions">
            <button disabled={busy} onClick={()=>void work(async()=>{
              const versions = await request<GitConflictVersions>('conflict.versions',change.path)
              setVersions(versions)
              setMergeResult(versions.document?.content??'')
            })}>查看三方版本</button>
            <button disabled={busy} onClick={()=>void work(()=>showDiff('conflict.diff',change.path,'','conflict','冲突 · '+change.path))}>比较阶段 2 / 3</button>
            <button disabled={busy} onClick={()=>{onOpenFile(change.path);onClose()}}>打开文件手动编辑</button>
            <button disabled={busy} onClick={()=>{if(confirm(`使用阶段 2 覆盖并暂存 ${change.path}？`))void mutate('conflict.ours',change.path)}}>采纳阶段 2</button>
            <button disabled={busy} onClick={()=>{if(confirm(`使用阶段 3 覆盖并暂存 ${change.path}？`))void mutate('conflict.theirs',change.path)}}>采纳阶段 3</button>
          </div>
        </li>)}</ul>
        {versions&&conflicts.some(change=>change.path===versions.path)&&<section className="dvw-git-merge">
          <h3>{versions.path}</h3>
          {versions.document?<form onSubmit={event=>{
            event.preventDefault()
            void mutate('conflict.save',versions.path,JSON.stringify([versions.revision,versions.document!.revision,mergeResult]))
          }}>
            <div className="dvw-git-merge-sources">{([
              ['共同基线',versions.base],['阶段 2',versions.ours],['阶段 3',versions.theirs],
            ] as const).map(([label,text])=><section key={label}>
              <strong>{label}</strong>
              {text===undefined?<p>无可显示的文本</p>:<>
                <pre tabIndex={0}>{text}</pre>
                <button type="button" disabled={busy} onClick={()=>setMergeResult(text)}>用作合并结果</button>
              </>}
            </section>)}</div>
            <label>合并结果<textarea className="dvw-input" value={mergeResult} rows={10} spellCheck={false} onChange={event=>setMergeResult(event.target.value)}/></label>
            <button disabled={busy}>保存并暂存合并结果</button>
          </form>:<p>该冲突没有可编辑的工作区文本，可采纳阶段 2 或阶段 3。</p>}
        </section>}
      </>}
      {view==='remote'&&<>
        <div className="dvw-git-tool-actions">
          <button disabled={busy} onClick={()=>void mutate('fetch')}>获取远端更新</button>
          <button disabled={busy} onClick={()=>void mutate('pull')}>拉取（仅快进）</button>
          <button disabled={busy} onClick={()=>void mutate('push')}>推送</button>
        </div>
        <div className="dvw-git-tool-actions">
          <label>目标引用<select className="dvw-input" value={branch} onChange={event=>setBranch(event.target.value)}><option value="">选择引用</option>{refs.map(ref=><option key={ref}>{ref}</option>)}</select></label>
          <button disabled={busy||!branch||!!operation} onClick={()=>void mutate('merge',undefined,branch)}>合并到当前分支</button>
          <button disabled={busy||!branch||!!operation} onClick={()=>{if(confirm(`将当前分支变基到 ${branch}？`))void mutate('rebase',undefined,branch)}}>变基到目标</button>
        </div>
        <div className="dvw-git-tool-actions">
          <label>分支或标签名称<input className="dvw-input" value={refName} onChange={event=>setRefName(event.target.value)}/></label>
          <button disabled={busy||!refName.trim()} onClick={()=>void mutate('branch.create',undefined,refName.trim())}>创建并切换分支</button>
          <button disabled={busy||!refName.trim()||!branch.startsWith('refs/heads/')} onClick={()=>void mutate('branch.rename',undefined,JSON.stringify([branch.slice(11),refName.trim()]))}>重命名目标分支</button>
          <button disabled={busy||!refName.trim()} onClick={()=>void mutate('tag.create',branch||undefined,refName.trim())}>创建标签</button>
          {branch.startsWith('refs/heads/')&&<button disabled={busy} onClick={()=>{if(confirm(`删除已合并分支 ${branch.slice(11)}？`))void mutate('branch.delete',undefined,branch.slice(11))}}>删除已合并分支</button>}
          {branch.startsWith('refs/tags/')&&<button disabled={busy} onClick={()=>{if(confirm(`删除本地标签 ${branch.slice(10)}？`))void mutate('tag.delete',undefined,branch.slice(10))}}>删除本地标签</button>}
        </div>
      </>}
    </div>
  </dialog>
}
