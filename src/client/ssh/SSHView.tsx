import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FileEntry, GitDiff, GitStatus, SearchMatch, SearchReplaceResult, SshConnection, SshHost } from '../../shared/types.ts'
import { ApiError, api, waitForDelay } from '../transport/api.ts'
import { FileIcon } from '../workspace/FileIcon.tsx'
import { RemoteTree } from './SSHRemoteTree.tsx'
import { Icon } from '../ui/Icon.tsx'
import { PanelResizer } from '../workbench/PanelResizer.tsx'
import { errorText, fileParts, forgetSshHost, sshDisconnected, readSshHistory, rememberSshHost, remoteFileUri, type SshConnectRequest, type SshHistoryEntry } from './ssh.ts'

interface Props {
  sessionId: string
  visible: boolean
  chatConnectionId?: string
  isDirty(path: string): boolean
  onOpenSource?(path: string): void
  onOpen(path: string, line?: number, column?: number, match?: string): void
  onAddToDsh?(connection: SshConnection, entry: FileEntry): void
  onDiff(key: string, diff: GitDiff, title: string, sourcePath: string): void
  onChanged(paths: string[]): void
  onTerminal(connection: SshConnection, options?: { open?: boolean }): void
}

interface HostForm {
  authMethod: 'password' | 'key'
  savePassword: boolean
  host: string
  user: string
  password: string
  port: string
  identityFile: string
  workspace: string
  label: string
}

const EMPTY_FORM: HostForm = { authMethod: 'key', savePassword: true, host: '', user: '', password: '', port: '', identityFile: '', workspace: '.', label: '' }
const SSH_TARGETS_FRACTION_KEY = 'dvw:ssh-targets-fraction-v2'
type RemotePanel = 'files' | 'search' | 'git'

function readTargetsFraction(): number {
  try {
    const raw = localStorage.getItem(SSH_TARGETS_FRACTION_KEY)
    const stored = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(stored) ? Math.max(0.12, Math.min(0.72, stored)) : 0.36
  } catch {
    return 0.36
  }
}

function transientSshClose(error: unknown): boolean {
  return /connection closed by .+ port \d+|connection reset by peer|broken pipe/i.test(errorText(error))
}

function Toggle({ pressed, label, icon, onClick }: { pressed: boolean; label: string; icon: 'case-sensitive' | 'whole-word' | 'regex'; onClick(): void }) {
  return <button type="button" className="dvw-icon" title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}><Icon name={icon}/></button>
}

function RemoteSearch({ sessionId, connection, isDirty, onOpen, onChanged, onDisconnected }: Pick<Props, 'sessionId' | 'isDirty' | 'onOpen' | 'onChanged'> & { connection: SshConnection; onDisconnected(): void }) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [limited, setLimited] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (query.trim() === '') return
    setBusy(true)
    setStatus('正在搜索…')
    try {
      const result = await api<{ matches: SearchMatch[]; limited: boolean }>('ssh.search', {
        sessionId, connectionId: connection.id, query, caseSensitive, wholeWord, regex,
      })
      setMatches(result.matches)
      setLimited(result.limited)
      setStatus(result.matches.length === 0 ? '没有匹配' : `${result.matches.length} 处匹配${result.limited ? '（已限制）' : ''}`)
    } catch (error) {
      setMatches([])
      setLimited(false)
      if (sshDisconnected(error)) onDisconnected()
      else setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const replaceAll = async () => {
    if (matches.length === 0 || limited) return
    const dirty = [...new Set(matches.map(row => row.path))].filter(path => isDirty(remoteFileUri(connection.id, path)))
    if (dirty.length > 0) {
      setStatus(`请先保存：${dirty.join('、')}`)
      return
    }
    const byPath = new Map<string, SearchMatch[]>()
    for (const match of matches) {
      const rows = byPath.get(match.path)
      if (rows === undefined) byPath.set(match.path, [match])
      else rows.push(match)
    }
    setBusy(true)
    setStatus('正在替换…')
    try {
      const result = await api<SearchReplaceResult>('ssh.search.replace', {
        sessionId,
        connectionId: connection.id,
        files: [...byPath].map(([path, rows]) => ({
          path,
          edits: rows.map(row => ({
            line: row.line,
            column: row.column,
            length: row.match.length,
            lineHash: row.lineHash,
            text: replacement.replace(/\$0/g, row.match),
          })),
        })),
      })
      setStatus([`已替换 ${result.changed.length} 个远程文件`, ...result.failures.map(failure => `${failure.path}：${failure.message}`)].join('\n'))
      onChanged(result.changed.map(path => remoteFileUri(connection.id, path)))
      setMatches([])
    } catch (error) {
      if (sshDisconnected(error)) onDisconnected()
      else setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>()
    for (const match of matches) {
      const rows = map.get(match.path)
      if (rows === undefined) map.set(match.path, [match])
      else rows.push(match)
    }
    return map
  }, [matches])

  return <section className="dvw-ssh-section dvw-ssh-search-panel">
    <form className="dvw-ssh-search" onSubmit={event => { event.preventDefault(); void run() }}>
      <div className="dvw-search-box">
        <input
          aria-label="远程搜索"
          placeholder="在工作区中搜索"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            void run()
          }}
        />
        <Toggle pressed={caseSensitive} label="区分大小写" icon="case-sensitive" onClick={() => setCaseSensitive(value => !value)}/>
        <Toggle pressed={wholeWord} label="全字匹配" icon="whole-word" onClick={() => setWholeWord(value => !value)}/>
        <Toggle pressed={regex} label="正则表达式" icon="regex" onClick={() => setRegex(value => !value)}/>
        <button type="submit" className="dvw-icon" title="搜索远程文件" aria-label="搜索远程文件" disabled={busy || query.trim() === ''}><Icon name="search"/></button>
      </div>
      <div className="dvw-search-box">
        <input aria-label="远程替换" placeholder="替换（$0 表示匹配）" value={replacement} onChange={event => setReplacement(event.target.value)}/>
        <button type="button" className="dvw-icon" title="全部替换" disabled={busy || matches.length === 0 || limited} onClick={() => void replaceAll()}><Icon name="replace-all"/></button>
      </div>
      <div className="dvw-ssh-search-status" role="status">{status}</div>
    </form>
    <div className="dvw-ssh-results">
      {[...grouped].map(([path, rows]) => <details key={path} open>
        <summary title={path}>{fileParts(path).name}<span>{fileParts(path).directory}</span><b>{rows.length}</b></summary>
        {rows.map(row => <button className="dvw-ssh-result" key={`${row.line}:${row.column}`} title={`${path}:${row.line}:${row.column}`} onClick={() => onOpen(remoteFileUri(connection.id, path), row.line, row.column, row.match)}>
          <span>{row.line}</span>{row.preview}
        </button>)}
      </details>)}
    </div>
  </section>
}

function RemoteGit({ sessionId, connection, onDiff, onDisconnected }: { sessionId: string; connection: SshConnection; onDiff: Props['onDiff']; onDisconnected(): void }) {
  const [status, setStatus] = useState<GitStatus>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    try {
      setStatus(await api<GitStatus>('ssh.git', { sessionId, connectionId: connection.id, action: 'status' }))
      setError(undefined)
    } catch (cause) {
      setStatus(undefined)
      if (sshDisconnected(cause)) onDisconnected()
      else setError(errorText(cause))
    }
  }
  useEffect(() => { void refresh() }, [connection.id, sessionId])
  const action = async (name: string, path?: string, value?: string) => {
    setBusy(true)
    setError(undefined)
    try {
      const updated = await api<GitStatus>('ssh.git', { sessionId, connectionId: connection.id, action: name, path, value })
      setStatus(updated)
      if (name === 'commit') setMessage('')
      window.dispatchEvent(new CustomEvent('dvw-files-changed', { detail: [remoteFileUri(connection.id, '').slice(0, -1)] }))
    } catch (cause) {
      if (sshDisconnected(cause)) onDisconnected()
      else setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  const openDiff = async (path: string, mode: 'staged' | 'worktree' | 'untracked') => {
    try {
      const diff = await api<GitDiff>('ssh.git', { sessionId, connectionId: connection.id, action: 'diff', path, value: mode })
      onDiff(`ssh-diff:${connection.id}:${mode}:${path}`, diff, fileParts(path).name, remoteFileUri(connection.id, path))
    } catch (cause) {
      if (sshDisconnected(cause)) onDisconnected()
      else setError(errorText(cause))
    }
  }
  const staged = status?.changes.filter(change => !change.conflicted && change.index !== '.' && change.index !== '?') ?? []
  const changed = status?.changes.filter(change => !change.conflicted && (change.worktree !== '.' || change.untracked)) ?? []
  const canCommit = !busy && message.trim() !== '' && staged.length > 0
  const commit = () => {
    if (canCommit) void action('commit', undefined, message.trim())
  }
  return <section className="dvw-ssh-section dvw-ssh-git-panel">
    <div className="dvw-ssh-panel-toolbar">
      <span>{status ? <><Icon name="git-branch"/>{status.branch}<small>↓{status.behind} ↑{status.ahead}</small></> : '源代码管理'}</span>
      <button className="dvw-icon" title="刷新远程 Git" onClick={() => void refresh()}><Icon name="refresh"/></button>
    </div>
    {error && <div className="dvw-ssh-git-error">{error}</div>}
    {status && <>
      <form className="dvw-ssh-commit" onSubmit={event => { event.preventDefault(); commit() }}>
        <textarea className="dvw-textarea" rows={2} placeholder={`在 ${status.branch} 上提交暂存文件…`} value={message} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); commit() } }}/>
        <div><button type="button" className="dvw-icon" title="刷新" onClick={() => void refresh()}><Icon name="refresh"/></button><button type="button" className="dvw-icon" title="抓取远端" disabled={busy} onClick={() => void action('fetch')}><Icon name="cloud-upload"/></button><button className="dvw-ssh-primary" disabled={!canCommit}>提交</button></div>
      </form>
      <div className="dvw-ssh-git-group">
        <strong>暂存的更改 <button className="dvw-icon" title="全部取消暂存" disabled={busy || staged.length === 0} onClick={() => void action('unstage.all')}><Icon name="remove"/></button><span>{staged.length}</span></strong>
        {staged.map(change => <div className="dvw-ssh-git-row" key={`staged:${change.path}`} onClick={() => void openDiff(change.path, 'staged')}>
          <FileIcon name={fileParts(change.path).name}/><span title={change.path}>{change.path}</span><button className="dvw-icon" title="取消暂存" disabled={busy} onClick={event => { event.stopPropagation(); void action('unstage', change.path) }}><Icon name="remove"/></button>
        </div>)}
      </div>
      <div className="dvw-ssh-git-group">
        <strong>更改 <button className="dvw-icon" title="全部暂存" disabled={busy || changed.length === 0} onClick={() => void action('stage.all')}><Icon name="add"/></button><span>{changed.length}</span></strong>
        {changed.map(change => <div className="dvw-ssh-git-row" key={`worktree:${change.path}`} onClick={() => void openDiff(change.path, change.untracked ? 'untracked' : 'worktree')}>
          <FileIcon name={fileParts(change.path).name}/><span title={change.path}>{change.path}</span><button className="dvw-icon" title="暂存" disabled={busy} onClick={event => { event.stopPropagation(); void action('stage', change.path) }}><Icon name="add"/></button>
        </div>)}
      </div>
    </>}
    {error?.startsWith('当前远程工作区不在 Git 仓库中') && <button className="dvw-ssh-secondary" onClick={() => void refresh()}>重试 Git 状态</button>}
  </section>
}

function RemoteWorkspacePicker({ sessionId, connection, onClose, onSelect }: {
  sessionId: string
  connection: SshConnection
  onClose(): void
  onSelect(connection: SshConnection): void
}) {
  const [path, setPath] = useState('')
  const [rows, setRows] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)
  const currentPath = path === '' ? connection.root : `${connection.root.replace(/\/$/, '')}/${path}`

  useEffect(() => {
    const request = new AbortController()
    setLoading(true)
    setRows([])
    setError(undefined)
    void api<FileEntry[]>('ssh.list', { sessionId, connectionId: connection.id, path }, request.signal)
      .then(entries => {
        if (!request.signal.aborted) setRows(entries.filter(entry => entry.kind === 'directory'))
      })
      .catch(cause => {
        if (!request.signal.aborted) setError(errorText(cause))
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false)
      })
    return () => request.abort()
  }, [connection.id, path, revision, sessionId])

  const select = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const selected = await api<SshConnection>('ssh.workspace', { sessionId, connectionId: connection.id, path: currentPath })
      onSelect(selected)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return <div className="dvw-ssh-quickpick-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="dvw-ssh-quickpick dvw-ssh-workspace-picker" role="dialog" aria-modal="true" aria-label="选择远程工作区" onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose() }}>
      <div className="dvw-ssh-quickpick-head"><strong>选择远程工作区</strong><button type="button" className="dvw-icon" title="关闭" disabled={busy} onClick={onClose}><Icon name="close"/></button></div>
      <div className="dvw-ssh-quickpick-body">
        <div className="dvw-ssh-workspace-location">
          <button type="button" className="dvw-icon" title="上一级" aria-label="上一级" disabled={path === '' || loading} onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}><Icon name="chevron-up"/></button>
          <Icon name="folder-opened"/>
          <code title={currentPath}>{currentPath}</code>
          <button type="button" className="dvw-icon" title="刷新目录" aria-label="刷新目录" disabled={loading} onClick={() => setRevision(value => value + 1)}><Icon name="refresh"/></button>
        </div>
        <div className="dvw-ssh-workspace-note">文件、搜索、Git 和终端会以这个目录为工作区。</div>
        {error && <div className="dvw-error">{error}</div>}
        <div className="dvw-ssh-workspace-folders" role="list" aria-label="工作区文件夹">
          {loading && <div className="dvw-ssh-empty">正在读取目录…</div>}
          {!loading && rows.map(entry => <button type="button" key={entry.path} onClick={() => setPath(entry.path)}><Icon name="folder"/><span>{entry.name}</span><Icon name="chevron-right"/></button>)}
          {!loading && rows.length === 0 && !error && <div className="dvw-ssh-empty">此目录下没有子文件夹</div>}
        </div>
      </div>
      <div className="dvw-ssh-quickpick-actions">
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="dvw-ssh-primary" disabled={busy || loading} onClick={() => void select()}><Icon name={busy ? 'refresh' : 'folder-opened'}/>{busy ? '正在切换…' : '选择此文件夹'}</button>
      </div>
    </section>
  </div>
}

interface SshTarget {
  passwordSaved?: boolean
  authMethod?: SshHistoryEntry['authMethod']
  key: string
  host: string
  label: string
  hostName: string
  user?: string
  port?: number
  identityFile?: string
  workspace: string
  fromHistory: boolean
}

function parseRemoteAddress(value: string): Pick<HostForm, 'host' | 'user' | 'port'> {
  let host = value.trim()
  let user = ''
  const at = host.lastIndexOf('@')
  if (at >= 0) {
    user = host.slice(0, at)
    host = host.slice(at + 1)
  }
  let port = ''
  const portMatch = host.match(/:(\d+)$/)
  if (portMatch !== null) {
    port = portMatch[1] ?? ''
    host = host.slice(0, -portMatch[0].length)
  }
  return { host, user, port }
}

function ConnectionFailureDialog({ host, detail, retrying, onRetry, onClose }: {
  host: string
  detail: string
  retrying: boolean
  onRetry(): void
  onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])

  return <dialog
    ref={dialog}
    className="dvw-ssh-connection-dialog"
    aria-label="SSH 连接失败"
    onCancel={event => {
      event.preventDefault()
      if (!retrying) onClose()
    }}
  >
    <div className="dvw-ssh-quickpick">
      <div className="dvw-ssh-quickpick-head"><strong>SSH 连接失败</strong></div>
      <div className="dvw-ssh-quickpick-body">
        <p className="dvw-ssh-connection-message">无法连接到「{host}」。</p>
        <details className="dvw-ssh-quickpick-options">
          <summary>连接详情</summary>
          <pre className="dvw-ssh-connection-detail">{detail}</pre>
        </details>
      </div>
      <div className="dvw-ssh-quickpick-actions">
        <button type="button" disabled={retrying} onClick={onClose}>关闭</button>
        <button type="button" className="dvw-ssh-primary" disabled={retrying} onClick={onRetry}>
          {retrying ? '正在连接…' : '重试'}
        </button>
      </div>
    </div>
  </dialog>
}

export function SSHView({ sessionId, visible, chatConnectionId, isDirty, onOpen, onOpenSource, onAddToDsh, onDiff, onChanged, onTerminal }: Props) {
  const [hosts, setHosts] = useState<SshHost[]>([])
  const [history, setHistory] = useState<SshHistoryEntry[]>(readSshHistory)
  const [passwordPrompt, setPasswordPrompt] = useState<string>()
  const [form, setForm] = useState<HostForm>(EMPTY_FORM)
  const [connection, setConnection] = useState<SshConnection>()
  const [newRemoteOpen, setNewRemoteOpen] = useState(false)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [targetsCollapsed, setTargetsCollapsed] = useState(false)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true)
  const [workspacePanel, setWorkspacePanel] = useState<RemotePanel>('files')
  const showingFiles = workspacePanel === 'files'
  const [targetsFraction, setTargetsFraction] = useState(readTargetsFraction)
  const [sshHeight, setSshHeight] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [connectionFailure, setConnectionFailure] = useState<{ request: SshConnectRequest; detail: string; authMethod?: HostForm['authMethod']; promptTarget?: SshTarget }>()
  const activeConnectionId = useRef(connection?.id)
  activeConnectionId.current = connection?.id
  const formRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const refreshHosts = () => {
    void api<{ hosts: SshHost[] }>('ssh.hosts', { sessionId })
      .then(result => setHosts(result.hosts))
      .catch(cause => setError(errorText(cause)))
  }

  useEffect(() => {
    if (!visible) return
    const request = new AbortController()
    refreshHosts()
    void api<SshConnection[]>('ssh.connections', { sessionId }, request.signal)
      .then(connections => {
        if (!request.signal.aborted) setConnection(current => current ?? connections[0])
      })
      .catch(cause => {
        if (!request.signal.aborted) setError(errorText(cause))
      })
    return () => request.abort()
  }, [visible, sessionId])

  useEffect(() => {
    if (newRemoteOpen && connectionFailure === undefined) requestAnimationFrame(() => formRef.current?.focus())
  }, [connectionFailure, newRemoteOpen])

  useEffect(() => {
    const node = rootRef.current
    if (node === null) return
    const measure = () => setSshHeight(node.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    try {
      localStorage.setItem(SSH_TARGETS_FRACTION_KEY, String(targetsFraction))
    } catch {
      // Browser privacy settings may deny storage.
    }
  }, [targetsFraction])

  const targets = useMemo<SshTarget[]>(() => {
    const result = new Map<string, SshTarget>()
    for (const host of hosts) {
      result.set(`config:${host.alias}`, {
        key: `config:${host.alias}`,
        host: host.alias,
        label: host.alias,
        hostName: host.hostName,
        ...(host.user === undefined ? {} : { user: host.user }),
        ...(host.port === undefined ? {} : { port: host.port }),
        ...(host.identityFile === undefined ? {} : { identityFile: host.identityFile }),
        workspace: '.',
        fromHistory: false,
      })
    }
    for (const entry of history.slice(0, 8)) {
      const configured = [...result.values()].find(target => target.host === entry.host || target.label === entry.host)
      if (configured !== undefined) {
        if (configured.fromHistory) continue
        configured.workspace = entry.workspace ?? configured.workspace
        if (entry.user !== undefined) configured.user = entry.user
        if (entry.port !== undefined) configured.port = entry.port
        if (entry.identityFile !== undefined) configured.identityFile = entry.identityFile
        if (entry.authMethod !== undefined) configured.authMethod = entry.authMethod
        if (entry.passwordSaved !== undefined) configured.passwordSaved = entry.passwordSaved
        configured.fromHistory = true
        continue
      }
      const key = `history:${entry.host}:${entry.user ?? ''}:${entry.workspace ?? ''}`
      result.set(key, {
        key,
        host: entry.host,
        label: entry.label,
        ...(entry.passwordSaved === undefined ? {} : { passwordSaved: entry.passwordSaved }),
        ...(entry.authMethod === undefined ? {} : { authMethod: entry.authMethod }),
        hostName: entry.host,
        ...(entry.user === undefined ? {} : { user: entry.user }),
        ...(entry.port === undefined ? {} : { port: entry.port }),
        ...(entry.identityFile === undefined ? {} : { identityFile: entry.identityFile }),
        workspace: entry.workspace ?? '.',
        fromHistory: true,
      })
    }
    return [...result.values()]
  }, [history, hosts])

  const requestFromTarget = (target: SshTarget): SshConnectRequest => ({
    host: target.host,
    ...(target.user === undefined || target.user === '' ? {} : { user: target.user }),
    ...(target.port === undefined ? {} : { port: target.port }),
    ...(target.identityFile === undefined || target.identityFile === '' ? {} : { identityFile: target.identityFile }),
    workspace: target.workspace || '.',
    label: target.label,
  })

  const openConnection = async (request: SshConnectRequest, authMethod?: HostForm['authMethod'], promptTarget?: SshTarget) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      const connect = () => api<SshConnection>('ssh.connect', { sessionId, ...request })
      let opened: SshConnection
      try {
        opened = await connect()
      } catch (cause) {
        if (!transientSshClose(cause)) throw cause
        await waitForDelay(2000)
        opened = await connect()
      }
      setConnectionFailure(undefined)
      setConnection(opened)
      window.dispatchEvent(new Event('dvw-ssh-connections-changed'))
      setHistory(rememberSshHost({
        ...request,
        ...(opened.identityFile === undefined ? {} : { identityFile: opened.identityFile }),
      }, opened.label, authMethod, opened.passwordSaved))
      setForm(current => ({ ...current, password: '' }))
      setNewRemoteOpen(false)
      setError(request.savePassword && !opened.passwordSaved ? 'SSH 已连接，但系统未能保存密码。' : undefined)
      onTerminal(opened)
    } catch (cause) {
      if (promptTarget && cause instanceof ApiError && ['ssh-password-unavailable', 'ssh-auth'].includes(cause.code)) {
        setConnectionFailure(undefined)
        editTarget(promptTarget)
        setPasswordPrompt('已保存的密码不可用，请重新输入。')
        return
      }
      const detail = errorText(cause)
      setConnectionFailure({ request, ...(authMethod === undefined ? {} : { authMethod }), ...(promptTarget === undefined ? {} : { promptTarget }), detail: request.password ? detail.split(request.password).join('•••') : detail })
    } finally {
      setBusy(false)
    }
  }

  const connectTarget = async (target: SshTarget) => {
    if (busy || (connection !== undefined && connection.host === target.host)) return
    if (target.authMethod === 'password') {
      if (target.passwordSaved) {
        const { identityFile: _identityFile, ...request } = requestFromTarget(target)
        await openConnection({ ...request, useSavedPassword: true }, 'password', target)
      } else {
        editTarget(target)
      }
      return
    }
    if (connection !== undefined && connection.id !== chatConnectionId) {
      try {
        await api('ssh.disconnect', { sessionId, connectionId: connection.id })
        setConnection(undefined)
        window.dispatchEvent(new Event('dvw-ssh-connections-changed'))
      } catch (cause) {
        setError(errorText(cause))
        return
      }
    }
    await openConnection(requestFromTarget(target))
  }

  const connectForm = async () => {
    const parsed = parseRemoteAddress(form.host)
    if (parsed.host === '') {
      setError('请输入 SSH 主机或 ~/.ssh/config 中的别名')
      formRef.current?.focus()
      return
    }
    const request: SshConnectRequest = {
      host: parsed.host,
      ...(form.user.trim() === '' && parsed.user === '' ? {} : { user: form.user.trim() || parsed.user }),
      ...(form.authMethod === 'password' ? { password: form.password, savePassword: form.savePassword } : {}),
      ...(form.port.trim() === '' && parsed.port === '' ? {} : { port: Number(form.port || parsed.port) }),
      ...(form.authMethod === 'key' && form.identityFile.trim() !== '' ? { identityFile: form.identityFile.trim() } : {}),
      workspace: form.workspace.trim() || '.',
      ...(form.label.trim() === '' ? {} : { label: form.label.trim() }),
    }
    await openConnection(request, form.authMethod)
  }

  const editTarget = (target: SshTarget) => {
    setPasswordPrompt(undefined)
    setForm({
      authMethod: target.authMethod ?? 'key',
      savePassword: true,
      host: target.host,
      user: target.user ?? '',
      password: '',
      port: target.port === undefined ? '' : String(target.port),
      identityFile: target.identityFile ?? '',
      workspace: target.workspace || '.',
      label: target.label,
    })
    setNewRemoteOpen(true)
  }

  const disconnect = async () => {
    if (connection === undefined) return
    setBusy(true)
    try {
      await api('ssh.disconnect', { sessionId, connectionId: connection.id })
      setConnection(undefined)
      window.dispatchEvent(new Event('dvw-ssh-connections-changed'))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  const connectionLost = useCallback((connectionId: string) => {
    if (activeConnectionId.current !== connectionId) return
    setConnection(undefined)
    window.dispatchEvent(new Event('dvw-ssh-connections-changed'))
    setError('SSH 连接已断开，请重新连接。')
  }, [])
  const changeWorkspace = (selected: SshConnection) => {
    setConnection(selected)
    window.dispatchEvent(new Event('dvw-ssh-connections-changed'))
    setWorkspacePickerOpen(false)
    setHistory(rememberSshHost({
      host: selected.host,
      ...(selected.user === undefined ? {} : { user: selected.user }),
      ...(selected.port === undefined ? {} : { port: selected.port }),
      ...(selected.identityFile === undefined ? {} : { identityFile: selected.identityFile }),
      workspace: selected.root,
      label: selected.label,
    }, selected.label))
    onTerminal(selected, { open: false })
  }

  const targetMaximum = Math.max(56, Math.round(sshHeight - 180))
  const targetMinimum = Math.min(56, targetMaximum)
  const targetSize = Math.max(targetMinimum, Math.min(targetMaximum, Math.round(sshHeight * targetsFraction)))
  const resizeTargets = (next: number) => {
    if (sshHeight <= 0) return
    setTargetsFraction(Math.max(0.12, Math.min(0.72, next / sshHeight)))
  }

  return <section className="dvw-ssh" hidden={!visible} aria-label="SSH 远程开发" ref={rootRef}>
    <div className="dvw-side-head"><strong>远程资源管理器</strong></div>
    {error && <div className="dvw-ssh-error" role="alert"><span>{error}</span><button className="dvw-icon" title="关闭错误" onClick={() => setError(undefined)}><Icon name="close"/></button></div>}
    <section className="dvw-ssh-targets" data-collapsed={targetsCollapsed} style={connection !== undefined && !targetsCollapsed ? { flexBasis: `${Math.round(targetsFraction * 100)}%` } : undefined}>
      <div className="dvw-ssh-section-head">
        <button type="button" className="dvw-group-toggle dvw-ssh-section-toggle" aria-expanded={!targetsCollapsed} onClick={() => setTargetsCollapsed(value => !value)}>
          <Icon name={targetsCollapsed ? 'chevron-right' : 'chevron-down'}/><Icon name="server"/><span>SSH 目标</span>
        </button>
        <button className="dvw-icon" title="刷新 SSH 目标" onClick={refreshHosts}><Icon name="refresh"/></button>
        <button className="dvw-icon" title="新建远程" onClick={() => { setPasswordPrompt(undefined); setForm(EMPTY_FORM); setNewRemoteOpen(true) }}><Icon name="add"/></button>
        {connection && <button className="dvw-icon" title="断开 SSH" disabled={busy} onClick={() => void disconnect()}><Icon name="debug-disconnect"/></button>}
      </div>
      {!targetsCollapsed && <div className="dvw-ssh-target-list" role="tree" aria-label="SSH 目标">
        {targets.map(target => {
          const connected = connection !== undefined && connection.host === target.host
          return <div className="dvw-ssh-target-row" key={target.key}>
            <button type="button" className="dvw-ssh-target-main" data-connected={connected || undefined} role="treeitem" disabled={busy && !connected} onClick={() => void connectTarget(target)}>
              <Icon name={connected ? 'plug' : 'server'}/>
              <span><strong>{target.label}</strong></span>
              {connected && <em>已连接</em>}
            </button>
            {connected && <button type="button" className="dvw-icon" title="打开远程终端" onClick={() => onTerminal(connection)}><Icon name="terminal"/></button>}
            <button type="button" className="dvw-icon" title="编辑 SSH 目标" onClick={() => editTarget(target)}><Icon name="settings"/></button>
            {target.fromHistory && !hosts.some(host => host.alias === target.host) && <button type="button" className="dvw-icon" title="从最近连接中删除" onClick={() => setHistory(forgetSshHost(target.host))}><Icon name="close"/></button>}
          </div>
        })}
        {targets.length === 0 && <button type="button" className="dvw-ssh-empty-target" onClick={() => setNewRemoteOpen(true)}><Icon name="add"/><span>添加 SSH 主机…</span></button>}
      </div>}
    </section>
    {connection !== undefined && !targetsCollapsed && <PanelResizer
      className="dvw-ssh-targets-resizer"
      label="拖动调整 SSH 目标和远程工作区的高度"
      orientation="horizontal"
      size={targetSize}
      min={targetMinimum}
      max={targetMaximum}
      defaultSize={Math.max(targetMinimum, Math.min(targetMaximum, Math.round(sshHeight * 0.36)))}
      direction={1}
      onResize={resizeTargets}
    />}
    {connection !== undefined && <div className="dvw-ssh-connected">
      <section className="dvw-ssh-workspace-section" data-expanded={workspaceExpanded} data-panel={workspacePanel}>
        <div className="dvw-ssh-section-head">
          <button
            type="button"
            className="dvw-group-toggle dvw-ssh-section-toggle"
            data-remote-section="files"
            aria-expanded={showingFiles ? workspaceExpanded : undefined}
            onClick={() => {
              if (showingFiles) {
                setWorkspaceExpanded(value => !value)
                return
              }
              setWorkspacePanel('files')
              setWorkspaceExpanded(true)
            }}
          >
            {showingFiles
              ? <><Icon name={workspaceExpanded ? 'chevron-down' : 'chevron-right'}/><Icon name="files"/><span>文件</span></>
              : <><Icon name="arrow-left"/><span>返回文件</span></>}
          </button>
          <button type="button" className="dvw-icon dvw-ssh-workspace-switch" title={`切换远程工作区：${connection.root}`} aria-label="选择远程工作区" onClick={() => setWorkspacePickerOpen(true)}><Icon name="folder-opened"/></button>
          {([
            { id: 'search', label: '搜索', icon: 'search' },
            { id: 'git', label: 'Git', icon: 'source-control' },
          ] as const).map(tab => <button
            type="button"
            className="dvw-icon dvw-ssh-workspace-tab"
            data-remote-section={tab.id}
            data-active={workspacePanel === tab.id || undefined}
            aria-label={`切换到远程${tab.label}`}
            aria-pressed={workspacePanel === tab.id}
            title={`切换到远程${tab.label}`}
            key={tab.id}
            onClick={() => {
              setWorkspacePanel(tab.id)
              setWorkspaceExpanded(true)
            }}
          ><Icon name={tab.icon}/></button>)}
        </div>
        <div className="dvw-ssh-panel" hidden={!workspaceExpanded}>
          <RemoteTree key={`tree:${connection.id}`} sessionId={sessionId} connection={connection} visible={visible && workspaceExpanded && showingFiles} onOpen={onOpen} onOpenSource={onOpenSource} onAddToDsh={onAddToDsh} onDisconnected={connectionLost}/>
          {workspaceExpanded && workspacePanel === 'search' && <RemoteSearch key={`search:${connection.id}`} sessionId={sessionId} connection={connection} isDirty={isDirty} onOpen={onOpen} onChanged={onChanged} onDisconnected={() => connectionLost(connection.id)}/>}
          {workspaceExpanded && workspacePanel === 'git' && <RemoteGit key={`git:${connection.id}`} sessionId={sessionId} connection={connection} onDiff={onDiff} onDisconnected={() => connectionLost(connection.id)}/>}
        </div>
      </section>
    </div>}
    {newRemoteOpen && connectionFailure === undefined && createPortal(<div className="dvw-ssh-quickpick-backdrop dvw-ssh-dialog-layer" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setNewRemoteOpen(false) }}>
      <form className="dvw-ssh-quickpick" role="dialog" aria-modal="true" aria-label="新建 SSH 远程" onSubmit={event => { event.preventDefault(); void connectForm() }} onKeyDown={event => { if (event.key === 'Escape' && !busy) setNewRemoteOpen(false) }}>
        <div className="dvw-ssh-quickpick-head"><strong>新建 SSH 远程</strong><button type="button" className="dvw-icon" title="关闭" disabled={busy} onClick={() => setNewRemoteOpen(false)}><Icon name="close"/></button></div>
        <div className="dvw-ssh-quickpick-body">
          <label className="dvw-ssh-quickpick-input">
            <span>输入 SSH 主机</span>
            <input ref={formRef} value={form.host} placeholder="[user@]hostname[:port]" required onChange={event => setForm(current => ({ ...current, host: event.target.value }))}/>
          </label>
          <small>可使用 ~/.ssh/config 中的别名，或输入 SSH 主机地址。</small>
          <div className="dvw-ssh-auth-method">
            <label htmlFor="dvw-ssh-auth-method"><strong>验证方式</strong><small>{form.authMethod === 'password' ? '使用登录用户和密码完成认证。' : '使用本机私钥完成认证。'}</small></label>
            <select id="dvw-ssh-auth-method" aria-label="验证方式" value={form.authMethod} onChange={event => setForm(current => ({ ...current, authMethod: event.target.value === 'password' ? 'password' : 'key', password: '' }))}>
              <option value="password">密码</option>
              <option value="key">私钥</option>
            </select>
          </div>
          {passwordPrompt && <p role="alert">{passwordPrompt}</p>}
          <div className="dvw-ssh-credentials">
            <div className="dvw-ssh-form-grid">
              <label className="dvw-ssh-quickpick-input"><span>登录用户</span><input value={form.user} placeholder="root" autoComplete="username" onChange={event => setForm(current => ({ ...current, user: event.target.value }))}/></label>
              <label className="dvw-ssh-quickpick-input"><span>端口</span><input inputMode="numeric" value={form.port} placeholder="22" onChange={event => setForm(current => ({ ...current, port: event.target.value.replace(/\D/g, '') }))}/></label>
            </div>
            {form.authMethod === 'key'
              ? <label className="dvw-ssh-quickpick-input"><span>私钥路径</span><input value={form.identityFile} placeholder="SSH 配置 / ssh-agent / 默认密钥" onChange={event => setForm(current => ({ ...current, identityFile: event.target.value }))}/></label>
              : <label className="dvw-ssh-quickpick-input"><span>登录密码</span><input type="password" required autoComplete="off" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))}/></label>}
            {form.authMethod === 'password' && <label className="dvw-ssh-remember-password">
              <input type="checkbox" checked={form.savePassword} onChange={event => setForm(current => ({ ...current, savePassword: event.target.checked }))}/>
              <span>连接成功后安全保存密码</span>
            </label>}
          </div>
          <details className="dvw-ssh-quickpick-options" open>
            <summary>更多连接选项</summary>
            <label><span>远程目录</span><input className="dvw-input" value={form.workspace} placeholder="." onChange={event => setForm(current => ({ ...current, workspace: event.target.value }))}/></label>
            <label><span>连接名称</span><input className="dvw-input" value={form.label} placeholder="可选" onChange={event => setForm(current => ({ ...current, label: event.target.value }))}/></label>
          </details>
          {form.authMethod === 'key' && <small className="dvw-ssh-save-hint">连接成功后自动记住私钥路径。</small>}
        </div>
        <div className="dvw-ssh-quickpick-actions">
          <button type="button" disabled={busy} onClick={() => setNewRemoteOpen(false)}>取消</button>
          <button type="submit" className="dvw-ssh-primary" disabled={busy || form.host.trim() === '' || (form.authMethod === 'password' && form.password === '')}><Icon name={busy ? 'refresh' : 'remote'}/>{busy ? '正在连接…' : '连接'}</button>
        </div>
      </form>
    </div>, document.body)}
    {visible && connectionFailure !== undefined && <ConnectionFailureDialog
      host={connectionFailure.request.host}
      detail={connectionFailure.detail}
      retrying={busy}
      onRetry={() => void openConnection(connectionFailure.request, connectionFailure.authMethod, connectionFailure.promptTarget)}
      onClose={() => {
        setConnectionFailure(undefined)
        setForm(current => ({ ...current, password: '' }))
      }}
    />}
    {workspacePickerOpen && connection !== undefined && <RemoteWorkspacePicker sessionId={sessionId} connection={connection} onClose={() => setWorkspacePickerOpen(false)} onSelect={changeWorkspace}/>}
  </section>
}
