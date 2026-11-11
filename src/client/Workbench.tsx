import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, ReactNode } from 'react'
import type { FileDocument, FileEntry, GitBranch, GitChange, GitCommit, GitCommitFile, GitDiff, GitStatus, SearchMatch } from '../types.ts'
import { ApiError, api } from './api.ts'
import type { VscodeWorkbench, WorkbenchView } from './service.ts'
import { Icon } from './Icon.tsx'
import { FileIcon } from './FileIcon.tsx'
import { branchErrorMessage } from './gitError.ts'
import { MarkdownPreview, markdownHeadings } from './MarkdownPreview.tsx'
import type { MarkdownHeading } from './MarkdownPreview.tsx'
import { MonacoDiffEditor, MonacoEditor, isMacPlatform, loadMonaco, preloadMonaco, retainEditorModels } from './MonacoEditor.tsx'
import { DshConversationPanel, DshConversationTheme } from './DshConversationPanel.tsx'
import { DshMark } from './DshMark.tsx'
import { ActivityBar, normalizeActivityOrder, type ActivityView } from './ActivityBar.tsx'
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx'
import type { DshNavigation, WorkspaceChoice } from './dshNavigation.ts'
import { LspManager, type LspServerStatus } from './lsp.ts'
import { TS_INTELLISENSE_KEY, disposeTypeScriptProject, indexTypeScriptProject, refreshIndexedFiles, tsIntellisenseEnabled, workspacePathFromModel } from './typescriptProject.ts'
import { ADD_TO_DSH_SHORTCUT, dshReference, insertIntoDshComposer, isAddToDshShortcut } from './dshComposer.ts'
import { DocumentPreview, documentPreviewKind, type DocumentPreviewKind } from './documentPreview.tsx'
import { toggleTerminal } from './shortcuts.ts'
import { websocketUrl } from './websocket.ts'
import { resetWorkspaceDocuments, WorkspaceRequestScope } from './workspaceState.ts'
import type { CommitDetail, CommitLanguage, CommitMessagePreferences } from '../commit-message.ts'

interface Tab extends FileDocument { instance?: symbol; dirty: boolean; draft: string; loaded?: boolean; line?: number; column?: number; highlight?: string; external?: boolean; preview?: boolean; title?: string; diff?: GitDiff; diffMode?: 'inline' | 'split'; diffSourcePath?:string; imageUrl?:string; documentPreview?:DocumentPreviewKind; documentUrl?:string }
type WorkbenchTheme = 'dsh' | 'dark' | 'light' | 'white' | 'eyecare'
export type MarkdownDefaultView = 'preview' | 'source'
export const MARKDOWN_DEFAULT_VIEW_KEY = 'dvw:markdown-default-view'
interface TreeProps { sessionId: string; path: string; depth: number; expanded: Set<string>; selected?: string; selectedDirectory: string; statuses: Map<string, string>; onToggle(path: string): void; onSelectDirectory(path: string): void; onOpen(path: string): void; onChange(): void; onUpload(directory: string, files: FileList): void; onAddToDsh(path: string, directory: boolean): void }
interface CreatingEntry { kind: 'file' | 'directory'; directory: string; value: string; error?: string }

type ResizeDirection = 1 | -1

export const DSH_CHAT_MIN_WIDTH = 440
export const DSH_CHAT_MAX_WIDTH = 720
export const DSH_CHAT_DEFAULT_WIDTH = 440

/** Keep persisted or dragged widths inside the range the DSH composer can lay out cleanly. */
export function clampChatWidth(width: number): number {
  if (!Number.isFinite(width)) return DSH_CHAT_DEFAULT_WIDTH
  return Math.max(DSH_CHAT_MIN_WIDTH, Math.min(DSH_CHAT_MAX_WIDTH, Math.round(width)))
}

/** Calculate a panel width from a horizontal pointer movement. */
export function resizedPanelWidth(startWidth: number, startX: number, nextX: number, direction: ResizeDirection, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(startWidth + (nextX - startX) * direction)))
}

function PanelResizer({ className, label, width, min, max, defaultWidth, direction, hideBelow, onHide, onWidth }: { className: string; label: string; width: number; min: number; max: number; defaultWidth: number; direction: ResizeDirection; hideBelow?: number; onHide?(): void; onWidth(width: number): void }) {
  const [dragging, setDragging] = useState(false)
  const stopDragging = useRef<() => void>(() => {})
  useEffect(() => () => stopDragging.current(), [])
  const stop = () => stopDragging.current()
  return <div className={className} data-dragging={dragging || undefined} role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(width)} tabIndex={0} title={`${label}，双击恢复默认`} onDoubleClick={() => onWidth(defaultWidth)} onKeyDown={event => {
    if (event.key === 'Home') { event.preventDefault(); onWidth(defaultWidth); return }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const pointerDelta = event.key === 'ArrowRight' ? 10 : -10
    onWidth(Math.max(min, Math.min(max, Math.round(width + pointerDelta * direction))))
  }} onPointerDown={event => {
    if (event.button !== 0) return
    event.preventDefault()
    stop()
    const startX = event.clientX
    const startWidth = width
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    setDragging(true)
    const move = (next: PointerEvent) => onWidth(resizedPanelWidth(startWidth, startX, next.clientX, direction, min, max))
    const cleanup = (commit = false, nextX = startX) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setDragging(false)
      stopDragging.current = () => {}
      if (!commit) return
      const nextWidth = Math.round(startWidth + (nextX - startX) * direction)
      if (hideBelow !== undefined && nextWidth < hideBelow) { onHide?.(); return }
      onWidth(Math.max(min, Math.min(max, nextWidth)))
    }
    const up = (next: PointerEvent) => cleanup(true, next.clientX)
    const cancel = () => cleanup()
    stopDragging.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
  }}/>
}

/** Read the saved Markdown default without depending on browser storage during unit tests. */
export function markdownDefaultView():MarkdownDefaultView{try{return localStorage.getItem(MARKDOWN_DEFAULT_VIEW_KEY)==='source'?'source':'preview'}catch{return 'preview'}}

function unloadedTab(path:string):Tab{return {instance:Symbol(path),path,content:'',draft:'',revision:'',size:0,binary:false,tooLarge:false,dirty:false,loaded:false,preview:/\.md$/i.test(path)?markdownDefaultView()==='preview':undefined}}

function WorkbenchTitlebar({ name }: { name?: string }) {
  return <div className="dvw-titlebar"><strong>DSH Workbench</strong>{name !== undefined && <span>{name}</span>}</div>
}

/** Restore tab headers without reading their file contents. */
export function restoreTabPaths(paths:string[]):Tab[]{return [...new Set(paths)].map(unloadedTab)}

/** Return whether file changes require reloading one visible directory. */
export function directoryAffected(directory:string,changedPaths:string[]):boolean{return changedPaths.some(changed=>{const normalized=changed.replace(/\\/g,'/');const parent=normalized.includes('/')?normalized.slice(0,normalized.lastIndexOf('/')):'';return normalized===directory||parent===directory})}

/** Return the basename shown in a tab while preserving its full internal path. */
export function tabLabel(tab:Pick<Tab,'path'|'title'|'diffSourcePath'>):string{const path=tab.title??tab.diffSourcePath??tab.path.replace(/^diff:/,'');return path.split(/[\\/]/).at(-1)??path}

function readActivityJSON(key: string): unknown { try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] } }
function readActivityHidden(id: string): boolean { return false }

/** Return the horizontal scroll offset that keeps an active tab inside the tab strip. */
export function tabScrollLeft(scrollLeft:number,viewport:{left:number;right:number},tab:{left:number;right:number}):number{
  if(tab.left<viewport.left)return scrollLeft-(viewport.left-tab.left)
  if(tab.right>viewport.right)return scrollLeft+(tab.right-viewport.right)
  return scrollLeft
}

/** Invoke `fn` at most once per `ms` after the latest call, always running the freshest callback. */
function useDebouncedCallback(fn: () => void, ms: number): () => void {
  const fnRef = useRef(fn); fnRef.current = fn
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  return useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(() => fnRef.current(), ms) }, [ms])
}

function useDshDarkTheme(): boolean {
  const read = () => document.body.hasAttribute('data-ds-dark-theme')
  const [dark, setDark] = useState(read)
  useEffect(() => { const observer = new MutationObserver(() => setDark(read())); observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] }); return () => observer.disconnect() }, [])
  return dark
}

/** Workspace-relative directory that would contain `path`. */
export function parentPath(path: string): string { return path.split('/').slice(0, -1).join('/') }

/** Destination path when moving an entry into `directory`. */
export function movedPath(path: string, directory: string): string { return createdEntryPath(directory, path.split('/').at(-1) ?? path) }

/** Reject moves into the same folder, into the entry itself, or into its descendants. */
export function canMoveTo(path: string, directory: string): boolean { return parentPath(path) !== directory && directory !== path && !directory.startsWith(`${path}/`) }

/** Chromium `DownloadURL` payload that lets a file be dropped onto the desktop or another app. */
export function downloadUrlData(sessionId: string, path: string, origin: string): string {
  const name = path.split('/').at(-1) ?? path
  return `application/octet-stream:${name}:${origin}/dsh-vscode/download?${new URLSearchParams({ sessionId, path })}`
}

const ENTRY_DRAG_TYPE = 'application/x-dvw-entry'
const DRAG_EXPAND_DELAY = 500
// Only one Explorer drag can be active; dragover cannot read dataTransfer payloads, so keep the entry here.
let draggedEntry: FileEntry | undefined
let moveTarget: HTMLElement | undefined
let expandTimer: ReturnType<typeof setTimeout> | undefined

function clearMoveTarget() { clearTimeout(expandTimer); expandTimer = undefined; moveTarget?.removeAttribute('data-dvw-move-target'); moveTarget = undefined }
function markMoveTarget(element: HTMLElement | null | undefined, expand?: () => void) {
  if (element === moveTarget) return
  clearMoveTarget()
  if (!element) return
  moveTarget = element; element.dataset.dvwMoveTarget = 'true'
  if (expand) expandTimer = setTimeout(expand, DRAG_EXPAND_DELAY)
}
function startEntryDrag(event: DragEvent, sessionId: string, entry: FileEntry) {
  draggedEntry = entry
  event.dataTransfer.effectAllowed = 'copyMove'
  event.dataTransfer.setData(ENTRY_DRAG_TYPE, entry.path)
  event.dataTransfer.setData('text/plain', entry.path)
  if (entry.kind === 'file') event.dataTransfer.setData('DownloadURL', downloadUrlData(sessionId, entry.path, location.origin))
}
function endEntryDrag() { draggedEntry = undefined; clearMoveTarget() }
/** Accept an Explorer drag over `element` when the entry may move into `directory`; returns false for non-Explorer drags. */
function entryDragOver(event: DragEvent, directory: string, element: HTMLElement | null | undefined, expand?: () => void): boolean {
  if (draggedEntry === undefined) return false
  event.stopPropagation()
  if (!canMoveTo(draggedEntry.path, directory)) { clearMoveTarget(); event.dataTransfer.dropEffect = 'none'; return true }
  event.preventDefault(); event.dataTransfer.dropEffect = 'move'; markMoveTarget(element, expand)
  return true
}
async function dropEntry(event: DragEvent, sessionId: string, directory: string, onMoved: () => void) {
  const entry = draggedEntry
  if (entry === undefined) return
  event.preventDefault(); event.stopPropagation(); endEntryDrag()
  if (!canMoveTo(entry.path, directory)) return
  const nextPath = movedPath(entry.path, directory)
  try { await api('fs.rename', { sessionId, path: entry.path, nextPath }); onMoved(); window.dispatchEvent(new CustomEvent('dvw-files-changed', { detail: [entry.path, nextPath] })) } catch (error) { alert(error instanceof Error ? error.message : String(error)) }
}

function Tree({ sessionId, path, depth, expanded, selected, selectedDirectory, statuses, onToggle, onSelectDirectory, onOpen, onChange, onUpload, onAddToDsh, creating, onCreatingChange, onCreatingCancel, onCreatingSubmit }: TreeProps & { creating?: CreatingEntry; onCreatingChange(value: string): void; onCreatingCancel(): void; onCreatingSubmit(): void }) {
  const [rows, setRows] = useState<FileEntry[]>([]); const [error, setError] = useState<string>(); const [dropTarget, setDropTarget] = useState(false); const [context, setContext] = useState<{ entry: FileEntry; x: number; y: number }>(); const [renaming, setRenaming] = useState<{ path: string; value: string }>(); const [pendingDelete, setPendingDelete] = useState<FileEntry>()
  const load = useCallback(() => { void api<FileEntry[]>('fs.list', { sessionId, path }).then(value => { setRows(value); setError(undefined) }).catch(error => setError(String(error))) }, [sessionId, path])
  useEffect(load, [load])
  useEffect(() => {
    const handler = (event:Event) => { const paths=(event as CustomEvent<string[]>).detail; if(!Array.isArray(paths)||directoryAffected(path,paths))load() }; window.addEventListener('dvw-files-changed', handler); return () => window.removeEventListener('dvw-files-changed', handler)
  }, [load])
  useEffect(() => { if (context === undefined) return; const close = () => setContext(undefined); const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }; window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape); return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) } }, [context])
  useEffect(() => { if (pendingDelete === undefined) return; const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPendingDelete(undefined) }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape) }, [pendingDelete])
  const rename = async (entry: FileEntry) => { const value = renaming?.path === entry.path ? renaming.value.trim() : ''; setRenaming(undefined); if (value === '' || value === entry.name) return; try { await api('fs.rename', { sessionId, path: entry.path, nextPath: renamedPath(entry.path, value) }); load(); onChange() } catch (error) { alert(error instanceof Error ? error.message : String(error)) } }
  const remove = async () => { if (pendingDelete === undefined) return; const entry = pendingDelete; setPendingDelete(undefined); try { await api('fs.delete', { sessionId, path: entry.path }); load(); onChange() } catch (error) { alert(error instanceof Error ? error.message : String(error)) } }
  const entryDirectory = (row: FileEntry) => row.kind === 'directory' ? row.path : parentPath(row.path)
  // A folder highlights its whole block like VS Code; a file targets its parent folder's block (or the tree root).
  const entryTarget = (event: DragEvent, row: FileEntry) => { const entry = (event.currentTarget as HTMLElement).parentElement; return row.kind === 'directory' ? entry : entry?.parentElement?.closest<HTMLElement>('.dvw-tree-entry,.dvw-tree') }
  const drop = (event: DragEvent, directory: string) => { event.preventDefault(); event.stopPropagation(); setDropTarget(false); if (event.dataTransfer.files.length > 0) onUpload(directory, event.dataTransfer.files) }
  return <>{error && <div className="dvw-error">{error}</div>}{creating?.directory === path && <><div className="dvw-tree-row dvw-tree-create-row" style={{ paddingLeft: 6 + depth * 13 }}><span className="dvw-chevron"/><Icon name={creating.kind === 'directory' ? 'folder' : 'new-file'} className={`dvw-file-icon ${creating.kind === 'directory' ? 'folder' : ''}`}/><input className="dvw-tree-create-input" value={creating.value} autoFocus aria-label={creating.kind === 'directory' ? '新建文件夹名称' : '新建文件名称'} aria-invalid={creating.error !== undefined} placeholder={creating.kind === 'directory' ? '文件夹名称' : '文件名称'} onChange={event => onCreatingChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onCreatingSubmit() } if (event.key === 'Escape') { event.preventDefault(); onCreatingCancel() } }} onBlur={onCreatingCancel}/></div>{creating.error && <div className="dvw-tree-create-error" style={{ paddingLeft: 42 + depth * 13 }}>{creating.error}</div>}</>}{rows.map(row => <div className="dvw-tree-entry" key={row.path}>
    <div className="dvw-tree-row" data-dvw-upload-directory={row.kind === 'directory' ? row.path : undefined} data-selected={selected === row.path || selectedDirectory === row.path} data-drop-target={dropTarget && row.kind === 'directory'} style={{ paddingLeft: 6 + depth * 13 }} onClick={() => row.kind === 'directory' ? (onSelectDirectory(row.path), onToggle(row.path)) : onOpen(row.path)} onContextMenu={(event) => { event.preventDefault(); if (row.kind === 'directory') onSelectDirectory(row.path); setContext({ entry: row, x: event.clientX, y: event.clientY }) }} draggable={renaming?.path !== row.path} onDragStart={event => startEntryDrag(event, sessionId, row)} onDragEnd={endEntryDrag} onDragEnter={event => { if (entryDragOver(event, entryDirectory(row), entryTarget(event, row), row.kind === 'directory' && !expanded.has(row.path) ? () => onToggle(row.path) : undefined)) return; if (row.kind === 'directory' && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); setDropTarget(true) } }} onDragOver={event => { if (entryDragOver(event, entryDirectory(row), entryTarget(event, row))) return; if (row.kind === 'directory' && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); setDropTarget(true) } }} onDragLeave={() => setDropTarget(false)} onDrop={event => { if (draggedEntry !== undefined) { void dropEntry(event, sessionId, entryDirectory(row), onChange); return } if (row.kind === 'directory') drop(event, row.path) }}>
      <span className="dvw-chevron">{row.kind === 'directory' && <Icon name={expanded.has(row.path) ? 'chevron-down' : 'chevron-right'}/>}</span><FileIcon name={row.name} directory={row.kind === 'directory'} expanded={expanded.has(row.path)}/>{renaming?.path === row.path ? <input className="dvw-tree-rename" value={renaming.value} autoFocus onClick={event => event.stopPropagation()} onChange={event => setRenaming({ path: row.path, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') void rename(row); if (event.key === 'Escape') setRenaming(undefined) }} onBlur={() => setRenaming(undefined)}/> : <span className="dvw-tree-name">{row.name}</span>}{row.kind === 'file' && statuses.has(row.path) && <span className="dvw-tree-status" data-status={statuses.get(row.path)}>{statuses.get(row.path)}</span>}
    </div>
    {row.kind === 'directory' && expanded.has(row.path) && <Tree {...{ sessionId, path: row.path, depth: depth + 1, expanded, selected, selectedDirectory, statuses, onToggle, onSelectDirectory, onOpen, onChange, onUpload, onAddToDsh, creating, onCreatingChange, onCreatingCancel, onCreatingSubmit }} />}
  </div>)}{context && <div className="dvw-context-menu" role="menu" style={{ left: context.x, top: context.y }} onPointerDown={event => event.stopPropagation()}><button role="menuitem" onClick={() => { onAddToDsh(context.entry.path, context.entry.kind === 'directory'); setContext(undefined) }}><DshMark size={14}/>添加到 DSH 对话<kbd>{ADD_TO_DSH_SHORTCUT}</kbd></button><button role="menuitem" onClick={() => { setRenaming({ path: context.entry.path, value: context.entry.name }); setContext(undefined) }}><Icon name="edit"/>重命名</button><button className="dvw-context-delete" role="menuitem" onClick={() => { setPendingDelete(context.entry); setContext(undefined) }}><Icon name="trash"/>删除</button></div>}{pendingDelete && <div className="dvw-confirm-backdrop" role="presentation"><section className="dvw-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dvw-delete-title" aria-describedby="dvw-delete-message"><h2 id="dvw-delete-title">删除 {pendingDelete.kind === 'directory' ? '文件夹' : '文件'}</h2><p id="dvw-delete-message">是否删除“{pendingDelete.name}”？</p><p className="dvw-confirm-note">此操作无法撤销。</p><footer><button autoFocus onClick={() => setPendingDelete(undefined)}>取消</button><button className="dvw-danger-button" onClick={() => void remove()}>删除</button></footer></section></div>}</>
}

function Explorer(props: { sessionId: string; cwd?: string; selected?: string; onOpen(path: string): void; onAddToDsh(path: string, directory: boolean): void }) {
  // The row the user last clicked, which the Explorer shortcut adds to the DSH chat.
  const lastEntry = useRef<{ path: string; directory: boolean }>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); const [revision, setRevision] = useState(0); const [statuses, setStatuses] = useState<Map<string, string>>(new Map()); const [dropTarget, setDropTarget] = useState(false); const [selectedDirectory, setSelectedDirectory] = useState(''); const [creating, setCreating] = useState<CreatingEntry>(); const picker = useRef<HTMLInputElement>(null)
  useEffect(() => { if (props.cwd) { try { setExpanded(new Set(JSON.parse(localStorage.getItem(`dvw:tree:${props.cwd}`) ?? '[]') as string[])) } catch { setExpanded(new Set()) } } }, [props.cwd])
  useEffect(() => { if (props.cwd) localStorage.setItem(`dvw:tree:${props.cwd}`, JSON.stringify([...expanded])) }, [props.cwd, expanded])
  const refreshStatus = useCallback(() => {
    void api<GitStatus>('git.status', { sessionId: props.sessionId })
      .then(status => setStatuses(new Map(status.changes.map(change => [change.path, gitStatusCode(change)]))))
      .catch(() => setStatuses(new Map()))
  }, [props.sessionId])
  const refreshStatusDebounced = useDebouncedCallback(refreshStatus, 500)
  useEffect(() => { refreshStatus(); const handler = () => refreshStatusDebounced(); window.addEventListener('dvw-files-changed', handler); return () => window.removeEventListener('dvw-files-changed', handler) }, [refreshStatus, refreshStatusDebounced])
  const startCreating = (kind: 'file' | 'directory') => { const directory = selectedDirectory; if (directory) setExpanded(current => new Set(current).add(directory)); setCreating({ kind, directory, value: '' }) }
  const submitCreating = async () => { if (creating === undefined) return; const value = creating.value.trim(); if (value === '') { setCreating(current => current && ({ ...current, error: '请输入名称' })); return } const path = createdEntryPath(creating.directory, value); try { await api('fs.create', { sessionId: props.sessionId, path, kind: creating.kind }); const created = path; setCreating(undefined); setSelectedDirectory(creating.kind === 'directory' ? created : creating.directory); setRevision(x => x + 1); window.dispatchEvent(new Event('dvw-files-changed')) } catch (error) { setCreating(current => current && ({ ...current, error: error instanceof Error ? error.message : String(error) })) } }
  const upload = useCallback(async (directory: string, files: FileList) => { try { await Promise.all([...files].map(async file => { const query = new URLSearchParams({ sessionId: props.sessionId, directory, name: file.name }); const response = await fetch(`/dsh-vscode/upload?${query}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file }); const answer = await response.json() as { ok: boolean; error?: { message?: string } }; if (!response.ok || !answer.ok) throw new Error(answer.error?.message ?? 'upload failed') })); setRevision(value => value + 1); window.dispatchEvent(new Event('dvw-files-changed')) } catch (error) { alert(error instanceof Error ? error.message : String(error)) } }, [props.sessionId])
  useEffect(() => {
    let activeTarget: HTMLElement | undefined
    const filesDragged = (event: globalThis.DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const targetDirectory = (event: globalThis.DragEvent) => event.target instanceof Element ? event.target.closest<HTMLElement>('[data-dvw-upload-directory]') : null
    const clearTarget = () => { activeTarget?.removeAttribute('data-dvw-native-drop-target'); activeTarget = undefined }
    const intercept = (event: globalThis.DragEvent) => {
      if (!filesDragged(event)) return
      const target = targetDirectory(event)
      if (!target) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type === 'dragleave') { if (!(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) clearTarget(); return }
      clearTarget(); activeTarget = target; target.dataset.dvwNativeDropTarget = 'true'
      if (event.type === 'drop' && event.dataTransfer?.files.length) {
        const files = event.dataTransfer.files
        clearTarget()
        window.dispatchEvent(new CustomEvent('dvw-upload-files', { detail: { directory: target.dataset.dvwUploadDirectory ?? '', files } }))
      }
    }
    document.addEventListener('dragenter', intercept, true)
    document.addEventListener('dragover', intercept, true)
    document.addEventListener('dragleave', intercept, true)
    document.addEventListener('drop', intercept, true)
    const uploadFiles = (event: Event) => { const detail = (event as CustomEvent<{ directory: string; files: FileList }>).detail; if (detail?.files?.length) void upload(detail.directory, detail.files) }
    window.addEventListener('dvw-upload-files', uploadFiles)
    return () => { clearTarget(); document.removeEventListener('dragenter', intercept, true); document.removeEventListener('dragover', intercept, true); document.removeEventListener('dragleave', intercept, true); document.removeEventListener('drop', intercept, true); window.removeEventListener('dvw-upload-files', uploadFiles) }
  }, [upload])
  const drop = (event: DragEvent) => { event.preventDefault(); setDropTarget(false); if (event.dataTransfer.files.length > 0) void upload('', event.dataTransfer.files) }
  const destination = uploadDestination(selectedDirectory)
  const treeDrag = (event: DragEvent) => { if (entryDragOver(event, '', event.currentTarget as HTMLElement)) return; if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); setDropTarget(true) } }
  return <><div className="dvw-side-head">资源管理器<div className="dvw-toolbar"><input ref={picker} className="dvw-file-picker" type="file" accept="*/*" multiple onChange={event => { if (event.currentTarget.files) void upload(destination, event.currentTarget.files); event.currentTarget.value = '' }}/><button className="dvw-icon" title={`上传文件到 ${destination || '工作区根目录'}`} onClick={() => picker.current?.click()}><Icon name="cloud-upload"/></button><button className="dvw-icon" title="新建文件" onClick={() => startCreating('file')}><Icon name="new-file"/></button><button className="dvw-icon" title="新建文件夹" onClick={() => startCreating('directory')}><Icon name="new-folder"/></button><button className="dvw-icon" title="刷新" onClick={() => { setRevision(x => x + 1); window.dispatchEvent(new Event('dvw-files-changed')) }}><Icon name="refresh"/></button></div></div><div className="dvw-tree" tabIndex={-1} data-dvw-upload-directory="" data-drop-target={dropTarget} key={revision} onKeyDown={event => { if (!isAddToDshShortcut(event.nativeEvent) || lastEntry.current === undefined) return; event.preventDefault(); props.onAddToDsh(lastEntry.current.path, lastEntry.current.directory) }} onDragEnter={treeDrag} onDragOver={treeDrag} onDragLeave={event => { setDropTarget(false); if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) clearMoveTarget() }} onDrop={event => { if (draggedEntry !== undefined) { void dropEntry(event, props.sessionId, '', () => setRevision(x => x + 1)); return } drop(event) }}><Tree sessionId={props.sessionId} path="" depth={0} expanded={expanded} selected={props.selected} selectedDirectory={selectedDirectory} statuses={statuses} onToggle={path => setExpanded(current => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next })} onSelectDirectory={path => { lastEntry.current = { path, directory: true }; setSelectedDirectory(path) }} onOpen={path => { lastEntry.current = { path, directory: false }; props.onOpen(path) }} onAddToDsh={props.onAddToDsh} onChange={() => setRevision(x => x + 1)} onUpload={(directory, files) => void upload(directory, files)} creating={creating} onCreatingChange={value => setCreating(current => current && ({ ...current, value, error: undefined }))} onCreatingCancel={() => setCreating(undefined)} onCreatingSubmit={() => void submitCreating()} /></div></>
}

/** Return the workspace-relative directory used by the file picker. */
export function uploadDestination(selectedDirectory?: string): string { return selectedDirectory ?? '' }

/** Join an inline-created entry name to the currently selected Explorer directory. */
export function createdEntryPath(directory: string, name: string): string { return directory ? `${directory}/${name}` : name }

const BINARY_DIFF_FILE = /\.(?:pdf|docx?|odt|xlsx?|ods|pptx?|odp|zip|7z|rar|gz|tgz|bz2|xz|tar|exe|dll|so|dylib|bin|class|jar|war|wasm|o|obj|lib|a|pdb|woff2?|ttf|otf|eot|mp3|m4a|mp4|wav|flac|ogg|mkv|mov|avi|webm|png|jpe?g|gif|bmp|webp|avif|ico|tiff?|pyc|db|sqlite3?|icns)$/i

/** Git prints many PDFs and archives as a text patch, so classify binary diffs by extension instead. */
export function isBinaryDiffPath(path: string): boolean { return BINARY_DIFF_FILE.test(path) }

const IMAGE_PREVIEW_FILE = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i

/** Files the workbench can show as a document or image preview, which Git changes should open directly. */
export function isPreviewDocumentPath(path: string): boolean { return documentPreviewKind(path) !== undefined || IMAGE_PREVIEW_FILE.test(path) }

/** Replace the final path component while preserving its workspace-relative directory. */
export function renamedPath(path: string, name: string): string { return [...path.split('/').slice(0, -1), name].filter(Boolean).join('/') }

function gitStatusCode(change: GitChange): string {
  if (change.untracked) return 'A'
  const code = change.worktree !== '.' ? change.worktree : change.index
  return code === '?' ? 'A' : code
}

function MarkdownOutline({headings,onClose,onHeading}:{headings:MarkdownHeading[];onClose():void;onHeading(index:number):void}) {
  return <aside className="dvw-outline dvw-editor-outline"><div className="dvw-outline-head"><span><Icon name="list-tree"/> 大纲</span><button className="dvw-icon" title="关闭大纲" onClick={onClose}><Icon name="close"/></button></div><div className="dvw-outline-list">{headings.map(heading=><button className="dvw-outline-item" key={heading.index} style={{paddingLeft:8+(heading.depth-1)*13}} onClick={()=>onHeading(heading.index)}>{heading.text}</button>)}</div></aside>
}

function Search(props: { sessionId: string; onOpen(path: string, line: number, column: number, match: string): void }) {
  const [query, setQuery] = useState(''); const [include, setInclude] = useState(''); const [exclude, setExclude] = useState(''); const [flags, setFlags] = useState({ caseSensitive: false, wholeWord: false, regex: false }); const [matches, setMatches] = useState<SearchMatch[]>([]); const [limited, setLimited] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>()
  const pending = useRef<AbortController>()
  useEffect(() => () => pending.current?.abort(), [])
  const search = async () => { pending.current?.abort(); const controller = new AbortController(); pending.current = controller; setBusy(true); setError(undefined); try { const result = await api<{ matches: SearchMatch[]; limited: boolean }>('search', { sessionId: props.sessionId, query, include, exclude, ...flags }, controller.signal); setMatches(result.matches); setLimited(result.limited) } catch (error) { if (!controller.signal.aborted) setError(String(error)) } finally { if (pending.current === controller) setBusy(false) } }
  const groups = useMemo(() => {
    const grouped = new Map<string, SearchMatch[]>()
    for (const match of matches) grouped.set(match.path, [...(grouped.get(match.path) ?? []), match])
    return grouped
  }, [matches])
  return <><div className="dvw-side-head">搜索</div><form className="dvw-search-form" onSubmit={event => { event.preventDefault(); void search() }}><input className="dvw-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索" autoFocus/><div className="dvw-options">{([['caseSensitive','Aa'],['wholeWord','Ab'],['regex','.*']] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={flags[key]} onChange={e => setFlags({ ...flags, [key]: e.target.checked })}/>{label}</label>)}<button className="dvw-icon" title="搜索" disabled={busy}><Icon name="search"/></button></div><input className="dvw-input" value={include} onChange={e=>setInclude(e.target.value)} placeholder="包含文件，例如 src/**"/><input className="dvw-input" value={exclude} onChange={e=>setExclude(e.target.value)} placeholder="排除文件，例如 **/*.test.ts"/></form>{error&&<div className="dvw-error">{error}</div>}{limited&&<div className="dvw-message">结果已截断到 2000 条</div>}<div className="dvw-results">{[...groups].map(([path, rows]) => <div key={path}><div className="dvw-result-file"><Icon name="chevron-down"/> {path} <span className="dvw-badge">{rows.length}</span></div>{rows.map((row,index)=><div className="dvw-result" key={`${row.line}:${row.column}:${index}`} onClick={()=>props.onOpen(path,row.line,row.column,row.match||query)}><span className="dvw-line">{row.line}</span><span className="dvw-preview">{row.preview}</span></div>)}</div>)}</div></>
}

export interface GraphTrack { hash: string; color: number }
export interface GraphRow { commit: GitCommit; lane: number; before: GraphTrack[]; after: GraphTrack[]; parentLanes: number[] }
export function graphRows(commits: GitCommit[]): GraphRow[] {
  const visible = new Set(commits.map(commit => commit.hash))
  let nextColor = 0
  let lanes: GraphTrack[] = commits[0] ? [{ hash: commits[0].hash, color: nextColor++ }] : []
  return commits.map(commit => {
    let lane = lanes.findIndex(track => track.hash === commit.hash)
    if (lane < 0) { lanes = [{ hash: commit.hash, color: nextColor++ }, ...lanes]; lane = 0 }
    const before = [...lanes]
    const current = before[lane]!
    const after = before.filter(track => track.hash !== commit.hash)
    const parents = commit.parents.filter(parent => visible.has(parent))
    parents.forEach((parent, index) => {
      if (after.some(track => track.hash === parent)) return
      const color = index === 0 ? current.color : nextColor++
      after.splice(Math.min(lane + index, after.length), 0, { hash: parent, color })
    })
    const parentLanes = parents.map(parent => after.findIndex(track => track.hash === parent)).filter(index => index >= 0)
    lanes = after
    return { commit, lane, before, after, parentLanes }
  })
}

// VS Code SCM graph geometry: 11px swimlanes, lane-width arcs into and out of the node, 5px lane-shift curves.
const GRAPH_LANE = 11
const GRAPH_CURVE = 5
const GRAPH_HEIGHT = 38
const GRAPH_MID = GRAPH_HEIGHT / 2
const GRAPH_COLORS = ['var(--dvw-graph-ref)','#ffb000','#dc267f','#994f00','#40b0a6','#b66dff']
function graphColor(color:number):string{return GRAPH_COLORS[color%GRAPH_COLORS.length]!}
function graphX(lane:number):number{return GRAPH_LANE*(lane+1)}
function graphWidth(row:GraphRow):number{return GRAPH_LANE*(Math.max(row.before.length,row.after.length,row.lane+1,1)+1)}

/** Move a passing lane to its new column with two 5px arcs around the row midline. */
export function graphTrackPath(from: number, to: number, startY: number, endY: number, bendY: number): string {
  if (from === to) return `M ${from} ${startY} V ${endY}`
  const direction = Math.sign(to - from)
  const radius = Math.min(GRAPH_CURVE, Math.abs(to - from) / 2, Math.abs(bendY - startY), Math.abs(endY - bendY))
  const sweep = direction < 0 ? 1 : 0
  return `M ${from} ${startY} V ${bendY - radius} A ${radius} ${radius} 0 0 ${sweep} ${from + direction * radius} ${bendY} H ${to - direction * radius} A ${radius} ${radius} 0 0 ${1 - sweep} ${to} ${bendY + radius} V ${endY}`
}

/** Leave the node horizontally and turn down into a parent lane with a lane-width arc. */
export function graphParentPath(from: number, to: number, midY: number, endY: number): string {
  if (from === to) return `M ${from} ${midY} V ${endY}`
  const direction = Math.sign(to - from)
  return `M ${from} ${midY} H ${to - direction * GRAPH_LANE} A ${GRAPH_LANE} ${GRAPH_LANE} 0 0 ${direction > 0 ? 1 : 0} ${to} ${midY + GRAPH_LANE} V ${endY}`
}

function GraphNode({row,x,color}:{row:GraphRow;x:number;color:string}) {
  if(row.commit.refs.some(ref=>ref==='HEAD'||ref.startsWith('HEAD ->')))return <><circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="7" style={{fill:color}}/><circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="2" strokeWidth="4"/></>
  if(row.commit.parents.length>1)return <><circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="6" style={{fill:color}}/><circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="3" style={{fill:color}}/></>
  return <circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="5" style={{fill:color}}/>
}

function GraphTracks({row}:{row:GraphRow}) {
  const width=graphWidth(row);const x=graphX(row.lane);const current=row.before[row.lane]!
  return <svg className="dvw-graph-svg" width={width} height={GRAPH_HEIGHT} viewBox={`0 0 ${width} ${GRAPH_HEIGHT}`} aria-hidden="true">
    {row.before.map((track,lane)=>{if(track.hash===row.commit.hash)return null;const target=row.after.findIndex(next=>next.hash===track.hash);const nextLane=target>=0?target:lane;return <path className="dvw-graph-line" key={`continue-${track.hash}`} d={graphTrackPath(graphX(lane),graphX(nextLane),0,GRAPH_HEIGHT,GRAPH_MID)} style={{stroke:graphColor(track.color)}}/>})}
    <path className="dvw-graph-line" d={`M ${x} 0 V ${GRAPH_MID}`} style={{stroke:graphColor(current.color)}}/>
    {row.parentLanes.map((parent,index)=>{const track=row.after[parent]!;return <path className="dvw-graph-line" key={`parent-${track.hash}-${index}`} d={graphParentPath(x,graphX(parent),GRAPH_MID,GRAPH_HEIGHT)} style={{stroke:graphColor(track.color)}}/>})}
    <GraphNode row={row} x={x} color={graphColor(current.color)}/>
  </svg>
}

function GraphContinuation({row}:{row:GraphRow}) {
  const width=graphWidth(row)
  return <svg className="dvw-graph-continuation" width={width} height="100%" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true">{row.after.map((track,lane)=><line className="dvw-graph-line" key={track.hash} x1={graphX(lane)} y1="0" x2={graphX(lane)} y2="100" style={{stroke:graphColor(track.color)}}/>)}</svg>
}

function CommitGraph({ commits, expanded, files, onToggle, onOpenFile }: { commits: GitCommit[]; expanded?: string; files: Map<string,GitCommitFile[]>; onToggle(commit:GitCommit):void; onOpenFile(commit:GitCommit,file:GitCommitFile):void }) {
  return <div className="dvw-graph-list">{graphRows(commits).map(row => {
    const opened=expanded===row.commit.hash
    return <div className="dvw-graph-entry" data-expanded={opened} key={row.commit.hash}>
      <button className="dvw-graph-row" aria-expanded={opened} onClick={()=>onToggle(row.commit)} title={`${row.commit.hash}\n${row.commit.author}`}><GraphTracks row={row}/><span className="dvw-graph-copy"><span className="dvw-graph-subject">{row.commit.subject}</span><span className="dvw-graph-meta">{row.commit.author} · {new Date(row.commit.date).toLocaleDateString()}</span></span>{row.commit.refs.slice(0,2).map(ref=><span className="dvw-ref" key={ref}>{ref}</span>)}<Icon name={opened?'chevron-down':'chevron-right'}/></button>
      {opened&&<div className="dvw-commit-files" style={{paddingLeft:graphWidth(row)+7}}><GraphContinuation row={row}/><div className="dvw-commit-file-list">{(files.get(row.commit.hash)??[]).map(file=><button className="dvw-commit-file" key={`${file.status}:${file.path}`} onClick={()=>onOpenFile(row.commit,file)}><FileIcon name={file.path.split('/').at(-1) ?? file.path} className="dvw-file-icon"/><span className="dvw-commit-file-name">{file.path.split('/').at(-1)}</span><span className="dvw-commit-file-dir">{file.path.split('/').slice(0,-1).join('/')}</span><span className="dvw-badge">{file.status}</span></button>)}</div></div>}
    </div>
  })}</div>
}

function GitGroupHeader({ title, count, expanded, onToggle, children }: { title: string; count: number; expanded: boolean; onToggle(): void; children?: ReactNode }) {
  return <div className="dvw-group-head"><button className="dvw-group-toggle" aria-expanded={expanded} onClick={onToggle}><Icon name={expanded?'chevron-down':'chevron-right'}/><span>{title}</span><span className="dvw-count">{count}</span></button>{children}</div>
}

function Git(props: { sessionId: string; preferences: CommitMessagePreferences; onDiff(key:string, diff:GitDiff, title?:string, sourcePath?:string): void }) {
  const [status, setStatus] = useState<GitStatus>(); const [commits,setCommits]=useState<GitCommit[]>([]); const [message, setMessage] = useState(''); const [error, setError] = useState<string>(); const [busy,setBusy]=useState(false); const [expanded,setExpanded]=useState({staged:true,changes:true,graph:true});const [expandedCommit,setExpandedCommit]=useState<string>();const [commitFileMap,setCommitFileMap]=useState<Map<string,GitCommitFile[]>>(new Map());const [branchMenu,setBranchMenu]=useState(false);const [branches,setBranches]=useState<GitBranch[]>([]);const [newBranch,setNewBranch]=useState('');const [branchError,setBranchError]=useState<string>();const [generating,setGenerating]=useState(false);const [commitMenu,setCommitMenu]=useState(false)
  const refresh = useCallback(() => { void Promise.all([api<GitStatus>('git.status',{sessionId:props.sessionId}),api<GitCommit[]>('git.action',{sessionId:props.sessionId,action:'log'})]).then(([nextStatus,nextCommits])=>{setStatus(nextStatus);setCommits(nextCommits);setError(undefined)}).catch(error=>{setStatus(undefined);setCommits([]);setError(error instanceof ApiError&&error.code==='not-repository'?undefined:String(error))}) }, [props.sessionId])
  const refreshDebounced = useDebouncedCallback(refresh, 500)
  useEffect(refresh,[refresh]); useEffect(()=>{const fn=()=>refreshDebounced();window.addEventListener('dvw-files-changed',fn);return()=>window.removeEventListener('dvw-files-changed',fn)},[refreshDebounced])
  const action = async (name: string, path?: string, value?: string) => { setBusy(true);try { const result = await api<GitStatus | GitDiff>('git.action',{sessionId:props.sessionId,action:name,path,value}); if(name==='diff'&&'diff'in result){const key=path??'';props.onDiff(key,result,key.split('/').at(-1)??key,key)} else {setStatus(result as GitStatus);if(name==='commit')refresh()} } catch(error){setError(String(error))}finally{setBusy(false)} }
  useEffect(()=>{if(!branchMenu)return;const close=()=>setBranchMenu(false);const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape)}},[branchMenu])
  useEffect(()=>{if(!commitMenu)return;const close=()=>setCommitMenu(false);const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape)}},[commitMenu])
  const openBranchMenu=async()=>{if(branchMenu){setBranchMenu(false);return}setBusy(true);try{setBranches(await api<GitBranch[]>('git.action',{sessionId:props.sessionId,action:'branch.list'}));setBranchMenu(true)}catch(error){setError(String(error))}finally{setBusy(false)}}
  const switchBranch=async(name:string)=>{if(name===status?.branch){setBranchMenu(false);return}setBusy(true);try{setStatus(await api<GitStatus>('git.action',{sessionId:props.sessionId,action:'branch.switch',value:name}));setBranchMenu(false);refresh()}catch(error){setError(undefined);setBranchError(branchErrorMessage(error))}finally{setBusy(false)}}
  const createBranch=async()=>{const name=newBranch.trim();if(name==='')return;setBusy(true);try{setStatus(await api<GitStatus>('git.action',{sessionId:props.sessionId,action:'branch.create',value:name}));setNewBranch('');setBranchMenu(false);refresh()}catch(error){setError(undefined);setBranchError(branchErrorMessage(error))}finally{setBusy(false)}}
  const toggleCommit=async(commit:GitCommit)=>{if(expandedCommit===commit.hash){setExpandedCommit(undefined);return}setExpandedCommit(commit.hash);if(commitFileMap.has(commit.hash))return;setBusy(true);try{const files=await api<GitCommitFile[]>('git.action',{sessionId:props.sessionId,action:'commit.files',value:commit.hash});setCommitFileMap(current=>new Map(current).set(commit.hash,files))}catch(error){setError(String(error))}finally{setBusy(false)}}
  const openCommitFile=async(commit:GitCommit,file:GitCommitFile)=>{setBusy(true);try{const result=await api<GitDiff>('git.action',{sessionId:props.sessionId,action:'commit.file.diff',path:file.path,value:commit.hash});props.onDiff(`commit:${commit.hash}:${file.path}`,result,file.path.split('/').at(-1)??file.path,file.path)}catch(error){setError(String(error))}finally{setBusy(false)}}
  const generateMessage=async()=>{if(generating)return;setGenerating(true);setError(undefined);try{const result=await api<{message:string}>('git.commitMessage',{sessionId:props.sessionId,detail:props.preferences.detail,language:props.preferences.language});setMessage(result.message)}catch(error){setError(error instanceof ApiError?error.message:String(error))}finally{setGenerating(false)}}
  const staged=status?.changes.filter(change=>change.index!=='.'&&change.index!=='?')??[]
  const changed=status?.changes.filter(change=>change.worktree!=='.'||change.untracked)??[]
  const renderChange=(change:GitStatus['changes'][number],group:'staged'|'worktree')=><div className="dvw-change" key={`${group}:${change.path}`} onClick={()=>void action('diff',change.path,change.untracked?'untracked':group)}><FileIcon name={change.path.split('/').at(-1) ?? change.path}/><span className="dvw-change-path">{change.path}</span><span className="dvw-badge">{change.untracked?'U':group==='staged'?change.index:change.worktree}</span><button className="dvw-icon" title={group==='staged'?'取消暂存':'暂存更改'} onClick={event=>{event.stopPropagation();void action(group==='staged'?'unstage':'stage',change.path)}}><Icon name={group==='staged'?'remove':'add'}/></button>{group==='worktree'&&<button className="dvw-icon" title="放弃更改" onClick={event=>{event.stopPropagation();if(confirm(`放弃 ${change.path} 的更改？此操作无法撤销。`))void action('discard',change.path,change.untracked?'untracked':undefined)}}><Icon name="discard"/></button>}</div>
  return <>
    <div className="dvw-side-head">源代码管理<div className="dvw-toolbar"><button className="dvw-icon" title="刷新" disabled={busy} onClick={refresh}><Icon name="refresh"/></button></div></div>
    {error&&<div className="dvw-error">{error}</div>}
    {status&&<>
      <div className="dvw-git-head"><button className="dvw-branch" aria-haspopup="menu" aria-expanded={branchMenu} onClick={()=>void openBranchMenu()}><Icon name="git-branch"/> {status.branch} <Icon name="chevron-down" className="dvw-branch-caret"/></button><span>↑{status.ahead} ↓{status.behind}</span>{branchMenu&&<div className="dvw-branch-menu" role="menu" onPointerDown={event=>event.stopPropagation()}><div className="dvw-branch-current">当前分支：{status.branch}</div><div className="dvw-branch-list">{branches.map(branch=><button key={branch.name} role="menuitem" data-active={branch.name===status.branch} disabled={busy||branch.worktree!==undefined} title={branch.worktree!==undefined?`已在 worktree ${branch.worktree} 中检出`:undefined} onClick={()=>void switchBranch(branch.name)}><Icon name={branch.name===status.branch?'check':'git-branch'}/><span>{branch.name}</span>{branch.worktree!==undefined&&<span className="dvw-branch-worktree">worktree</span>}</button>)}</div><div className="dvw-branch-create"><input className="dvw-input" value={newBranch} placeholder="新分支名称" onChange={event=>setNewBranch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void createBranch()}}}/><button className="dvw-icon dvw-branch-create-button" title="创建并切换分支" disabled={busy||!newBranch.trim()} onClick={()=>void createBranch()}><Icon name="add"/></button></div></div>}</div>
      <div className="dvw-commit"><div className="dvw-commit-box"><textarea className="dvw-textarea dvw-commit-input" rows={1} value={message} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&message.trim())void action('commit',undefined,message).then(()=>setMessage(''))}} placeholder={`消息 (${isMacPlatform()?'⌘':'Ctrl+'}Enter 在“${status.branch}”提交)`}/><button className="dvw-commit-ai" disabled={busy||generating||status.changes.length===0} title={generating?'正在生成提交信息':'根据当前更改生成提交信息'} aria-label="生成提交信息" onClick={()=>void generateMessage()}><Icon name="sparkle"/></button></div><div className="dvw-commit-actions"><button className="dvw-commit-button" disabled={busy||!message.trim()||status.changes.length===0} title="提交暂存的更改" onClick={()=>void action('commit',undefined,message).then(()=>setMessage(''))}><Icon name="check"/> 提交</button><button className="dvw-commit-more" disabled={busy||!message.trim()||status.changes.length===0} aria-haspopup="menu" aria-expanded={commitMenu} title="更多提交操作" aria-label="更多提交操作" onClick={()=>setCommitMenu(value=>!value)}><Icon name="chevron-down"/></button>{commitMenu&&<div className="dvw-commit-menu" role="menu" onPointerDown={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>{setCommitMenu(false);void action('commit',undefined,message).then(()=>setMessage(''))}}>提交</button><button role="menuitem" onClick={()=>{setCommitMenu(false);void action('commit.amend',undefined,message).then(()=>setMessage(''))}}>提交（修改）</button><div className="dvw-commit-menu-sep" role="separator"/><button role="menuitem" onClick={()=>{setCommitMenu(false);void action('commit',undefined,message).then(()=>action('push')).then(()=>setMessage(''))}}>提交和推送</button><button role="menuitem" onClick={()=>{setCommitMenu(false);void action('commit',undefined,message).then(()=>action('sync')).then(()=>setMessage(''))}}>提交和同步</button></div>}</div></div>
      <div className="dvw-git">{staged.length>0&&<section><GitGroupHeader title="暂存的更改" count={staged.length} expanded={expanded.staged} onToggle={()=>setExpanded(value=>({...value,staged:!value.staged}))}><button className="dvw-icon" title="取消暂存所有更改" onClick={()=>void action('unstage.all')}><Icon name="remove"/></button></GitGroupHeader>{expanded.staged&&staged.map(change=>renderChange(change,'staged'))}</section>}<section><GitGroupHeader title="更改" count={changed.length} expanded={expanded.changes} onToggle={()=>setExpanded(value=>({...value,changes:!value.changes}))}><button className="dvw-icon" title="放弃所有更改" onClick={()=>{if(confirm('放弃所有已跟踪和未跟踪的更改？此操作无法撤销。'))void action('discard.all')}}><Icon name="discard"/></button><button className="dvw-icon" title="暂存所有更改" onClick={()=>void action('stage.all')}><Icon name="add"/></button></GitGroupHeader>{expanded.changes&&changed.map(change=>renderChange(change,'worktree'))}</section><section className="dvw-graph"><GitGroupHeader title="图表" count={commits.length} expanded={expanded.graph} onToggle={()=>setExpanded(value=>({...value,graph:!value.graph}))}><button className="dvw-icon" title="刷新提交图表" onClick={refresh}><Icon name="refresh"/></button></GitGroupHeader>{expanded.graph&&<CommitGraph commits={commits} expanded={expandedCommit} files={commitFileMap} onToggle={commit=>void toggleCommit(commit)} onOpenFile={(commit,file)=>void openCommitFile(commit,file)}/>}</section></div>
      {branchError!==undefined&&<div className="dvw-confirm-backdrop" role="presentation" onMouseDown={()=>setBranchError(undefined)}><section className="dvw-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dvw-branch-error-title" onMouseDown={event=>event.stopPropagation()}><h2 id="dvw-branch-error-title">无法切换分支</h2><p className="dvw-branch-error-message">{branchError}</p><footer><button autoFocus onClick={()=>setBranchError(undefined)}>确定</button></footer></section></div>}
    </>}
  </>
}

/** Keep range dragging responsive and commit the editor font size after a short pause. */
function FontSizeControl({ value, onChange }: { value: number; onChange(value: number): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onChange(draft), 180)
    return () => clearTimeout(timer)
  }, [draft, value, onChange])
  return <label className="dvw-setting-range"><span>编辑器字体大小</span><input type="range" min="11" max="20" step="1" value={draft} onChange={event=>setDraft(Number(event.target.value))}/><output>{draft}px</output></label>
}

const ExplorerView = memo(Explorer)
const SearchView = memo(Search)
const GitView = memo(Git)

export function Workbench({ service, sessionId, cwd, navigation }: { service: VscodeWorkbench; sessionId?: string; cwd?: string; navigation?: DshNavigation }) {
  const [snapshot, setSnapshot] = useState(() => service.getSnapshot()); const [panels, setPanels] = useState(() => service.getPanels())
  useEffect(() => service.subscribe(() => { setSnapshot(service.getSnapshot()); setPanels(service.getPanels()) }), [service])
  const [workspace,setWorkspace]=useState<{cwd:string;name:string}>(); const [tabs,setTabs]=useState<Tab[]>([]); const [active,setActive]=useState<string>(); const [error,setError]=useState<string>(); const [panelHeight,setPanelHeight]=useState(260); const [sideWidth,setSideWidth]=useState(210); const [primarySideVisible,setPrimarySideVisible]=useState(()=>localStorage.getItem('dvw:primary-side-visible')!=='closed');const [statusVisible,setStatusVisible]=useState(()=>localStorage.getItem('dvw:status-bar-visible')==='open');const [settingsOpen,setSettingsOpen]=useState(false);const [chatWidth,setChatWidth]=useState(()=>clampChatWidth(Number(localStorage.getItem('dvw:dsh-chat-width'))||DSH_CHAT_DEFAULT_WIDTH));const [chatVisible,setChatVisible]=useState(()=>localStorage.getItem('dvw:dsh-chat-visible')!=='closed');const [outlineVisible,setOutlineVisible]=useState(()=>localStorage.getItem('dvw:outline')!=='closed');const [tsIntellisense,setTsIntellisense]=useState(tsIntellisenseEnabled);const [tsIndex,setTsIndex]=useState<{state:'idle'|'loading'|'ready'|'error';files?:number;truncated?:boolean;error?:string}>({state:'idle'});const [lspServers,setLspServers]=useState<LspServerStatus[]>([]);const [lspBusy,setLspBusy]=useState<string>();const [lspError,setLspError]=useState('');const lspManager=useRef<LspManager>();const [fontSize,setFontSize]=useState(()=>{const saved=Math.round(Number(localStorage.getItem('dvw:font-size')));return Number.isFinite(saved)&&saved>=11&&saved<=20?saved:14});const [tabMenu,setTabMenu]=useState<{x:number;y:number;path:string}>()
  const tabsRef=useRef(tabs);tabsRef.current=tabs
  const [settingsSection,setSettingsSection]=useState<'appearance'|'layout'|'commit'|'language'>('appearance')
  const tabListRef=useRef<HTMLDivElement>(null)
  const workspaceRequests=useRef(new WorkspaceRequestScope());const loadedWorkspaceCwd=useRef<string>();const loadingTabs=useRef(new Map<string, symbol>())
  const dshDark = useDshDarkTheme()
  const [theme,setTheme]=useState<WorkbenchTheme>(()=>{const saved=localStorage.getItem('dvw:theme');return saved==='dark'||saved==='light'||saved==='white'||saved==='eyecare'?saved:'dsh'})
  const [markdownView,setMarkdownView]=useState<MarkdownDefaultView>(()=>markdownDefaultView())
  const [commitDetail,setCommitDetail]=useState<CommitDetail>(()=>{const saved=localStorage.getItem('dvw:commit-detail');return saved==='concise'||saved==='detailed'?saved:'standard'})
  const [commitLanguage,setCommitLanguage]=useState<CommitLanguage>(()=>{const saved=localStorage.getItem('dvw:commit-language');return saved==='zh'||saved==='en'?saved:'auto'})
  const colorScheme: 'dark' | 'light' | 'white' | 'eyecare' = theme === 'dsh' ? dshDark ? 'dark' : 'light' : theme
  const commitPreferences=useMemo<CommitMessagePreferences>(()=>({detail:commitDetail,language:commitLanguage}),[commitDetail,commitLanguage])
  useEffect(()=>localStorage.setItem('dvw:theme',theme),[theme])
  useEffect(()=>localStorage.setItem(MARKDOWN_DEFAULT_VIEW_KEY,markdownView),[markdownView])
  useEffect(()=>localStorage.setItem('dvw:commit-detail',commitDetail),[commitDetail])
  useEffect(()=>localStorage.setItem('dvw:commit-language',commitLanguage),[commitLanguage])
  useEffect(()=>{if(!snapshot.visible||theme==='dsh')return;const body=document.body;const root=document.documentElement;const wasDark=body.hasAttribute('data-ds-dark-theme');const previousColorScheme=root.style.colorScheme;body.toggleAttribute('data-ds-dark-theme',theme==='dark');root.style.colorScheme=theme==='dark'?'dark':'light';return()=>{body.toggleAttribute('data-ds-dark-theme',wasDark);if(previousColorScheme==='')root.style.removeProperty('color-scheme');else root.style.colorScheme=previousColorScheme}},[snapshot.visible,theme])
  useEffect(()=>localStorage.setItem('dvw:outline',outlineVisible?'open':'closed'),[outlineVisible])
  useEffect(()=>localStorage.setItem('dvw:dsh-chat-visible',chatVisible?'open':'closed'),[chatVisible])
  useEffect(()=>localStorage.setItem('dvw:dsh-chat-width',String(Math.round(chatWidth))),[chatWidth])
  useEffect(()=>localStorage.setItem('dvw:primary-side-visible',primarySideVisible?'open':'closed'),[primarySideVisible])
  useEffect(()=>localStorage.setItem('dvw:status-bar-visible',statusVisible?'open':'closed'),[statusVisible])
  useEffect(()=>localStorage.setItem('dvw:font-size',String(fontSize)),[fontSize])
  useEffect(()=>{if(tabMenu===undefined)return;const close=()=>setTabMenu(undefined);const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape)}},[tabMenu])
  useEffect(() => {
    if (!snapshot.visible) return
    document.body.setAttribute('data-dvw-workbench-active', '')
    return () => document.body.removeAttribute('data-dvw-workbench-active')
  }, [snapshot.visible])
  useEffect(()=>{if(!snapshot.visible)return;const onKey=(event:KeyboardEvent)=>{if(event.isComposing||!event.ctrlKey||!event.altKey||event.shiftKey||event.code!=='KeyB')return;event.preventDefault();setChatVisible(value=>!value)};window.addEventListener('keydown',onKey,true);return()=>window.removeEventListener('keydown',onKey,true)},[snapshot.visible])
  // The conversation may still be attaching after the chat column opens, so retry for about a second.
  const addToDsh=useCallback((reference:string)=>{setChatVisible(true);let frames=0;const attempt=()=>{void insertIntoDshComposer(reference).then(done=>{if(done)return;if(++frames<60){requestAnimationFrame(attempt);return}alert('DSH 对话输入框当前不可用，请先选择会话或等待当前回复结束。')})};requestAnimationFrame(attempt)},[])
  const addEntryToDsh=useCallback((path:string,directory:boolean)=>addToDsh(dshReference(path,{directory})),[addToDsh])
  const openForWorkspace=(path:string,line?:number,column?:number,highlight?:string)=>{const existing=tabsRef.current.find(tab=>tab.path===path);if(existing)setTabs(rows=>rows.map(tab=>tab.path===path?{...tab,line,column,highlight,preview:line!==undefined?false:tab.preview}:tab));else setTabs(rows=>[...rows,{...unloadedTab(path),line,column,highlight,...(line!==undefined?{preview:false}:{})}]);setActive(path)}
  useEffect(() => {
    if (sessionId === undefined) return
    // Switching sessions inside one workspace must keep the explorer, tabs and layout as they are.
    if (loadedWorkspaceCwd.current !== undefined && loadedWorkspaceCwd.current === cwd) return
    const epoch = workspaceRequests.current.begin()
    const cleared = resetWorkspaceDocuments<Tab>()
    loadingTabs.current.clear(); setWorkspace(undefined); setTabs(cleared.tabs)
    tabsRef.current = cleared.tabs; setActive(cleared.active); setError(cleared.error)
    const controller = new AbortController()
    const load = async () => {
      try {
          const value = await api<{ cwd: string; name: string }>('workspace', { sessionId }, controller.signal)
          if (!workspaceRequests.current.isCurrent(epoch)) return
          setWorkspace(value);loadedWorkspaceCwd.current=value.cwd
          let restored: Tab[] = []
          let selected: string | undefined
          try {
            const parsed = JSON.parse(localStorage.getItem(`dvw:${value.cwd}`) ?? '{}') as { view?: WorkbenchView; paths?: string[]; active?: string; panelHeight?: number; sideWidth?: number }
            if (parsed.view && service.getSnapshot().visible) service.show(parsed.view)
            if (typeof parsed.panelHeight === 'number') setPanelHeight(parsed.panelHeight)
            if (typeof parsed.sideWidth === 'number') setSideWidth(Math.max(210, Math.min(640, Math.round(parsed.sideWidth))))
            restored = restoreTabPaths(parsed.paths ?? []); selected = parsed.active
            const drafts: unknown = JSON.parse(localStorage.getItem(`dvw:drafts:${sessionId}:${value.cwd}`) ?? '[]')
            if (Array.isArray(drafts)) for (const draft of drafts) {
              if (!draft || typeof draft.path !== 'string' || typeof draft.content !== 'string' || typeof draft.draft !== 'string' || typeof draft.revision !== 'string' || draft.path.startsWith('diff:')) continue
              const tab = { ...unloadedTab(draft.path), content: draft.content, draft: draft.draft, revision: draft.revision, dirty: draft.draft !== draft.content, loaded: true }
              restored = [...restored.filter(row => row.path !== tab.path), tab]
            }
          } catch { /* Invalid saved state must not prevent opening the workspace. */ }
          setTabs(restored)
          setActive(restored.some(tab => tab.path === selected) ? selected : restored.at(-1)?.path)
          return
      } catch (error) {
        if (controller.signal.aborted || !workspaceRequests.current.isCurrent(epoch)) return
        setError(String(error))
      }
    }
    void load()
    return () => { controller.abort(); loadingTabs.current.clear(); workspaceRequests.current.invalidate(epoch) }
  }, [sessionId, cwd])
  // Drafts are serialised whole, so typing schedules one write instead of one per
  // keystroke; the pending write is flushed when the page hides or the workbench unmounts.
  const persistWorkspace = useRef<() => void>()
  useEffect(() => {
    if (!workspace || sessionId === undefined) return
    const persist = () => {
      persistWorkspace.current = undefined
      try {
        localStorage.setItem(`dvw:${workspace.cwd}`, JSON.stringify({ view: snapshot.view, paths: tabs.filter(t => !t.path.startsWith('diff:')).map(t => t.path), active, panelHeight, sideWidth }))
        localStorage.setItem(`dvw:drafts:${sessionId}:${workspace.cwd}`, JSON.stringify(tabs.filter(tab => tab.dirty).map(({ path, content, draft, revision }) => ({ path, content, draft, revision }))))
      } catch { setError('无法保存工作区草稿，请在离开页面前保存文件。') }
    }
    persistWorkspace.current = persist
    const timer = setTimeout(persist, 300)
    return () => clearTimeout(timer)
  }, [workspace, sessionId, snapshot.view, tabs, active, panelHeight, sideWidth])
  useEffect(() => {
    const flush = () => persistWorkspace.current?.()
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])
  useEffect(() => {
    if (!snapshot.visible) return
    if (typeof requestIdleCallback !== 'function') { const timer = setTimeout(preloadMonaco, 200); return () => clearTimeout(timer) }
    const handle = requestIdleCallback(preloadMonaco, { timeout: 2000 })
    return () => cancelIdleCallback(handle)
  }, [snapshot.visible])
  const openTabPaths = tabs.filter(tab => !tab.path.startsWith('diff:')).map(tab => tab.path).join('\0')
  useEffect(() => {
    if (workspace !== undefined) retainEditorModels(openTabPaths === '' ? [] : openTabPaths.split('\0').map(path => `${workspace.cwd}/${path}`))
  }, [workspace, openTabPaths])
  const loadTab = useCallback((path: string) => {
    if (sessionId === undefined) return
    const epoch = workspaceRequests.current.current()
    const token = Symbol(path)
    loadingTabs.current.set(path, token)
    const current = () => workspaceRequests.current.isCurrent(epoch) && loadingTabs.current.get(path) === token
    const documentPreview = documentPreviewKind(path)
    const image = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path)
    if (documentPreview !== undefined || image) {
      const url = `/dsh-vscode/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}&v=${Date.now()}`
      setTabs(rows => rows.map(row => row.path === path ? { ...row, loaded: true, ...(image ? { imageUrl: url } : { documentPreview, documentUrl: url }) } : row))
      loadingTabs.current.delete(path); return
    }
    void api<FileDocument>('fs.read', { sessionId, path }).then(doc => {
      if (!current()) return
      if (doc.binary || doc.tooLarge) {
        setTabs(rows => rows.map(row => row.path === path ? { ...row, loaded: true, ...(row.dirty ? {} : { binary: doc.binary, tooLarge: doc.tooLarge }), external: true } : row)); return
      }
      setTabs(rows => rows.map(row => row.path !== path ? row : row.dirty
        ? { ...row, external: row.revision !== doc.revision }
        : { ...row, ...doc, draft: doc.content, loaded: true, external: false }))
    }).catch(error => { if (current()) setError(String(error)) })
      .finally(() => { if (current()) loadingTabs.current.delete(path) })
  }, [sessionId])
  useEffect(() => {
    if (!snapshot.visible || sessionId === undefined || workspace === undefined) return
    const query = new URLSearchParams({ sessionId })
    const url = websocketUrl(`/dsh-vscode/ws/files?${query.toString()}`)
    if (url === undefined) return
    const ws = new WebSocket(url)
    let closed = false
    const refresh = (paths?: string[]) => {
      if (closed) return
      window.dispatchEvent(new CustomEvent('dvw-files-changed', { detail: paths }))
      for (const tab of tabsRef.current) {
        if (tab.path.startsWith('diff:') || tab.loaded === false) continue
        if (paths === undefined || paths.some(path => tab.path === path || tab.path.startsWith(`${path}/`))) loadTab(tab.path)
      }
    }
    ws.onopen = () => refresh()
    ws.onmessage = event => {
      try { const value = JSON.parse(String(event.data)) as { paths?: string[] }; if (Array.isArray(value.paths) && value.paths.every(path => typeof path === 'string')) refresh(value.paths) } catch { /* Ignore invalid notifications. */ }
    }
    return () => { closed = true; ws.close() }
  }, [snapshot.visible, sessionId, workspace, loadTab])
  useEffect(() => {
    if (sessionId === undefined || active === undefined || workspace === undefined) return
    const tab = tabsRef.current.find(row => row.path === active)
    if (tab?.loaded === false && !loadingTabs.current.has(active)) loadTab(active)
  }, [active, sessionId, workspace, tabs, loadTab])
  useEffect(() => {
    const list = tabListRef.current
    const selected = list?.querySelector<HTMLElement>('.dvw-tab[data-active="true"]')
    if (list === null || selected === null || selected === undefined) return
    const listRect = list.getBoundingClientRect()
    const tabRect = selected.getBoundingClientRect()
    list.scrollLeft = tabScrollLeft(list.scrollLeft, listRect, tabRect)
  }, [active, tabs.length])
  const open=(path:string,line?:number,column?:number,highlight?:string)=>{if(sessionId!==undefined)openForWorkspace(path,line,column,highlight)}
  // Stable handlers let the memoised side views skip re-rendering while the editor types.
  const openRef=useRef(open);openRef.current=open
  const openPath=useCallback((path:string,line?:number,column?:number,highlight?:string)=>openRef.current(path,line,column,highlight),[])
  const [switcherOpen,setSwitcherOpen]=useState(false);const [switcherChoices,setSwitcherChoices]=useState<WorkspaceChoice[]>([]);const [switcherBusy,setSwitcherBusy]=useState(false);const [switcherError,setSwitcherError]=useState<string>()
  const openSwitcher=useCallback(()=>{setSwitcherError(undefined);setSwitcherChoices(navigation?.choices(sessionId)??[]);setSwitcherOpen(true)},[navigation,sessionId])
  const switchSession=useCallback((id:string)=>{navigation?.openSession(id);setSwitcherOpen(false)},[navigation])
  const enterWorkspace=useCallback((id:string)=>{navigation?.openWorkspace(id);setSwitcherOpen(false)},[navigation])
  const createWorkspace=useCallback(async()=>{
    if(sessionId===undefined)return
    setSwitcherBusy(true);setSwitcherError(undefined)
    try{
      const result=await api<{opened:boolean;workspace?:{id:string}}>('workspace.open',{sessionId})
      if(!result.opened){setSwitcherBusy(false);return}
      const id=result.workspace?.id
      // The client store receives the new workspace asynchronously; wait briefly so "enter" resolves it.
      for(let attempt=0;attempt<12&&navigation!==undefined;attempt++){
        const choices=navigation.choices(sessionId);setSwitcherChoices(choices)
        if(choices.some(choice=>choice.id===id))break
        await new Promise(resolve=>setTimeout(resolve,250))
      }
      if(id!==undefined)navigation?.openWorkspace(id)
      setSwitcherOpen(false)
    }catch(error){setSwitcherError(error instanceof Error?error.message:String(error))}
    finally{setSwitcherBusy(false)}
  },[navigation,sessionId])
  const startLsp=useCallback(async(list:LspServerStatus[])=>{
    if(!snapshot.visible||sessionId===undefined||workspace===undefined)return
    if(!list.some(server=>server.installed)){lspManager.current?.dispose();lspManager.current=undefined;return}
    const monaco=await loadMonaco()
    lspManager.current??=new LspManager(monaco,sessionId,workspace.cwd)
    setLspError((await lspManager.current.sync(list)).join('\n'))
  },[snapshot.visible,sessionId,workspace])
  const refreshLsp=useCallback(async()=>{if(sessionId===undefined)return;try{const list=await api<LspServerStatus[]>('lsp.status',{sessionId});setLspServers(list);await startLsp(list)}catch(error){setLspError(error instanceof Error?error.message:String(error))}},[sessionId,startLsp])
  const changeLsp=useCallback(async(id:string,action:'install'|'uninstall')=>{if(sessionId===undefined)return;setLspBusy(id);setLspError('');try{const list=await api<LspServerStatus[]>(`lsp.${action}`,{sessionId,id});setLspServers(list);await startLsp(list)}catch(error){setLspError(error instanceof Error?error.message:String(error))}finally{setLspBusy(undefined)}},[sessionId,startLsp])
  useEffect(()=>{if(!snapshot.visible||sessionId===undefined||workspace===undefined)return;void refreshLsp()},[snapshot.visible,sessionId,workspace,refreshLsp])
  // Opening the language panel re-probes the machine; there is no manual "re-detect" button to click.
  useEffect(()=>{if(settingsOpen&&settingsSection==='language')void refreshLsp()},[settingsOpen,settingsSection,refreshLsp])
  useEffect(()=>()=>{lspManager.current?.dispose()},[])
  useEffect(()=>{try{localStorage.setItem(TS_INTELLISENSE_KEY,tsIntellisense?'on':'off')}catch{}},[tsIntellisense])
  // Definition and reference jumps land in workbench tabs for every language, including LSP servers
  // that are independent of Monaco's built-in TypeScript index.
  useEffect(()=>{
    if(!snapshot.visible||sessionId===undefined||workspace===undefined)return
    let cancelled=false;let disposable:{dispose():void}|undefined
    void loadMonaco().then(monaco=>{
      if(cancelled)return
      const cwd=workspace.cwd
      disposable=monaco.editor.registerEditorOpener({openCodeEditor:(_source,resource,selection)=>{const path=workspacePathFromModel(cwd,resource.toString());if(path===undefined)return false;const position=selection===undefined?undefined:'startLineNumber' in selection?{line:selection.startLineNumber,column:selection.startColumn}:{line:selection.lineNumber,column:selection.column};openPath(path,position?.line,position?.column);return true}})
    })
    return()=>{cancelled=true;disposable?.dispose()}
  },[snapshot.visible,sessionId,workspace,openPath])
  useEffect(()=>{
    if(!snapshot.visible||sessionId===undefined||workspace===undefined)return
    // Not installed: never load Monaco just for this, only release an index a previous install built.
    if(!tsIntellisense){if(window.monaco!==undefined)disposeTypeScriptProject(window.monaco);setTsIndex({state:'idle'});return}
    let cancelled=false;const cwd=workspace.cwd;const disposables:{dispose():void}[]=[]
    void loadMonaco().then(monaco=>{
      if(cancelled)return
      setTsIndex({state:'loading'})
      const changed=(event:Event)=>{const paths=(event as CustomEvent<string[]|undefined>).detail;if(Array.isArray(paths))void refreshIndexedFiles(monaco,sessionId,cwd,paths)}
      window.addEventListener('dvw-files-changed',changed);disposables.push({dispose:()=>window.removeEventListener('dvw-files-changed',changed)})
      void indexTypeScriptProject(monaco,sessionId,cwd).then(result=>{if(!cancelled)setTsIndex({state:'ready',...result})}).catch(error=>{if(!cancelled)setTsIndex({state:'error',error:error instanceof Error?error.message:String(error)})})
    })
    return()=>{cancelled=true;for(const disposable of disposables)disposable.dispose()}
  },[snapshot.visible,sessionId,workspace,tsIntellisense])
  const openDiff=useCallback((path:string,diff:GitDiff,title?:string,diffSourcePath?:string)=>{const key=`diff:${path}`;const source=diffSourcePath??path;// Previewable documents open like VS Code's PDF/Office editors; history diffs keep the binary notice.
    if(isPreviewDocumentPath(source)&&!path.startsWith('commit:')){openPath(source);return}const binary=isBinaryDiffPath(source);setTabs(rows=>[...rows.filter(row=>row.path!==key),{path:key,title,content:diff.diff,draft:diff.diff,revision:'',size:diff.diff.length,binary,tooLarge:false,dirty:false,diff:binary?undefined:diff,diffMode:'inline',diffSourcePath:source}]);setActive(key)},[openPath])
  useEffect(()=>{const listener=(event:Event)=>void open((event as CustomEvent<string>).detail);window.addEventListener('dvw-open-workspace-path',listener);return()=>window.removeEventListener('dvw-open-workspace-path',listener)},[sessionId,tabs])
  const savingTabs = useRef(new Set<string>())
  const save = async (tab: Tab) => {
    if (sessionId === undefined || !tab.dirty || savingTabs.current.has(tab.path)) return
    const epoch = workspaceRequests.current.current()
    savingTabs.current.add(tab.path)
    loadingTabs.current.delete(tab.path)
    try {
      const doc = await api<FileDocument>('fs.save', { sessionId, path: tab.path, content: tab.draft, revision: tab.revision })
      if (!workspaceRequests.current.isCurrent(epoch)) return
      loadingTabs.current.delete(tab.path)
      setTabs(rows => rows.map(row => row.path === tab.path && row.instance === tab.instance ? { ...row, ...doc, draft: row.draft, dirty: row.draft !== doc.content, external: false } : row))
    } catch (error) { if (workspaceRequests.current.isCurrent(epoch)) setError(String(error)) }
    finally { savingTabs.current.delete(tab.path) }
  }
  const close=(tab:Tab)=>{if(tab.dirty&&!confirm(`${tab.path} 有未保存更改，确定关闭？`))return;loadingTabs.current.delete(tab.path);setTabs(rows=>rows.filter(row=>row.path!==tab.path));if(active===tab.path)setActive(tabs.filter(row=>row.path!==tab.path).at(-1)?.path)}
  const closeAll=()=>{const dirty=tabs.filter(tab=>tab.dirty);if(dirty.length>0&&!confirm(`有 ${dirty.length} 个文件包含未保存更改，确定全部关闭？`))return;loadingTabs.current.clear();setTabs([]);setActive(undefined);setError(undefined);setTabMenu(undefined)}
  const removeTabs=(targets:Tab[],verb:string)=>{if(targets.length===0)return;const dirty=targets.filter(tab=>tab.dirty).length;if(dirty>0&&!confirm(`有 ${dirty} 个文件包含未保存更改，确定${verb}？`))return;const paths=new Set(targets.map(tab=>tab.path));for(const path of paths)loadingTabs.current.delete(path);const remaining=tabsRef.current.filter(tab=>!paths.has(tab.path));setTabs(remaining);if(active!==undefined&&paths.has(active))setActive(remaining.at(-1)?.path);setTabMenu(undefined)}
  const activeTab=tabs.find(tab=>tab.path===active); const Panel=panels.find(panel=>panel.id===snapshot.bottomPanel)?.component; const terminalAvailable=panels.some(panel=>panel.id==='terminal')
  const menuTab=tabMenu===undefined?undefined:tabs.find(tab=>tab.path===tabMenu.path); const menuIndex=menuTab===undefined?-1:tabs.findIndex(tab=>tab.path===menuTab.path); const savedTabs=tabs.filter(tab=>!tab.dirty)
  const selectView=(view:WorkbenchView)=>{if(snapshot.view===view&&primarySideVisible){setPrimarySideVisible(false);return}setPrimarySideVisible(true);service.show(view)}
  const ACTIVITY_IDS=['explorer','search','git','terminal','chat'] as const
  const [activityOrder,setActivityOrder]=useState<string[]>(()=>normalizeActivityOrder(readActivityJSON('dvw:activity-order'),ACTIVITY_IDS))
  const [activityHidden,setActivityHidden]=useState<string[]>(()=>{const value=readActivityJSON('dvw:activity-hidden');return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&(ACTIVITY_IDS as readonly string[]).includes(id)):[]})
  useEffect(()=>localStorage.setItem('dvw:activity-order',JSON.stringify(activityOrder)),[activityOrder])
  useEffect(()=>localStorage.setItem('dvw:activity-hidden',JSON.stringify(activityHidden)),[activityHidden])
  useEffect(()=>{
    if(activityHidden.includes('chat')&&chatVisible)setChatVisible(false)
    if(activityHidden.includes('terminal')&&snapshot.bottomPanel==='terminal')toggleTerminal(service)
    if(primarySideVisible&&(snapshot.view==='explorer'||snapshot.view==='search'||snapshot.view==='git')&&activityHidden.includes(snapshot.view))setPrimarySideVisible(false)
  },[activityHidden])
  const selectHeading=(index:number)=>{if(activeTab===undefined)return;setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:true}:tab));window.setTimeout(()=>window.dispatchEvent(new CustomEvent('dvw-markdown-heading',{detail:index})),50)}
  const suppressAttachmentDrop=(event:DragEvent)=>{if(!event.dataTransfer.types.includes('Files'))return;const target=event.target;const insideTree=target instanceof Element&&target.closest('.dvw-tree')!==null;if(!insideTree){event.preventDefault();event.stopPropagation()}}
  if(!snapshot.visible)return null
  if(sessionId===undefined)return <div className="dvw-overlay" data-dvw-theme={colorScheme} data-dvw-theme-name={theme}><WorkbenchTitlebar/><div className="dvw-empty" style={{gridColumn:'1/4'}}><div>请先选择或创建一个 DSH 会话。<br/><button onClick={()=>service.hide()}>返回 DSH</button></div></div></div>
  const markdown=activeTab!==undefined&&!activeTab.path.startsWith('diff:')&&/\.md$/i.test(activeTab.path)
  const diffMarkdown=activeTab?.diff!==undefined&&/\.md$/i.test(activeTab.diffSourcePath??'')
  const markdownPreview=markdown||(diffMarkdown&&activeTab?.preview===true)
  const headings=markdownPreview&&activeTab?markdownHeadings(activeTab.diff?.modified??activeTab.draft):[]
  return <div className="dvw-overlay" data-dvw-theme={colorScheme} data-dvw-theme-name={theme} data-dvw-chat={chatVisible||undefined} data-dvw-primary-side={primarySideVisible||undefined} data-dvw-status={statusVisible||undefined} data-dvw-bottom-panel={snapshot.bottomPanel||undefined} style={{'--dvw-side-width':`${sideWidth}px`,'--dvw-chat-width':`${chatWidth}px`} as CSSProperties} role="dialog" aria-label="VS Code 工作台" onDragEnterCapture={suppressAttachmentDrop} onDragOverCapture={suppressAttachmentDrop} onDropCapture={suppressAttachmentDrop}>
    <WorkbenchTitlebar name={workspace?.name}/>
    <DshConversationPanel visible={chatVisible&&!settingsOpen} width={chatWidth} statusHeight={statusVisible?30:6}/>
    <DshConversationTheme visible={chatVisible} colorScheme={colorScheme} followDsh={false}/>
    {chatVisible&&<aside className="dvw-chat"><PanelResizer className="dvw-chat-resizer" label="拖动调整 DSH 对话栏宽度" width={chatWidth} min={DSH_CHAT_MIN_WIDTH} max={DSH_CHAT_MAX_WIDTH} defaultWidth={DSH_CHAT_DEFAULT_WIDTH} direction={-1} hideBelow={200} onHide={()=>setChatVisible(false)} onWidth={setChatWidth}/><header className="dvw-chat-head"><span><DshMark/> DSH</span><button className="dvw-icon" title="关闭 DSH 对话栏" onClick={()=>setChatVisible(false)}><Icon name="close"/></button></header><div className="dvw-chat-body"/></aside>}
    {switcherOpen&&<WorkspaceSwitcher choices={switcherChoices} activeSessionId={sessionId} unavailable={navigation?.available===false} busy={switcherBusy} error={switcherError} onCreate={()=>void createWorkspace()} onSwitch={switchSession} onOpenWorkspace={enterWorkspace} onClose={()=>setSwitcherOpen(false)}/>}
    {settingsOpen&&<div className="dvw-settings-backdrop" role="presentation" onMouseDown={()=>setSettingsOpen(false)}>
      <section className="dvw-settings" role="dialog" aria-modal="true" aria-label="工作台设置" onMouseDown={event=>event.stopPropagation()}>
        <header><span><Icon name="settings"/> 工作台设置</span><button className="dvw-icon" title="关闭设置" onClick={()=>setSettingsOpen(false)}><Icon name="close"/></button></header>
        <div className="dvw-settings-body" data-section={settingsSection}>
          <nav className="dvw-settings-nav" aria-label="设置分类">{([['appearance','外观','color-mode'],['layout','布局','layout-sidebar-right'],['commit','提交信息','sparkle'],['language','语言智能','code']] as const).map(([value,label,icon])=><button key={value} data-active={settingsSection===value} onClick={()=>setSettingsSection(value)}><Icon name={icon}/><span>{label}</span></button>)}</nav>
          <section><h3>外观</h3><label>颜色主题</label><div className="dvw-settings-themes">{([['dsh','跟随 DSH'],['dark','深色'],['light','浅色'],['white','纯白'],['eyecare','护眼']] as const).map(([value,label])=><button key={value} data-active={theme===value} onClick={()=>setTheme(value)}><span className={`dvw-theme-swatch ${value}`}/><span>{label}</span>{theme===value&&<Icon name="check"/>}</button>)}</div><FontSizeControl value={fontSize} onChange={setFontSize}/><div className="dvw-setting-choice"><span>Markdown 默认视图</span><div className="dvw-setting-segment">{([['preview','预览'],['source','源码']] as const).map(([value,label])=><button key={value} data-active={markdownView===value} onClick={()=>setMarkdownView(value)}>{label}</button>)}</div></div></section>
          <section><h3>布局</h3><label className="dvw-setting-check"><input type="checkbox" checked={primarySideVisible} onChange={event=>setPrimarySideVisible(event.target.checked)}/><span>显示左侧视图</span></label><label className="dvw-setting-check"><input type="checkbox" checked={chatVisible} onChange={event=>setChatVisible(event.target.checked)}/><span>显示 DSH 对话栏</span></label><label className="dvw-setting-check"><input type="checkbox" checked={statusVisible} onChange={event=>setStatusVisible(event.target.checked)}/><span>显示底部状态栏</span></label><label className="dvw-setting-range"><span>左侧视图宽度</span><input type="range" min="210" max="640" step="1" value={Math.round(sideWidth)} onChange={event=>setSideWidth(Math.round(Number(event.target.value)))}/><output>{sideWidth}px</output></label><label className="dvw-setting-range"><span>DSH 对话栏宽度</span><input type="range" min={DSH_CHAT_MIN_WIDTH} max={DSH_CHAT_MAX_WIDTH} step="1" value={Math.round(chatWidth)} onChange={event=>setChatWidth(clampChatWidth(Number(event.target.value)))}/><output>{chatWidth}px</output></label></section>
          <section><h3>提交信息</h3><div className="dvw-setting-choice"><span>详细程度</span><div className="dvw-setting-segment">{([['concise','简洁'],['standard','标准'],['detailed','详细']] as const).map(([value,label])=><button key={value} data-active={commitDetail===value} onClick={()=>setCommitDetail(value)}>{label}</button>)}</div></div><div className="dvw-setting-choice"><span>语言</span><div className="dvw-setting-segment">{([['auto','跟随最近提交'],['zh','中文'],['en','English']] as const).map(([value,label])=><button key={value} data-active={commitLanguage===value} onClick={()=>setCommitLanguage(value)}>{label}</button>)}</div></div><p className="dvw-setting-hint">详细模式会生成标题和 2–4 条说明；简洁模式限制标题长度，标准模式保持单行约定式提交。</p></section>
          <section><h3>语言智能</h3>
            <div className="dvw-setting-extension"><div><strong>TypeScript / JavaScript</strong><span>内置 · {tsIntellisense ? tsIndex.state === 'loading' ? '正在索引工作区…' : tsIndex.state === 'error' ? `索引失败：${tsIndex.error}` : tsIndex.state === 'ready' ? `已索引 ${tsIndex.files} 个文件${tsIndex.truncated ? '（已达上限）' : ''}` : '已安装，转到定义、查找引用、Peek、补全、签名帮助' : '点击安装'}</span></div><button className={tsIntellisense?undefined:'dvw-primary-button'} onClick={()=>setTsIntellisense(value=>!value)}>{tsIntellisense?'卸载':'安装'}</button></div>
            {lspServers.map(server=><div className="dvw-setting-extension" key={server.id}>
              <div>
                <strong>{server.name}</strong>
                <div className="dvw-lsp-status">
                  <span className="dvw-lsp-chip" data-installed={server.language===undefined||server.language.installed} data-action={server.language!==undefined&&!server.language.installed}>{server.language===undefined?'语言：无需安装':server.language.installed?'语言：已安装':'安装语言'}</span>
                  <span className="dvw-lsp-chip" data-installed={server.installed}>{server.installed?'LSP：已安装':'LSP：未安装'}</span>
                  {!server.installed&&server.hint!==undefined&&<span className="dvw-lsp-hint">{server.hint}</span>}
                </div>
              </div>
              {server.language!==undefined&&!server.language.installed
                ? <button disabled title="先安装语言工具链，再安装 LSP">等待</button>
                : server.installable&&<button disabled={lspBusy===server.id} className={server.installed?undefined:'dvw-primary-button'} onClick={()=>void changeLsp(server.id,server.installed?'uninstall':'install')}>{lspBusy===server.id?'处理中…':server.installed?'卸载 LSP':'安装 LSP'}</button>}
            </div>)}
            <p className="dvw-setting-hint">每种语言使用该生态里最活跃的语言服务器；能自动安装的会装进本插件的私有目录，需要手动安装的会分别检查语言工具链和服务器本身。</p>
            {lspError&&<p className="dvw-setting-hint">{lspError}</p>}
          </section>
        </div>
      </section>
    </div>}
          <ActivityBar
        views={[
          {id:'explorer',label:'资源管理器',icon:<Icon name="files"/>,active:primarySideVisible&&snapshot.view==='explorer',onActivate:()=>selectView('explorer')},
          {id:'search',label:'搜索',icon:<Icon name="search"/>,active:primarySideVisible&&snapshot.view==='search',onActivate:()=>selectView('search')},
          {id:'git',label:'源代码管理',icon:<Icon name="source-control"/>,active:primarySideVisible&&snapshot.view==='git',onActivate:()=>selectView('git')},
          {id:'terminal',label:terminalAvailable?(snapshot.bottomPanel==='terminal'?'隐藏终端':'显示终端'):'终端适配器未安装',icon:<Icon name="terminal"/>,active:snapshot.bottomPanel==='terminal',disabled:!terminalAvailable,onActivate:()=>toggleTerminal(service)},
          {id:'chat',label:chatVisible?'关闭 DSH 对话栏 (Ctrl+Alt+B)':'显示 DSH 对话栏 (Ctrl+Alt+B)',icon:<DshMark size={22}/>,active:chatVisible,onActivate:()=>setChatVisible(value=>!value)},
        ]}
        fixed={[{id:'workspaces',label:'打开工作区 / 切换会话',icon:<Icon name="folder-opened"/>,active:false,onActivate:openSwitcher}]}
        bottom={[
          {id:'home',label:'返回 DSH',icon:<Icon name="home"/>,active:false,onActivate:()=>service.hide()},
          {id:'settings',label:'管理工作台设置',icon:<Icon name="settings"/>,active:settingsOpen,onActivate:()=>setSettingsOpen(true)},
        ]}
        order={activityOrder} hidden={activityHidden}
        onOrderChange={setActivityOrder} onHiddenChange={setActivityHidden}/>
    <aside className="dvw-side" data-side-width={sideWidth}>{snapshot.view==='explorer'&&workspace!==undefined&&<ExplorerView sessionId={sessionId} cwd={workspace.cwd} selected={active} onOpen={openPath} onAddToDsh={addEntryToDsh}/>} {snapshot.view==='search'&&<SearchView sessionId={sessionId} onOpen={openPath}/>} {snapshot.view==='git'&&<GitView sessionId={sessionId} preferences={commitPreferences} onDiff={openDiff}/>}</aside>
    <PanelResizer className="dvw-side-resizer" label="拖动调整源码管理侧边栏宽度" width={sideWidth} min={210} max={640} defaultWidth={210} direction={1} hideBelow={105} onHide={()=>setPrimarySideVisible(false)} onWidth={setSideWidth}/>
    <main className="dvw-main" onDragOver={event => { if (draggedEntry?.kind !== 'file') return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={event => { const entry = draggedEntry; if (entry?.kind !== 'file') return; event.preventDefault(); endEntryDrag(); openPath(entry.path) }}><div className="dvw-tabs" data-empty={tabs.length===0||undefined}><div className="dvw-tab-list" ref={tabListRef}>{tabs.map(tab=><button className="dvw-tab" data-active={tab.path===active} key={tab.path} title={tab.diffSourcePath??tab.path} onClick={()=>setActive(tab.path)} onAuxClick={event=>{if(event.button===1){event.preventDefault();close(tab)}}} onMouseDown={event=>{if(event.button===1)event.preventDefault()}} onContextMenu={event=>{event.preventDefault();setActive(tab.path);setTabMenu({x:event.clientX,y:event.clientY,path:tab.path})}}><FileIcon name={tabLabel(tab)} className="dvw-tab-icon"/><span className="dvw-tab-name">{tab.dirty?'● ':''}{tabLabel(tab)}</span><span className="dvw-tab-close" onClick={event=>{event.stopPropagation();close(tab)}}><Icon name="close"/></span></button>)}</div></div><div className="dvw-editor" data-outline={markdownPreview&&outlineVisible&&headings.length>0}>{error&&<div className="dvw-error"><button className="dvw-icon" onClick={()=>setError(undefined)}><Icon name="close"/></button>{error}</div>}{markdownPreview&&outlineVisible&&headings.length>0&&<MarkdownOutline headings={headings} onClose={()=>setOutlineVisible(false)} onHeading={selectHeading}/>} {markdown&&activeTab&&<div className="dvw-editor-toolbar"><button className="dvw-icon dvw-outline-toggle" data-active={outlineVisible} title={outlineVisible?'关闭 Markdown 大纲':'显示 Markdown 大纲'} onClick={()=>setOutlineVisible(value=>!value)}><Icon name="list-tree"/></button><button className="dvw-mode-button" data-active={!activeTab.preview} onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:false}:tab))}><Icon name="code"/> 源码</button><button className="dvw-mode-button" data-active={activeTab.preview} onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:true}:tab))}><Icon name="preview"/> 预览</button></div>}{activeTab?.diff&&<div className="dvw-editor-toolbar dvw-diff-toolbar">{diffMarkdown&&<div className="dvw-diff-preview-switch"><button className="dvw-mode-button" data-diff-view="diff" data-active={!activeTab.preview} onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:false}:tab))}><Icon name="diff"/> 差异</button><button className="dvw-mode-button" data-diff-view="preview" data-active={activeTab.preview} onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:true}:tab))}><Icon name="preview"/> 预览</button></div>}{!activeTab.preview&&<><button className="dvw-mode-button dvw-diff-mode-button" data-mode="inline" data-active={activeTab.diffMode!=='split'} title="内联视图" onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,diffMode:'inline'}:tab))}><Icon name="diff-single"/> 内联</button><button className="dvw-mode-button dvw-diff-mode-button" data-mode="split" data-active={activeTab.diffMode==='split'} title="并排视图" onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,diffMode:'split'}:tab))}><Icon name="diff-sidebyside"/> 并排</button></>}</div>}<div className="dvw-editor-body" data-toolbar={markdown||activeTab?.diff!==undefined}>{activeTab===undefined?<div className="dvw-empty"><div><strong>DSH Workbench</strong><br/>从资源管理器或搜索结果打开文件</div></div>:activeTab.diff?diffMarkdown&&activeTab.preview?<MarkdownPreview source={activeTab.diff.modified} sessionId={sessionId} path={activeTab.diffSourcePath??''}/>:<MonacoDiffEditor uri={`${workspace?.cwd??''}/${activeTab.path}`} original={activeTab.diff.original} modified={activeTab.diff.modified} mode={activeTab.diffMode??'inline'} theme={colorScheme} fontSize={fontSize}/>:activeTab.imageUrl?<div className="dvw-image-preview"><img src={activeTab.imageUrl} alt={activeTab.path}/><span>{activeTab.path}</span></div>:activeTab.documentPreview&&activeTab.documentUrl?<DocumentPreview kind={activeTab.documentPreview} src={activeTab.documentUrl} path={activeTab.path}/>:markdown&&activeTab.preview?<MarkdownPreview source={activeTab.draft} sessionId={sessionId} path={activeTab.path}/>:activeTab.binary||activeTab.tooLarge?<div className="dvw-message">{activeTab.binary?'二进制文件无法在文本编辑器或差异视图中打开':`文件超过 5 MiB：${activeTab.path}`}{activeTab.binary&&activeTab.diffSourcePath!==undefined&&!activeTab.path.startsWith('diff:commit:')&&<button onClick={()=>void openPath(activeTab.diffSourcePath!)}>打开文件</button>}</div>:activeTab.loaded===false?<div className="dvw-message">正在加载文件…</div>:<MonacoEditor uri={`${workspace?.cwd??''}/${activeTab.path}`} onAddToDsh={selection=>addToDsh(dshReference(activeTab.path,{selection}))} value={activeTab.draft} theme={colorScheme} fontSize={fontSize} line={activeTab.line} column={activeTab.column} highlight={activeTab.highlight} onChange={draft=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,draft,dirty:draft!==tab.content}:tab))} onSave={()=>void save(activeTab)}/>}</div></div>{snapshot.bottomPanel===undefined&&<div className="dvw-bottom-reveal" title="向上拖动打开终端" onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();service.toggleBottomPanel('terminal');const statusHeight=statusVisible?24:0;const heightAt=(clientY:number)=>Math.max(120,Math.min(window.innerHeight-160,window.innerHeight-clientY-statusHeight));const move=(e:PointerEvent)=>setPanelHeight(heightAt(e.clientY));const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)}}/>}</main>
    {tabMenu&&menuTab&&<div className="dvw-context-menu dvw-tab-menu" role="menu" style={{left:Math.min(tabMenu.x,window.innerWidth-240),top:Math.min(tabMenu.y,window.innerHeight-180)}} onPointerDown={event=>event.stopPropagation()}>
      <button role="menuitem" onClick={()=>{setTabMenu(undefined);close(menuTab)}}>关闭<span>Ctrl+F4</span></button>
      <button role="menuitem" disabled={tabs.length<=1} onClick={()=>removeTabs(tabs.filter(row=>row.path!==menuTab.path),'关闭其他标签页')}>关闭其他</button>
      <button role="menuitem" disabled={menuIndex<0||menuIndex>=tabs.length-1} onClick={()=>removeTabs(tabs.slice(menuIndex+1),'关闭右侧标签页')}>关闭右侧标签页</button>
      <button role="menuitem" disabled={savedTabs.length===0} onClick={()=>removeTabs(savedTabs,'关闭已保存标签页')}>关闭已保存<span>Ctrl+K U</span></button>
      <button role="menuitem" onClick={closeAll}>全部关闭<span>Ctrl+K W</span></button>
    </div>}
    {snapshot.bottomPanel&&<section className="dvw-bottom" style={{height:panelHeight}}><div className="dvw-bottom-resizer" onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();const startY=event.clientY,startHeight=panelHeight;const move=(e:PointerEvent)=>setPanelHeight(Math.max(120,Math.min(window.innerHeight-160,startHeight+startY-e.clientY)));const up=(e:PointerEvent)=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);if(startHeight+startY-e.clientY<80)service.toggleBottomPanel(snapshot.bottomPanel!)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)}}/><div className="dvw-bottom-head"><button className="dvw-bottom-title">{panels.find(p=>p.id===snapshot.bottomPanel)?.title??snapshot.bottomPanel}</button>{snapshot.bottomPanel==='terminal'&&<button className="dvw-icon" title="新建终端" onClick={()=>window.dispatchEvent(new Event('dvw-terminal-new'))}><Icon name="add"/></button>}<button className="dvw-icon" style={{marginLeft:'auto'}} onClick={()=>service.toggleBottomPanel(snapshot.bottomPanel!)}><Icon name="close"/></button></div><div className="dvw-bottom-body">{Panel&&workspace&&<Panel sessionId={sessionId} cwd={workspace.cwd} visible colorScheme={colorScheme}/>}</div></section>}
    <footer className="dvw-status"><span><Icon name="git-branch"/> 工作区</span><span>{workspace?.cwd??cwd??''}</span>{activeTab?.external&&<span>磁盘文件已变化</span>}<button className="dvw-icon" style={{color:'inherit',marginLeft:'auto'}} onClick={()=>service.hide()}>返回 DSH</button></footer>
  </div>
}
