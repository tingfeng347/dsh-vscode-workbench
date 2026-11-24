import type { MouseEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry, SshConnection } from '../types.ts'
import { api, readApiResponse } from './api.ts'
import { copyText } from './clipboard.ts'
import { isAddToDshShortcut } from './dshComposer.ts'
import { FileIcon } from './FileIcon.tsx'
import { Icon } from './Icon.tsx'
import { errorText, fileParts, remoteFileUri, sshDisconnected } from './ssh.ts'

export function RemoteTree({ sessionId, connection, visible, onOpen, onOpenSource, onAddToDsh, onDisconnected }: {
  sessionId: string
  connection: SshConnection
  visible: boolean
  onOpen(path: string): void
  onOpenSource?(path: string): void
  onAddToDsh?: (connection: SshConnection, entry: FileEntry) => void
  onDisconnected(connectionId: string): void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [rows, setRows] = useState<ReadonlyMap<string, FileEntry[]>>(new Map())
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const [context, setContext] = useState<{ entry?: FileEntry; x: number; y: number }>()
  const [editing, setEditing] = useState<{ path: string; name: string; kind?: FileEntry['kind'] }>()
  const [removeEntry, setRemoveEntry] = useState<FileEntry>()
  const [operation, setOperation] = useState<{ status: string; failed?: boolean }>()
  const [dropDirectory, setDropDirectory] = useState<string>()
  const uploadDirectory = useRef('')
  const picker = useRef<HTMLInputElement>(null)
  const tree = useRef<HTMLDivElement>(null)
  const requests = useRef(new Map<string, AbortController>())

  const load = useCallback(async (path: string) => {
    if (requests.current.has(path)) return
    const request = new AbortController()
    requests.current.set(path, request)
    setLoading(current => new Set(current).add(path))
    setErrors(current => {
      if (!current.has(path)) return current
      const next = new Map(current)
      next.delete(path)
      return next
    })
    try {
      const entries = await api<FileEntry[]>('ssh.list', { sessionId, connectionId: connection.id, path }, request.signal)
      if (!request.signal.aborted) setRows(current => new Map(current).set(path, entries))
    } catch (cause) {
      if (request.signal.aborted) return
      if (sshDisconnected(cause)) onDisconnected(connection.id)
      else setErrors(current => new Map(current).set(path, errorText(cause)))
    } finally {
      if (!request.signal.aborted) {
        requests.current.delete(path)
        setLoading(current => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
      }
    }
  }, [connection.id, onDisconnected, sessionId])

  useEffect(() => {
    const active = requests.current
    return () => {
      for (const request of active.values()) request.abort()
      active.clear()
    }
  }, [])

  useEffect(() => {
    if (visible) void load('')
  }, [visible, load])

  useEffect(() => {
    if (!visible) {
      setContext(undefined)
      setDropDirectory(undefined)
    }
  }, [visible])

  useEffect(() => {
    if (context === undefined) return
    const close = () => setContext(undefined)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [context])

  const refresh = (directory: string, paths: string[] = []) => {
    requests.current.get(directory)?.abort()
    requests.current.delete(directory)
    setExpanded(current => new Set(current).add(directory))
    void load(directory)
    if (paths.length !== 0) window.dispatchEvent(new CustomEvent('dvw-files-changed', { detail: paths }))
  }

  const upload = async (directory: string, files: File[]) => {
    if (files.length === 0) return
    setOperation({ status: `正在上传 ${files.length} 个文件…` })
    const failures: string[] = []
    const uploaded: string[] = []
    for (const file of files) {
      try {
        const query = new URLSearchParams({ sessionId, directory: remoteFileUri(connection.id, directory), name: file.name })
        const response = await fetch(`/dsh-vscode/upload?${query}`, { method: 'POST', body: file })
        const entry = await readApiResponse<FileEntry>(response, 'upload')
        uploaded.push(remoteFileUri(connection.id, entry.path))
      } catch (cause) {
        if (sshDisconnected(cause)) { onDisconnected(connection.id); return }
        failures.push(`${file.name}：${errorText(cause)}`)
      }
    }
    refresh(directory, uploaded)
    setOperation(failures.length === 0 ? undefined : { status: failures.join('\n'), failed: true })
  }

  const changeEntry = async (entry: NonNullable<typeof editing>) => {
    const name = entry.name.trim()
    if (name === '' || name === '.' || name === '..' || /[\\/]/.test(name)) {
      setOperation({ status: '请输入有效的文件或文件夹名称。', failed: true })
      return
    }
    const directory = entry.kind === undefined ? fileParts(entry.path).directory : entry.path
    const nextPath = remoteFileUri(connection.id, directory === '' ? name : `${directory}/${name}`)
    const path = remoteFileUri(connection.id, entry.path)
    if (entry.kind === undefined && path === nextPath) { setEditing(undefined); return }
    setEditing(undefined)
    try {
      if (entry.kind === undefined) await api('fs.rename', { sessionId, path, nextPath })
      else await api('fs.create', { sessionId, path: nextPath, kind: entry.kind })
      refresh(directory, [path, nextPath])
    } catch (cause) {
      if (sshDisconnected(cause)) onDisconnected(connection.id)
      else setOperation({ status: errorText(cause), failed: true })
    }
  }

  const remove = async (entry: FileEntry) => {
    const path = remoteFileUri(connection.id, entry.path)
    setRemoveEntry(undefined)
    try {
      await api('fs.delete', { sessionId, path })
      refresh(fileParts(entry.path).directory, [path])
    } catch (cause) {
      if (sshDisconnected(cause)) onDisconnected(connection.id)
      else setOperation({ status: errorText(cause), failed: true })
    }
  }

  const downloadUrl = (entry: FileEntry) => `/dsh-vscode/download?${new URLSearchParams({
    sessionId, path: remoteFileUri(connection.id, entry.path),
  })}`

  const showMenu = (event: MouseEvent, entry?: FileEntry) => {
    event.preventDefault()
    event.stopPropagation()
    setContext({ entry, x: event.clientX, y: event.clientY })
  }

  useEffect(() => {
    if (!visible) return
    const node = tree.current
    if (node === null) return
    const intercept = (event: globalThis.DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files') || !(event.target instanceof Node) || !node.contains(event.target)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type === 'dragleave') {
        if (!(event.relatedTarget instanceof Node) || !node.contains(event.relatedTarget)) setDropDirectory(undefined)
        return
      }
      const directory = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-dvw-ssh-drop-directory]')?.dataset.dvwSshDropDirectory ?? ''
        : ''
      if (event.type === 'drop') {
        setDropDirectory(undefined)
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length !== 0) void upload(directory, files)
      } else {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        setDropDirectory(directory)
      }
    }
    const events = ['dragenter', 'dragover', 'dragleave', 'drop'] as const
    for (const type of events) document.addEventListener(type, intercept, true)
    return () => { for (const type of events) document.removeEventListener(type, intercept, true) }
  }, [connection.id, load, onDisconnected, sessionId, visible])

  const retry = (path: string) => {
    const error = errors.get(path)
    return error === undefined ? null : <div key={`error:${path}`} className="dvw-ssh-tree-error" role="alert">
      <span>{error}</span>
      <button type="button" className="dvw-icon" aria-label={path === '' ? '重试读取工作区' : `重试读取 ${path}`} title="重试读取目录" onClick={() => void load(path)}><Icon name="refresh"/></button>
    </div>
  }

  const toggle = (path: string) => {
    const opening = !expanded.has(path)
    setExpanded(current => {
      const next = new Set(current)
      if (opening) next.add(path)
      else next.delete(path)
      return next
    })
    if (opening && !rows.has(path)) void load(path)
  }

  const render = (path: string, depth: number): React.ReactNode[] => (rows.get(path) ?? []).flatMap(entry => {
    const isDirectory = entry.kind === 'directory'
    const open = expanded.has(entry.path)
    const header = <div key={`${isDirectory ? 'd' : 'f'}:${entry.path}`} className="dvw-ssh-tree-row" style={{ paddingLeft: 8 + depth * 14 }} role="treeitem"
      data-dvw-ssh-drop-directory={isDirectory ? entry.path : path}
      data-dvw-native-drop-target={isDirectory && dropDirectory === entry.path || undefined}
      aria-expanded={isDirectory ? open : undefined}
      tabIndex={0}
      onContextMenu={event => showMenu(event, entry)}
      onKeyDown={event => {
        if (onAddToDsh && isAddToDshShortcut(event.nativeEvent)) {
          event.preventDefault()
          event.stopPropagation()
          onAddToDsh(connection, entry)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (isDirectory) toggle(entry.path)
          else onOpen(remoteFileUri(connection.id, entry.path))
        }
      }}
      draggable={!isDirectory}
      onDragStart={event => {
        if (isDirectory) return
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData('DownloadURL', `application/octet-stream:${entry.name.replaceAll(':', '_')}:${new URL(downloadUrl(entry), location.href)}`)
      }}
      onClick={() => isDirectory ? toggle(entry.path) : onOpen(remoteFileUri(connection.id, entry.path))}>
      <span className="dvw-chevron">{isDirectory ? <Icon name={open ? 'chevron-down' : 'chevron-right'}/> : null}</span>
      <FileIcon name={entry.name} directory={isDirectory} expanded={open}/>
      <span className="dvw-ssh-tree-name" title={entry.path}>{entry.name}</span>
      {loading.has(entry.path) && <span className="dvw-ssh-spinner" aria-label="正在读取目录"/>}
    </div>
    return isDirectory ? [header, ...(open ? [retry(entry.path), ...render(entry.path, depth + 1)] : [])] : [header]
  })

  const entry = context?.entry
  const directory = entry === undefined ? '' : entry.kind === 'directory' ? entry.path : fileParts(entry.path).directory
  const menuAction = (action: () => void) => { setContext(undefined); action() }
  const chooseUpload = () => {
    uploadDirectory.current = directory
    picker.current?.click()
  }

  return <section className="dvw-ssh-section dvw-ssh-tree-section" hidden={!visible}>
    {retry('')}
    {!rows.has('') && loading.has('') && <div className="dvw-ssh-empty" role="status">正在读取远程文件…</div>}
    {operation && <div className="dvw-ssh-tree-error" role={operation.failed ? 'alert' : 'status'}><span>{operation.status}</span><button type="button" className="dvw-icon" aria-label="关闭消息" onClick={() => setOperation(undefined)}><Icon name="close"/></button></div>}
    <input ref={picker} type="file" multiple hidden onChange={event => {
      const files = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      void upload(uploadDirectory.current, files)
    }}/>
    <div ref={tree} className="dvw-ssh-tree" role="tree" aria-busy={loading.has('')} data-dvw-native-drop-target={dropDirectory === '' || undefined} onContextMenu={event => showMenu(event)}>
      {rows.get('')?.length === 0 && <div className="dvw-ssh-empty">工作区为空</div>}
      {render('', 0)}
    </div>
    {context && <div className="dvw-context-menu" role="menu"
      style={{ left: Math.max(0, Math.min(context.x, innerWidth - 240)), top: Math.max(0, Math.min(context.y, innerHeight - 350)) }}
      onPointerDown={event => event.stopPropagation()}>
      {entry && onAddToDsh && <button type="button" role="menuitem" onClick={() => menuAction(() => onAddToDsh(connection, entry))}><Icon name="comment-discussion"/>添加到 DSH 对话</button>}
      {entry && <button type="button" role="menuitem" onClick={() => menuAction(() => void copyText(entry.path))}><Icon name="copy"/>复制相对路径</button>}
      {entry && <button type="button" role="menuitem" onClick={() => menuAction(() => void copyText(`${connection.root.replace(/\/$/, '')}/${entry.path}`))}><Icon name="copy"/>复制绝对路径</button>}
      {entry?.kind === 'file' && <>
        {onOpenSource && /\.html?$/i.test(entry.path) && <button type="button" role="menuitem" onClick={() => menuAction(() => onOpenSource(remoteFileUri(connection.id, entry.path)))}><Icon name="code"/>打开 HTML 源码</button>}
        <button type="button" role="menuitem" onClick={() => menuAction(() => {
          const link = document.createElement('a')
          link.href = downloadUrl(entry)
          link.download = entry.name
          document.body.append(link)
          link.click()
          link.remove()
        })}><Icon name="cloud-download"/>下载</button>
      </>}
      {(entry === undefined || entry.kind === 'directory') && <>
        <button type="button" role="menuitem" onClick={() => menuAction(chooseUpload)}><Icon name="cloud-upload"/>上传文件</button>
        <button type="button" role="menuitem" onClick={() => menuAction(() => setEditing({path: directory, name: '', kind: 'file'}))}><Icon name="new-file"/>新建文件</button>
        <button type="button" role="menuitem" onClick={() => menuAction(() => setEditing({path: directory, name: '', kind: 'directory'}))}><Icon name="new-folder"/>新建文件夹</button>
        <button type="button" role="menuitem" onClick={() => menuAction(() => refresh(directory))}><Icon name="refresh"/>刷新</button>
      </>}
      {entry && <button type="button" role="menuitem" onClick={() => menuAction(() => setEditing({path: entry.path, name: entry.name}))}><Icon name="edit"/>重命名</button>}
      {entry && <button type="button" className="dvw-context-delete" role="menuitem" onClick={() => menuAction(() => setRemoveEntry(entry))}><Icon name="trash"/>删除</button>}
    </div>}
    {editing && <div className="dvw-ssh-quickpick-backdrop">
      <form className="dvw-ssh-quickpick dvw-ssh-entry-dialog" role="dialog" aria-modal="true" aria-label={editing.kind === 'directory' ? '新建远程文件夹' : editing.kind === 'file' ? '新建远程文件' : '重命名远程项目'}
        onSubmit={event => { event.preventDefault(); void changeEntry(editing) }}
        onKeyDown={event => { if (event.key === 'Escape') setEditing(undefined) }}>
        <div className="dvw-ssh-quickpick-body">
          <label className="dvw-ssh-quickpick-input">名称
            <input value={editing.name} autoFocus required onFocus={event => event.currentTarget.select()} onChange={event => setEditing({ ...editing, name: event.target.value })}/>
          </label>
          {operation?.failed && <p role="alert">{operation.status}</p>}
        </div>
        <div className="dvw-ssh-quickpick-actions"><button type="button" onClick={() => setEditing(undefined)}>取消</button><button className="dvw-ssh-primary" type="submit">确定</button></div>
      </form>
    </div>}
    {removeEntry && <div className="dvw-confirm-backdrop"><section className="dvw-confirm" role="alertdialog" aria-modal="true" aria-label="删除远程项目">
      <h2>删除远程项目</h2><p>是否删除「{removeEntry.name}」？</p><p className="dvw-confirm-note">此操作无法撤销。</p>
      <footer><button type="button" autoFocus onClick={() => setRemoveEntry(undefined)}>取消</button><button type="button" className="dvw-danger-button" onClick={() => void remove(removeEntry)}>删除</button></footer>
    </section></div>}
  </section>
}
