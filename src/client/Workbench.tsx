import { CommitHover } from './CommitHover.tsx'
import { ChangeList, ScmMenu, type ScmCommand } from './ScmMenu.tsx'
import { GitTools, type GitToolsSelection } from './GitTools.tsx'
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { FileDocument, FileEntry, GitBranch, GitChange, GitCommit, GitCommitFile, GitDiff, GitStatus } from '../types.ts'
import { ApiError, api, readApiResponse } from './api.ts'
import { AiReviewController, latestReviewFollowChange, locateReviewChange, type AiReviewSnapshot, type ReviewChange, type ReviewMode } from './aiReview.ts'
import type { VscodeWorkbench, WorkbenchView } from './service.ts'
import { Icon } from './Icon.tsx'
import { SearchView } from './SearchView.tsx'
import { FileIcon } from './FileIcon.tsx'
import { branchErrorMessage, gitActionErrorNotice, noStagedCommitNotice, type GitActionNotice } from './gitError.ts'
import { MarkdownPreview, markdownHeadings } from './MarkdownPreview.tsx'
import type { MarkdownHeading } from './MarkdownPreview.tsx'
import { MonacoDiffEditor, MonacoEditor, type GitDiffStyle, isMacPlatform, loadMonaco, preloadMonaco, retainEditorModels } from './MonacoEditor.tsx'
import { DshConversationPanel, DshConversationTheme, DshReviewActions } from './DshConversationPanel.tsx'
import { DshMark } from './DshMark.tsx'
import { DshPanelPage } from './DshPanelPage.tsx'
import { DshBrowserPage } from './DshBrowserPage.tsx'
import { createLeaf, dropPosition, MAX_PANES, paneCount, normalizeLayout, removeGroup, setRatio, splitAt, type PaneNode, type SplitDirection, type SplitPosition } from './panes.ts'
import { moveTabToGroup, swapActiveTab } from './tabs.ts'
import { debugController } from './debug.ts'
import type { NativeBrowser, BrowserSnapshot } from './browser.ts'
import { dshPanelLabel } from './dshPanels.ts'
import { ActivityBar, normalizeActivityLayout, normalizeActivityOrder, type ActivityView } from './ActivityBar.tsx'
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx'
import { CenteredOpenWith, openExternal } from './OpenWith.tsx'
import type { DshNavigation, WorkspaceChoice } from './dshNavigation.ts'
import { LspManager, type LspServerStatus } from './lsp.ts'
import { TS_INTELLISENSE_KEY, disposeTypeScriptProject, indexTypeScriptProject, refreshIndexedFiles, tsIntellisenseEnabled, typeScriptProjectStatus, workspacePathFromModel } from './typescriptProject.ts'
import { ADD_TO_DSH_SHORTCUT, dshReference, insertIntoDshComposer, isAddToDshShortcut } from './dshComposer.ts'
import { DocumentPreview, documentPreviewKind, type DocumentPreviewKind } from './documentPreview.tsx'
import { toggleTerminal } from './shortcuts.ts'
import { websocketUrl } from './websocket.ts'
import { resetWorkspaceDocuments, WorkspaceRequestScope } from './workspaceState.ts'
import { WorkbenchSettings } from './SettingsPanel.tsx'
import { settingsHost } from './settingsHost.ts'
import { applyFloatGesture, clampFloatRect, defaultFloatRect, FLOAT_BAR_HEIGHT, FLOAT_MAX_KEY, FLOAT_RECT_KEY, readFloatMax, readFloatRect, readOpenMode, writeOpenMode, type FloatGesture, type FloatRect, type WorkbenchOpenMode } from './floatWindow.ts'
import type { CommitDetail, CommitLanguage, CommitMessagePreferences, CommitModelCatalog, CommitModelOption, CommitModelSelection } from '../commit-message.ts'
import { outermostTreeEntries, remapTreeSelectionPaths, selectAllTreePaths, selectTreePath, type TreeSelection } from './treeSelection.ts'

interface Tab extends FileDocument { instance?: symbol; dirty: boolean; draft: string; loaded?: boolean; line?: number; column?: number; highlight?: string; focusOnReveal?: boolean; external?: boolean; preview?: boolean; title?: string; diff?: GitDiff; diffSourcePath?:string; imageUrl?:string; documentPreview?:DocumentPreviewKind; documentUrl?:string }
type GitDiffMode = 'inline' | 'split'
const GIT_DIFF_MODE_KEY = 'dvw:git-diff-mode'
type WorkbenchTheme = 'dsh' | 'dark' | 'light' | 'white' | 'eyecare'
export type MarkdownDefaultView = 'preview' | 'source'
export const MARKDOWN_DEFAULT_VIEW_KEY = 'dvw:markdown-default-view'
export type DefaultBrowser = 'builtin' | 'system'
export const DEFAULT_BROWSER_KEY = 'dvw:default-browser'
/** One independent editor group: its own tabs, its own active tab. */
export interface EditorGroup { id: string; tabs: Tab[]; active?: string }

interface TreeProps {
  sessionId: string
  root: string
  path: string
  depth: number
  expanded: Set<string>
  selected?: string
  selectedPaths: ReadonlySet<string>
  selectedEntries: readonly FileEntry[]
  statuses: Map<string, string>
  onToggle(path: string): void
  onSelect(row: FileEntry, event: ReactMouseEvent<HTMLElement>): void
  onContextSelect(row: FileEntry, event: ReactMouseEvent<HTMLElement>): void
  onDelete(entries: readonly FileEntry[]): void
  onRenamed(oldPath: string, nextPath: string): void
  onOpen(path: string): void
  onChange(): void
  onUpload(directory: string, files: FileList): void
  onAddToDsh(path: string, directory: boolean, selection?: readonly string[]): void
}
interface CreatingEntry { kind: 'file' | 'directory'; directory: string; value: string; error?: string }

type ResizeDirection = 1 | -1

export const DSH_CHAT_MIN_WIDTH = 440
export const DSH_CHAT_MAX_WIDTH = 720
export const DSH_CHAT_DEFAULT_WIDTH = 440

const FLOAT_HANDLES: readonly FloatGesture[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function viewportSize(): { width: number; height: number } {
  return { width: globalThis.innerWidth, height: globalThis.innerHeight }
}

/** Reserve the DSH title bar and macOS traffic lights in a floating window. */
function dshTitlebarHeight(): number {
  if (typeof document === 'undefined') return 48
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dvw-titlebar-height'))
  return Number.isFinite(value) && value >= 0 ? value : 48
}

function persistFloatRect(rect: FloatRect): void {
  try { localStorage.setItem(FLOAT_RECT_KEY, JSON.stringify(rect)) } catch { /* Browser privacy settings may deny storage. */ }
}

function storedValue(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function readStoredCommitModel(): CommitModelSelection | undefined {
  const saved = storedValue('dvw:commit-model')
  if (saved === null) return undefined
  try {
    const value: unknown = JSON.parse(saved)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const { provider, model } = value as Record<string, unknown>
    return typeof provider === 'string' && provider.trim() !== '' && typeof model === 'string' && model.trim() !== ''
      ? { provider: provider.trim(), model: model.trim() }
      : undefined
  } catch { return undefined }
}

function commitModelKey(model: CommitModelSelection): string {
  return JSON.stringify([model.provider, model.model])
}

function persistFloatMax(max: boolean): void {
  try { localStorage.setItem(FLOAT_MAX_KEY, max ? '1' : '0') } catch { /* Browser privacy settings may deny storage. */ }
}

/** Keep persisted or dragged widths inside the range the DSH composer can lay out cleanly. */
export function clampChatWidth(width: number): number {
  if (!Number.isFinite(width)) return DSH_CHAT_DEFAULT_WIDTH
  return Math.max(DSH_CHAT_MIN_WIDTH, Math.min(DSH_CHAT_MAX_WIDTH, Math.round(width)))
}

/** Calculate a panel width from a horizontal pointer movement. */
export function resizedPanelWidth(startWidth: number, startX: number, nextX: number, direction: ResizeDirection, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(startWidth + (nextX - startX) * direction)))
}

function PanelResizer({ className, label, size, min, max, defaultSize, direction, orientation = 'vertical', hideBelow, onHide, onResize }: { className: string; label: string; size: number; min: number; max: number; defaultSize: number; orientation?: 'vertical' | 'horizontal'; direction: ResizeDirection; hideBelow?: number; onHide?(): void; onResize(size: number): void }) {
  const adjustsHeight = orientation === 'horizontal'
  const coordinate = (event: { clientX: number; clientY: number }) => adjustsHeight ? event.clientY : event.clientX
  const decreaseKey = adjustsHeight ? 'ArrowUp' : 'ArrowLeft'
  const increaseKey = adjustsHeight ? 'ArrowDown' : 'ArrowRight'
  const [dragging, setDragging] = useState(false)
  const stopDragging = useRef<() => void>(() => {})
  useEffect(() => () => stopDragging.current(), [])
  const stop = () => stopDragging.current()
  return <div className={className} data-dragging={dragging || undefined} role="separator" aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(size)} tabIndex={0} title={`${label}，双击恢复默认`} onDoubleClick={() => onResize(defaultSize)} onKeyDown={event => {
    if (event.key === 'Home') { event.preventDefault(); onResize(defaultSize); return }
    if (event.key !== decreaseKey && event.key !== increaseKey) return
    event.preventDefault()
    const pointerDelta = event.key === increaseKey ? 10 : -10
    onResize(resizedPanelWidth(size, 0, pointerDelta, direction, min, max))
  }} onPointerDown={event => {
    if (event.button !== 0) return
    event.preventDefault()
    stop()
    const start = coordinate(event)
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = adjustsHeight ? 'ns-resize' : 'ew-resize'
    document.body.style.userSelect = 'none'
    setDragging(true)
    const move = (next: PointerEvent) => onResize(resizedPanelWidth(size, start, coordinate(next), direction, min, max))
    const cleanup = (commit = false, end = start) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setDragging(false)
      stopDragging.current = () => {}
      if (!commit) return
      const nextSize = Math.round(size + (end - start) * direction)
      if (hideBelow !== undefined && nextSize < hideBelow) { onHide?.(); return }
      onResize(Math.max(min, Math.min(max, nextSize)))
    }
    const up = (next: PointerEvent) => cleanup(true, coordinate(next))
    const cancel = () => cleanup()
    stopDragging.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
  }}/>
}

const SCM_SPLIT_KEY = 'dvw:scm-changes-fraction'

function ScmPanes({ split, children: [changes, graph] }: { split: boolean; children: [ReactNode, ReactNode] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [fraction, setFraction] = useState(() => {
    const saved = Number(storedValue(SCM_SPLIT_KEY))
    return saved > 0 && saved < 1 ? saved : 0.5
  })
  useEffect(() => {
    const panes = ref.current!
    const measure = () => setHeight(panes.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(panes)
    return () => observer.disconnect()
  }, [])

  const min = Math.min(124, Math.floor(height / 2))
  const max = height - Math.min(72, Math.floor(height / 2))
  const changesHeight = resizedPanelWidth(height * fraction, 0, 0, 1, min, max)
  const resize = (size: number) => {
    const next = size / height
    setFraction(next)
    try { localStorage.setItem(SCM_SPLIT_KEY, String(next)) } catch { /* Browser privacy settings may deny storage. */ }
  }

  return <div ref={ref} className="dvw-scm-panes" data-split={split} style={split && height > 0 ? { '--dvw-scm-changes-height': `${changesHeight}px` } as CSSProperties : undefined}>
    {changes}
    {split && height > 0 && <PanelResizer className="dvw-scm-resizer" label="拖动调整更改和图表的高度" orientation="horizontal"
      size={changesHeight} min={min} max={max} defaultSize={resizedPanelWidth(height / 2, 0, 0, 1, min, max)} direction={1} onResize={resize}/>}
    {graph}
  </div>
}

/** Read the saved Markdown default without depending on browser storage during unit tests. */
export function markdownDefaultView():MarkdownDefaultView{try{return localStorage.getItem(MARKDOWN_DEFAULT_VIEW_KEY)==='source'?'source':'preview'}catch{return 'preview'}}

function unloadedTab(path:string):Tab{return {instance:Symbol(path),path,content:'',draft:'',revision:'',size:0,binary:false,tooLarge:false,dirty:false,loaded:false,preview:/\.md$/i.test(path)?markdownDefaultView()==='preview':undefined}}

/** A read that never answers used to leave the tab spinning forever with no message. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超过 ${Math.round(ms / 1000)} 秒没有响应；请检查 DSH 宿主是否仍在运行`)), ms)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

function WorkbenchTitlebar({ name }: { name?: string }) {
  return <div className="dvw-titlebar"><strong>DSH Workbench</strong>{name !== undefined && <span>{name}</span>}</div>
}

/** Chrome for the floating layout: drag anywhere except the actions, double-click to toggle real fullscreen. */
function FloatBar({ name, fullscreen, onPointerDown, onToggleFullscreen, onClose }: { name?: string; fullscreen: boolean; onPointerDown(event: React.PointerEvent): void; onToggleFullscreen(): void; onClose(): void }) {
  return <div className="dvw-floatbar" data-dvw-floatbar="" onPointerDown={onPointerDown} onDoubleClick={onToggleFullscreen}>
    <span className="dvw-floatbar-mark"><DshMark size={16}/></span>
    <strong>DSH Workbench</strong>
    {name !== undefined && name !== '' && <span className="dvw-floatbar-name">{name}</span>}
    <div className="dvw-floatbar-actions" onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <button type="button" className="dvw-icon" title={fullscreen?'退出全屏 (Esc)':'进入全屏'} aria-label={fullscreen?'退出全屏':'进入全屏'} aria-pressed={fullscreen} onClick={onToggleFullscreen}><Icon name={fullscreen?'screen-normal':'screen-full'}/></button>
      <button type="button" className="dvw-icon" title="返回 DSH" aria-label="返回 DSH" onClick={onClose}><Icon name="close"/></button>
    </div>
  </div>
}

/** Restore tab headers without reading their file contents. */
export function restoreTabPaths(paths:string[]):Tab[]{return [...new Set(paths)].map(unloadedTab)}

/** Return whether file changes require reloading one visible directory. */
export function directoryAffected(directory:string,changedPaths:string[]):boolean{return changedPaths.some(changed=>{const normalized=changed.replace(/\\/g,'/');const parent=normalized.includes('/')?normalized.slice(0,normalized.lastIndexOf('/')):'';return normalized===directory||parent===directory})}

/** Return the basename shown in a tab while preserving its full internal path. */
export function tabLabel(tab:Pick<Tab,'path'|'title'|'diffSourcePath'>):string{const path=tab.title??tab.diffSourcePath??tab.path.replace(/^diff:/,'');return path.split(/[\\/]/).at(-1)??path}

const ACTIVITY_VIEW_IDS = ['explorer','search','git','debug','terminal','chat'] as const
const ACTIVITY_FIXED_IDS = ['workspaces'] as const
const ACTIVITY_BOTTOM_IDS = ['home','settings'] as const
const ACTIVITY_IDS = [...ACTIVITY_FIXED_IDS, ...ACTIVITY_VIEW_IDS, ...ACTIVITY_BOTTOM_IDS] as const
function readActivityJSON(key: string): unknown { try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] } }
function readActivityOrder(): string[] {
  try {
    const stored = localStorage.getItem('dvw:activity-order-v2')
    if (stored !== null) {
      const value = JSON.parse(stored)
      const saved = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && (ACTIVITY_IDS as readonly string[]).includes(id)) : []
      return normalizeActivityLayout(saved, ACTIVITY_FIXED_IDS, ACTIVITY_VIEW_IDS, ACTIVITY_BOTTOM_IDS)
    }
  } catch {}
  const legacy = normalizeActivityOrder(readActivityJSON('dvw:activity-order'), ACTIVITY_VIEW_IDS)
  return normalizeActivityLayout([...ACTIVITY_FIXED_IDS, ...legacy, ...ACTIVITY_BOTTOM_IDS], ACTIVITY_FIXED_IDS, ACTIVITY_VIEW_IDS, ACTIVITY_BOTTOM_IDS)
}

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

/** Keep an in-flight tab read scoped to the pane that requested it. */
function tabLoadKey(groupId: string, path: string): string { return `${groupId}\0${path}` }

/** Absolute path for an Explorer entry, matching the separator the workspace root already uses. */
export function absoluteEntryPath(root: string, path: string): string {
  const base = root.replace(/[\\/]+$/, '')
  if (path === '') return base
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return `${base}${separator}${path.split('/').join(separator)}`
}

/** Copy through the async clipboard, falling back to the selection trick when the page is not focused. */
async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return } catch { /* fall through */ }
  const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'
  document.body.append(area); area.select()
  try { document.execCommand('copy') } finally { area.remove() }
}

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
const TAB_DRAG_TYPE = 'application/x-dvw-tab'
/** An already-open tab being dragged, with the group it currently lives in. */
let draggedTab: { group: string; path: string } | undefined
function startTabDrag(event: DragEvent, group: string, tab: Tab) {
  // The close button lives inside the draggable tab. Without this, a click that moves by a pixel
  // starts a drag and the click never fires, so closing a tab "sometimes" needed several tries.
  if (event.target instanceof Element && event.target.closest('.dvw-tab-close') !== null) { event.preventDefault(); return }
  draggedTab = { group, path: tab.path }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(TAB_DRAG_TYPE, tab.path)
  event.dataTransfer.setData('text/plain', tab.path)
}
function endTabDrag() { draggedTab = undefined }
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
async function dropEntry(event: DragEvent, sessionId: string, directory: string) {
  const entry = draggedEntry
  if (entry === undefined) return
  event.preventDefault(); event.stopPropagation(); endEntryDrag()
  if (!canMoveTo(entry.path, directory)) return
  const nextPath = movedPath(entry.path, directory)
  try { await api('fs.rename', { sessionId, path: entry.path, nextPath }); window.dispatchEvent(new CustomEvent('dvw-files-changed', { detail: [entry.path, nextPath] })) } catch (error) { alert(error instanceof Error ? error.message : String(error)) }
}

/** Visible paths in render order, including rows from expanded descendant trees. */
function visibleTreePaths(tree: Element | null | undefined): string[] {
  if (!tree) return []
  return [...tree.querySelectorAll<HTMLElement>('[data-tree-path]')]
    .map(row => row.dataset.treePath)
    .filter((path): path is string => path !== undefined && path !== '')
}

/** Rebuild entry metadata from rendered rows for selection-wide context actions. */
function visibleTreeEntries(tree: Element | null | undefined): FileEntry[] {
  if (!tree) return []
  return [...tree.querySelectorAll<HTMLElement>('[data-tree-path][data-tree-kind]')].flatMap(row => {
    const path = row.dataset.treePath
    const kind = row.dataset.treeKind
    if (path === undefined || (kind !== 'file' && kind !== 'directory')) return []
    return [{ path, kind, name: row.dataset.treeName ?? path.split('/').at(-1) ?? path }]
  })
}

function Tree({ sessionId, root, path, depth, expanded, selected, selectedPaths, selectedEntries, statuses, onToggle, onSelect, onContextSelect, onDelete, onRenamed, onOpen, onChange, onUpload, onAddToDsh, creating, onCreatingChange, onCreatingCancel, onCreatingSubmit }: TreeProps & { creating?: CreatingEntry; onCreatingChange(value: string): void; onCreatingCancel(): void; onCreatingSubmit(): void }) {
  const [rows, setRows] = useState<FileEntry[]>([]); const [error, setError] = useState<string>(); const [dropTarget, setDropTarget] = useState(false); const [context, setContext] = useState<{ entry: FileEntry; x: number; y: number }>(); const [renaming, setRenaming] = useState<{ path: string; value: string }>()
  const listing = useRef<AbortController>()
  const load = useCallback(() => {
    listing.current?.abort()
    const controller = listing.current = new AbortController()
    void api<FileEntry[]>('fs.list', { sessionId, path }, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setRows(value); setError(undefined) } })
      .catch(error => { if (!controller.signal.aborted) setError(String(error)) })
  }, [sessionId, path])
  useEffect(() => () => listing.current?.abort(), [load])
  useEffect(load, [load])
  useEffect(() => {
    const handler = (event:Event) => { const paths=(event as CustomEvent<string[]>).detail; if(!Array.isArray(paths)||directoryAffected(path,paths))load() }; window.addEventListener('dvw-files-changed', handler); return () => window.removeEventListener('dvw-files-changed', handler)
  }, [load])
  useEffect(() => { if (context === undefined) return; const close = () => setContext(undefined); const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }; window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape); return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) } }, [context])
  const rename = async (entry: FileEntry) => { const value = renaming?.path === entry.path ? renaming.value.trim() : ''; setRenaming(undefined); if (value === '' || value === entry.name) return; const nextPath = renamedPath(entry.path, value); try { await api('fs.rename', { sessionId, path: entry.path, nextPath }); onRenamed(entry.path, nextPath); onChange() } catch (error) { alert(error instanceof Error ? error.message : String(error)) } }
  const entryDirectory = (row: FileEntry) => row.kind === 'directory' ? row.path : parentPath(row.path)
  // A folder highlights its whole block like VS Code; a file targets its parent folder's block (or the tree root).
  const entryTarget = (event: DragEvent, row: FileEntry) => { const entry = (event.currentTarget as HTMLElement).parentElement; return row.kind === 'directory' ? entry : entry?.parentElement?.closest<HTMLElement>('.dvw-tree-entry,.dvw-tree') }
  const drop = (event: DragEvent, directory: string) => { event.preventDefault(); event.stopPropagation(); setDropTarget(false); if (event.dataTransfer.files.length > 0) onUpload(directory, event.dataTransfer.files) }
  return <>{error && <div className="dvw-error">{error}</div>}{creating?.directory === path && <><div className="dvw-tree-row dvw-tree-create-row" style={{ paddingLeft: 6 + depth * 13 }}><span className="dvw-chevron"/><Icon name={creating.kind === 'directory' ? 'folder' : 'new-file'} className={`dvw-file-icon ${creating.kind === 'directory' ? 'folder' : ''}`}/><input className="dvw-tree-create-input" value={creating.value} autoFocus aria-label={creating.kind === 'directory' ? '新建文件夹名称' : '新建文件名称'} aria-invalid={creating.error !== undefined} placeholder={creating.kind === 'directory' ? '文件夹名称' : '文件名称'} onChange={event => onCreatingChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onCreatingSubmit() } if (event.key === 'Escape') { event.preventDefault(); onCreatingCancel() } }} onBlur={onCreatingCancel}/></div>{creating.error && <div className="dvw-tree-create-error" style={{ paddingLeft: 42 + depth * 13 }}>{creating.error}</div>}</>}{rows.map(row => <div className="dvw-tree-entry" key={row.path}>
    <div className="dvw-tree-row" role="treeitem" aria-selected={selectedPaths.size > 0 ? selectedPaths.has(row.path) : selected === row.path} data-tree-path={row.path} data-tree-kind={row.kind} data-tree-name={row.name} data-dvw-upload-directory={row.kind === 'directory' ? row.path : undefined} data-selected={(selectedPaths.size > 0 ? selectedPaths.has(row.path) : selected === row.path) || undefined} data-drop-target={dropTarget && row.kind === 'directory'} style={{ paddingLeft: 6 + depth * 13 }} onClick={event => onSelect(row, event)} onContextMenu={(event) => { event.preventDefault(); onContextSelect(row, event); setContext({ entry: row, x: event.clientX, y: event.clientY }) }} draggable={renaming?.path !== row.path} onDragStart={event => startEntryDrag(event, sessionId, row)} onDragEnd={endEntryDrag} onDragEnter={event => { if (entryDragOver(event, entryDirectory(row), entryTarget(event, row), row.kind === 'directory' && !expanded.has(row.path) ? () => onToggle(row.path) : undefined)) return; if (row.kind === 'directory' && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); setDropTarget(true) } }} onDragOver={event => { if (entryDragOver(event, entryDirectory(row), entryTarget(event, row))) return; if (row.kind === 'directory' && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); setDropTarget(true) } }} onDragLeave={() => setDropTarget(false)} onDrop={event => { if (draggedEntry !== undefined) { void dropEntry(event, sessionId, entryDirectory(row)); return } if (row.kind === 'directory') drop(event, row.path) }}>
      <span className="dvw-chevron">{row.kind === 'directory' && <Icon name={expanded.has(row.path) ? 'chevron-down' : 'chevron-right'}/>}</span><FileIcon name={row.name} directory={row.kind === 'directory'} expanded={expanded.has(row.path)}/>{renaming?.path === row.path ? <input className="dvw-tree-rename" value={renaming.value} autoFocus onClick={event => event.stopPropagation()} onChange={event => setRenaming({ path: row.path, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') void rename(row); if (event.key === 'Escape') setRenaming(undefined) }} onBlur={() => setRenaming(undefined)}/> : <span className="dvw-tree-name">{row.name}</span>}{row.kind === 'file' && statuses.has(row.path) && <span className="dvw-tree-status" data-status={statuses.get(row.path)}>{statuses.get(row.path)}</span>}
    </div>
    {row.kind === 'directory' && expanded.has(row.path) && <Tree {...{ sessionId, root, path: row.path, depth: depth + 1, expanded, selected, selectedPaths, selectedEntries, statuses, onToggle, onSelect, onContextSelect, onDelete, onRenamed, onOpen, onChange, onUpload, onAddToDsh, creating, onCreatingChange, onCreatingCancel, onCreatingSubmit }} />}
  </div>)}{context && (() => {
    const selectedForContext = selectedPaths.has(context.entry.path)
    const paths = selectedForContext && selectedPaths.size > 0 ? [...selectedPaths] : [context.entry.path]
    const single = paths.length === 1
    return <div className="dvw-context-menu" role="menu" style={{ left: context.x, top: context.y }} onPointerDown={event => event.stopPropagation()}>
      {single && <button role="menuitem" onClick={() => { onAddToDsh(context.entry.path, context.entry.kind === 'directory'); setContext(undefined) }}><DshMark size={14}/>添加到 DSH 对话<kbd>{ADD_TO_DSH_SHORTCUT}</kbd></button>}
      <button role="menuitem" onClick={() => { void copyText(paths.join('\n')); setContext(undefined) }}><Icon name="copy"/>复制{single ? '相对路径' : ` ${paths.length} 个相对路径`}</button>
      <button role="menuitem" onClick={() => { void copyText(paths.map(path => absoluteEntryPath(root, path)).join('\n')); setContext(undefined) }}><Icon name="copy"/>复制{single ? '绝对路径' : ` ${paths.length} 个绝对路径`}</button>
      {single && <button role="menuitem" onClick={() => { void openExternal(sessionId, context.entry.path).catch(error => alert(error instanceof Error ? error.message : String(error))); setContext(undefined) }}><Icon name="link-external"/>用默认应用打开</button>}
      {single && <button role="menuitem" onClick={() => { void openExternal(sessionId, context.entry.path, { reveal: true }).catch(error => alert(error instanceof Error ? error.message : String(error))); setContext(undefined) }}><Icon name="folder-opened"/>显示文件位置</button>}
      {single && <button role="menuitem" onClick={() => { setRenaming({ path: context.entry.path, value: context.entry.name }); setContext(undefined) }}><Icon name="edit"/>重命名</button>}
      <button className="dvw-context-delete" role="menuitem" onClick={() => { onDelete(selectedForContext ? selectedEntries : [context.entry]); setContext(undefined) }}><Icon name="trash"/>删除{selectedForContext && selectedEntries.length > 1 ? ` ${selectedEntries.length} 个项目` : ''}</button>
    </div>
  })()}</>
}

function Explorer(props: { sessionId: string; cwd?: string; selected?: string; onOpen(path: string): void; onAddToDsh(path: string, directory: boolean): void }) {
  // The row the user last clicked, which the Explorer shortcut adds to the DSH chat.
  const lastEntry = useRef<{ path: string; directory: boolean }>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); const [statuses, setStatuses] = useState<Map<string, string>>(new Map()); const [dropTarget, setDropTarget] = useState(false); const [selectedDirectory, setSelectedDirectory] = useState(''); const [creating, setCreating] = useState<CreatingEntry>(); const picker = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<TreeSelection>({ selected: new Set() })
  const [selectionEntries, setSelectionEntries] = useState<Map<string, FileEntry>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<FileEntry[]>()
  useEffect(() => { if (props.cwd) { try { setExpanded(new Set(JSON.parse(localStorage.getItem(`dvw:tree:${props.cwd}`) ?? '[]') as string[])) } catch { setExpanded(new Set()) } } }, [props.cwd])
  useEffect(() => { if (props.cwd) localStorage.setItem(`dvw:tree:${props.cwd}`, JSON.stringify([...expanded])) }, [props.cwd, expanded])
  useEffect(() => {
    setSelection({ selected: new Set() })
    setSelectionEntries(new Map())
    setSelectedDirectory('')
    setPendingDelete(undefined)
    lastEntry.current = undefined
  }, [props.cwd])
  useEffect(() => {
    if (pendingDelete === undefined) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPendingDelete(undefined) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [pendingDelete])
  const refreshStatus = useCallback(() => {
    void api<GitStatus>('git.status', { sessionId: props.sessionId })
      .then(status => setStatuses(new Map(status.changes.map(change => [change.path, gitStatusCode(change)]))))
      .catch(() => setStatuses(new Map()))
  }, [props.sessionId])
  const refreshStatusDebounced = useDebouncedCallback(refreshStatus, 500)
  useEffect(() => { refreshStatus(); const handler = () => refreshStatusDebounced(); window.addEventListener('dvw-files-changed', handler); return () => window.removeEventListener('dvw-files-changed', handler) }, [refreshStatus, refreshStatusDebounced])
  const startCreating = (kind: 'file' | 'directory') => { const directory = selectedDirectory; if (directory) setExpanded(current => new Set(current).add(directory)); setCreating({ kind, directory, value: '' }) }
  const submitCreating = async () => {
    if (creating === undefined) return
    const value = creating.value.trim()
    if (value === '') { setCreating(current => current && ({ ...current, error: '请输入名称' })); return }
    const path = createdEntryPath(creating.directory, value)
    try {
      await api('fs.create', { sessionId: props.sessionId, path, kind: creating.kind })
      const created = path
      setCreating(undefined)
      setSelectedDirectory(creating.kind === 'directory' ? created : creating.directory)
      setSelection({ selected: new Set([created]), anchor: created, focus: created })
      setSelectionEntries(new Map([[created, { path: created, name: value, kind: creating.kind }]]))
      lastEntry.current = { path: created, directory: creating.kind === 'directory' }
      window.dispatchEvent(new Event('dvw-files-changed'))
    } catch (error) {
      setCreating(current => current && ({ ...current, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  const upload = useCallback(async (directory: string, files: FileList) => { try { await Promise.all([...files].map(async file => { const query = new URLSearchParams({ sessionId: props.sessionId, directory, name: file.name }); const response = await fetch(`/dsh-vscode/upload?${query}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file }); await readApiResponse(response, 'upload') })); window.dispatchEvent(new Event('dvw-files-changed')) } catch (error) { alert(error instanceof Error ? error.message : String(error)) } }, [props.sessionId])
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
  const applyTreeSelection = (next: TreeSelection, entries: readonly FileEntry[]) => {
    const known = new Map(selectionEntries)
    for (const entry of entries) if (next.selected.has(entry.path)) known.set(entry.path, entry)
    for (const path of known.keys()) if (!next.selected.has(path)) known.delete(path)
    setSelection(next)
    setSelectionEntries(known)
  }
  const selectRow = (row: FileEntry, event: ReactMouseEvent<HTMLElement>) => {
    const tree = event.currentTarget.closest<HTMLElement>('.dvw-tree')
    const visible = visibleTreePaths(tree)
    const next = selectTreePath(selection, visible, row.path, {
      toggle: event.ctrlKey || event.metaKey,
      extend: event.shiftKey,
    })
    applyTreeSelection(next, visibleTreeEntries(tree))
    lastEntry.current = { path: row.path, directory: row.kind === 'directory' }
    if (row.kind === 'directory') setSelectedDirectory(row.path)
    tree?.focus({ preventScroll: true })

    if (event.ctrlKey || event.metaKey || event.shiftKey) return
    if (row.kind === 'directory') setExpanded(current => {
      const expandedPaths = new Set(current)
      if (expandedPaths.has(row.path)) expandedPaths.delete(row.path)
      else expandedPaths.add(row.path)
      return expandedPaths
    })
    else props.onOpen(row.path)
  }
  const contextSelectRow = (row: FileEntry, event: ReactMouseEvent<HTMLElement>) => {
    const tree = event.currentTarget.closest<HTMLElement>('.dvw-tree')
    if (!selection.selected.has(row.path)) {
      const next = selectTreePath(selection, visibleTreePaths(tree), row.path)
      applyTreeSelection(next, visibleTreeEntries(tree))
    }
    lastEntry.current = { path: row.path, directory: row.kind === 'directory' }
    if (row.kind === 'directory') setSelectedDirectory(row.path)
    tree?.focus({ preventScroll: true })
  }
  const selectedEntries = outermostTreeEntries([...selectionEntries.values()].filter(entry => selection.selected.has(entry.path)))
  const requestDelete = (entries: readonly FileEntry[]) => {
    const next = outermostTreeEntries(entries)
    if (next.length > 0) setPendingDelete(next)
  }
  const renamedSelection = (oldPath: string, nextPath: string) => {
    const remap = (path: string): string => path === oldPath
      ? nextPath
      : path.startsWith(`${oldPath}/`) ? `${nextPath}${path.slice(oldPath.length)}` : path
    setSelection(current => remapTreeSelectionPaths(current, oldPath, nextPath))
    setSelectionEntries(current => new Map([...current].map(([path, entry]) => {
      if (path !== oldPath && !path.startsWith(`${oldPath}/`)) return [path, entry]
      const mapped = remap(path)
      return [mapped, { ...entry, path: mapped, name: mapped.split('/').at(-1) ?? entry.name }]
    })))
    setSelectedDirectory(current => remap(current))
    if (lastEntry.current !== undefined) lastEntry.current = { ...lastEntry.current, path: remap(lastEntry.current.path) }
  }
  const remove = async () => {
    if (pendingDelete === undefined || pendingDelete.length === 0) return
    const entries = pendingDelete
    setPendingDelete(undefined)
    const failed: Array<{ entry: FileEntry; message: string }> = []
    for (const entry of entries) {
      try { await api('fs.delete', { sessionId: props.sessionId, path: entry.path }) }
      catch (error) { failed.push({ entry, message: error instanceof Error ? error.message : String(error) }) }
    }
    const failedPaths = new Set(failed.map(item => item.entry.path))
    setSelection({ selected: failedPaths, anchor: failed[0]?.entry.path, focus: failed.at(-1)?.entry.path })
    setSelectionEntries(new Map(failed.map(item => [item.entry.path, item.entry])))
    lastEntry.current = undefined
    window.dispatchEvent(new Event('dvw-files-changed'))
    if (failed.length > 0) alert(failed.map(item => `${item.entry.path}: ${item.message}`).join('\n'))
  }
  const treeKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable=true]')) return
    const tree = event.currentTarget
    const visible = visibleTreePaths(tree)
    const entries = visibleTreeEntries(tree)
    const command = event.ctrlKey || event.metaKey

    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      applyTreeSelection(selectAllTreePaths(visible), entries)
      return
    }
    if (command && event.key.toLowerCase() === 'c' && selection.selected.size > 0) {
      event.preventDefault()
      void copyText([...selection.selected].join('\n'))
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEntries.length > 0) {
      event.preventDefault()
      requestDelete(selectedEntries)
      return
    }
    if (event.key === 'Escape' && selection.selected.size > 0) {
      event.preventDefault()
      applyTreeSelection({ selected: new Set() }, [])
      return
    }
    if (event.key === 'Enter' && selectedEntries.length === 1) {
      event.preventDefault()
      const entry = selectedEntries[0]!
      if (entry.kind === 'directory') setExpanded(current => {
        const next = new Set(current)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
      else props.onOpen(entry.path)
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && visible.length > 0) {
      const current = selection.focus ?? selection.anchor ?? [...selection.selected].at(-1)
      const currentIndex = current === undefined ? -1 : visible.indexOf(current)
      let targetIndex = currentIndex
      if (event.key === 'Home') targetIndex = 0
      else if (event.key === 'End') targetIndex = visible.length - 1
      else if (event.key === 'ArrowDown') targetIndex = currentIndex < 0 ? 0 : Math.min(visible.length - 1, currentIndex + 1)
      else if (event.key === 'ArrowUp') targetIndex = currentIndex < 0 ? visible.length - 1 : Math.max(0, currentIndex - 1)
      const target = visible[targetIndex]
      if (target !== undefined) {
        event.preventDefault()
        applyTreeSelection(
          selectTreePath(selection, visible, target, { extend: event.shiftKey, toggle: event.shiftKey && command }),
          entries,
        )
        const targetEntry = entries.find(entry => entry.path === target)
        if (targetEntry !== undefined) {
          lastEntry.current = { path: targetEntry.path, directory: targetEntry.kind === 'directory' }
          if (targetEntry.kind === 'directory') setSelectedDirectory(targetEntry.path)
          const targetRow = [...tree.querySelectorAll<HTMLElement>('[data-tree-path]')]
            .find(row => row.dataset.treePath === target)
          targetRow?.scrollIntoView({ block: 'nearest' })
        }
      }
      return
    }
    if (isAddToDshShortcut(event.nativeEvent) && lastEntry.current !== undefined) {
      event.preventDefault()
      props.onAddToDsh(lastEntry.current.path, lastEntry.current.directory)
    }
  }
  return <>
    <div className="dvw-side-head">资源管理器<div className="dvw-toolbar"><input ref={picker} className="dvw-file-picker" type="file" accept="*/*" multiple onChange={event => { if (event.currentTarget.files) void upload(destination, event.currentTarget.files); event.currentTarget.value = '' }}/><button className="dvw-icon" title={`上传文件到 ${destination || '工作区根目录'}`} onClick={() => picker.current?.click()}><Icon name="cloud-upload"/></button><button className="dvw-icon" title="新建文件" onClick={() => startCreating('file')}><Icon name="new-file"/></button><button className="dvw-icon" title="新建文件夹" onClick={() => startCreating('directory')}><Icon name="new-folder"/></button><button className="dvw-icon" title="刷新" onClick={() => { window.dispatchEvent(new Event('dvw-files-changed')) }}><Icon name="refresh"/></button></div></div>
    <div className="dvw-tree" role="tree" aria-multiselectable="true" tabIndex={0} title="Ctrl/⌘ 点击多选，Shift 点击连续选择" data-dvw-upload-directory="" data-drop-target={dropTarget} onKeyDown={treeKeyDown} onDragEnter={treeDrag} onDragOver={treeDrag} onDragLeave={event => { setDropTarget(false); if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) clearMoveTarget() }} onDrop={event => { if (draggedEntry !== undefined) { void dropEntry(event, props.sessionId, ''); return } drop(event) }}>
      <Tree sessionId={props.sessionId} root={props.cwd ?? ''} path="" depth={0} expanded={expanded} selected={props.selected} selectedPaths={selection.selected} selectedEntries={selectedEntries} statuses={statuses} onToggle={path => setExpanded(current => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next })} onSelect={selectRow} onContextSelect={contextSelectRow} onDelete={requestDelete} onRenamed={renamedSelection} onOpen={path => { lastEntry.current = { path, directory: false }; props.onOpen(path) }} onAddToDsh={props.onAddToDsh} onChange={() => window.dispatchEvent(new Event('dvw-files-changed'))} onUpload={(directory, files) => void upload(directory, files)} creating={creating} onCreatingChange={value => setCreating(current => current && ({ ...current, value, error: undefined }))} onCreatingCancel={() => setCreating(undefined)} onCreatingSubmit={() => void submitCreating()}/>
    </div>
    {pendingDelete !== undefined && <div className="dvw-confirm-backdrop" role="presentation"><section className="dvw-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dvw-delete-title" aria-describedby="dvw-delete-message"><h2 id="dvw-delete-title">删除{pendingDelete.length > 1 ? ` ${pendingDelete.length} 个项目` : pendingDelete[0]?.kind === 'directory' ? '文件夹' : '文件'}</h2><p id="dvw-delete-message">{pendingDelete.length === 1 ? `是否删除“${pendingDelete[0]?.name}”？` : `是否删除已选择的 ${pendingDelete.length} 个项目？`}</p><p className="dvw-confirm-note">此操作无法撤销。</p><footer><button autoFocus onClick={() => setPendingDelete(undefined)}>取消</button><button className="dvw-danger-button" onClick={() => void remove()}>删除</button></footer></section></div>}
  </>
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

// Two lane widths per row let each branch turn meet the next row vertically.
const GRAPH_LANE = 11
const GRAPH_HEIGHT = 2 * GRAPH_LANE
const GRAPH_MID = GRAPH_HEIGHT / 2
const GRAPH_CURVE = 5
const GRAPH_COLORS = ['var(--dvw-graph-ref)','#ffb000','#dc267f','#994f00','#40b0a6','#b66dff']
function graphColor(color:number):string{return GRAPH_COLORS[color]!}
function graphX(lane:number):number{return GRAPH_LANE*(lane+1)}
function graphWidth(row:GraphRow):number{return GRAPH_LANE*(Math.max(row.before.length,row.after.length,row.lane+1)+1)}

export interface GraphTrack { hash: string; color: number }
export interface GraphRow {
  commit: GitCommit
  lane: number
  color: number
  before: GraphTrack[]
  after: GraphTrack[]
  parentLanes: number[]
}

function isGraphHead(commit: GitCommit): boolean {
  return commit.refs.some(ref => ref === 'HEAD' || ref.startsWith('HEAD ->'))
}

export function graphRows(commits: GitCommit[]): GraphRow[] {
  const visible = new Map(commits.map(commit => [commit.hash, commit]))
  let nextColor = 0
  const branchColor = (commit: GitCommit) => isGraphHead(commit) ? 0 : 1 + nextColor++ % (GRAPH_COLORS.length - 1)
  let lanes: GraphTrack[] = []

  return commits.map(commit => {
    const before = lanes
    const incoming = before.findIndex(track => track.hash === commit.hash)
    const lane = incoming < 0 ? before.length : incoming
    const color = before[incoming]?.color ?? branchColor(commit)
    const after: GraphTrack[] = []
    const parentLanes: number[] = []
    const firstParent = commit.parents[0]

    // Each incoming edge keeps its lane until its own target row, even when
    // multiple lanes lead to the same commit. Only the first continues below it.
    for (const track of before) {
      if (track.hash !== commit.hash) after.push(track)
      else if (track === before[lane] && firstParent && visible.has(firstParent)) {
        parentLanes.push(after.length)
        after.push({ hash: firstParent, color })
      }
    }
    commit.parents.forEach((hash, index) => {
      const parent = visible.get(hash)
      if (!parent || (index === 0 && incoming >= 0)) return
      parentLanes.push(after.length)
      after.push({ hash, color: index === 0 ? color : branchColor(parent) })
    })
    lanes = after
    return { commit, lane, color, before, after, parentLanes }
  })
}

/** Move a passing lane with two tangent quarter circles on either side of the midline. */
export function graphTrackPath(from: number, to: number): string {
  if (from === to) return `M ${from} 0 V ${GRAPH_HEIGHT}`
  const direction = Math.sign(to - from)
  const radius = GRAPH_CURVE
  const sweep = direction < 0 ? 1 : 0
  return `M ${from} 0 V ${GRAPH_MID - radius} A ${radius} ${radius} 0 0 ${sweep} ${from + direction * radius} ${GRAPH_MID} H ${to - direction * radius} A ${radius} ${radius} 0 0 ${1 - sweep} ${to} ${GRAPH_MID + radius} V ${GRAPH_HEIGHT}`
}

export function graphParentPath(from: number, to: number): string {
  if (from === to) return `M ${from} ${GRAPH_MID} V ${GRAPH_HEIGHT}`
  const direction = Math.sign(to - from)
  return `M ${from} ${GRAPH_MID} H ${to - direction * GRAPH_LANE} A ${GRAPH_LANE} ${GRAPH_LANE} 0 0 ${direction > 0 ? 1 : 0} ${to} ${GRAPH_HEIGHT}`
}

function graphMergePath(from: number, to: number): string {
  return `M ${from} 0 A ${GRAPH_LANE} ${GRAPH_LANE} 0 0 1 ${from - GRAPH_LANE} ${GRAPH_MID} H ${to}`
}

function GraphNode({row,x,color}:{row:GraphRow;x:number;color:string}) {
  if(isGraphHead(row.commit))return <><circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="7" style={{fill:color}}/><circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="2" style={{strokeWidth:4}}/></>
  if(row.commit.parents.length>1)return <><circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="6" style={{fill:color}}/><circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="3" style={{fill:color}}/></>
  return <circle className="dvw-graph-node" cx={x} cy={GRAPH_MID} r="5" style={{fill:color}}/>
}

function GraphTracks({ row }: { row: GraphRow }) {
  const width = graphWidth(row)
  const x = graphX(row.lane)
  return <svg className="dvw-graph-svg" width={width} height={GRAPH_HEIGHT} aria-hidden="true">
    {row.before.map((track, lane) => {
      const from = graphX(lane)
      let path: string
      if (track.hash !== row.commit.hash) {
        // Passing tracks retain object identity, including parallel tracks to the same hash.
        path = graphTrackPath(from, graphX(row.after.indexOf(track)))
      } else {
        path = lane === row.lane ? `M ${x} 0 V ${GRAPH_MID}` : graphMergePath(from, x)
      }
      return <path key={lane} className="dvw-graph-line" d={path} style={{ stroke: graphColor(track.color) }}/>
    })}
    {row.parentLanes.map(lane => <path key={lane} className="dvw-graph-line"
      d={graphParentPath(x, graphX(lane))} style={{ stroke: graphColor(row.after[lane]!.color) }}/>)}
    <GraphNode row={row} x={x} color={graphColor(row.color)}/>
  </svg>
}

function GraphContinuation({row}:{row:GraphRow}) {
  const width=graphWidth(row)
  return <svg className="dvw-graph-continuation" width={width} height="100%" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true">{row.after.map((track,lane)=><line className="dvw-graph-line" key={lane} x1={graphX(lane)} y1="0" x2={graphX(lane)} y2="100" style={{stroke:graphColor(track.color)}}/>)}</svg>
}

export function CommitGraph({ sessionId, commits, expanded, files, onToggle, onOpenFile }: { sessionId?: string; commits: GitCommit[]; expanded?: string; files: Map<string,GitCommitFile[]>; onToggle(commit:GitCommit):void; onOpenFile(commit:GitCommit,file:GitCommitFile):void }) {
  const [hover, setHover] = useState<{ hash: string; anchor: HTMLElement }>()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const cancelTimer = () => clearTimeout(timer.current)
  const closeHover = () => { cancelTimer(); setHover(undefined) }
  const leave = () => { cancelTimer(); timer.current = setTimeout(closeHover, 180) }
  const enter = (hash: string, anchor: HTMLElement) => {
    cancelTimer()
    if (hover?.hash !== hash) timer.current = setTimeout(() => setHover({ hash, anchor }), 300)
  }
  useEffect(() => {
    const scroll = (event: Event) => { if (!(event.target instanceof Element && event.target.closest('.dvw-commit-hover'))) closeHover() }
    window.addEventListener('scroll', scroll, true)
    return () => { cancelTimer(); window.removeEventListener('scroll', scroll, true) }
  }, [])
  return <div className="dvw-graph-list">{graphRows(commits).map(row => {
    const opened=expanded===row.commit.hash
    const changedFiles = opened ? files.get(row.commit.hash) : undefined
    return <div className="dvw-graph-entry" data-expanded={opened} key={row.commit.hash}>
      <button className="dvw-graph-row" style={{height:GRAPH_HEIGHT}} aria-expanded={opened} onMouseEnter={e=>enter(row.commit.hash,e.currentTarget)} onFocus={e=>enter(row.commit.hash,e.currentTarget)} onBlur={leave} onMouseLeave={leave} onKeyDown={e=>{if(e.key==='Escape')closeHover()}} onClick={()=>{closeHover();onToggle(row.commit)}}><GraphTracks row={row}/><span className="dvw-graph-copy"><span className="dvw-graph-subject">{row.commit.subject}</span></span><Icon name={opened?'chevron-down':'chevron-right'}/></button>
      {hover?.hash===row.commit.hash && <CommitHover key={row.commit.hash} sessionId={sessionId} commit={row.commit} anchor={hover.anchor} onEnter={cancelTimer} onLeave={leave} onClose={closeHover} onCopy={()=>void copyText(row.commit.hash)}/>}
      {changedFiles && changedFiles.length > 0 && <div className="dvw-commit-files" style={{paddingLeft:graphWidth(row)+7}}><GraphContinuation row={row}/><div className="dvw-commit-file-list">{changedFiles.map(file=><button className="dvw-commit-file" key={`${file.status}:${file.path}`} onClick={()=>onOpenFile(row.commit,file)}><FileIcon name={file.path.split('/').at(-1) ?? file.path} className="dvw-file-icon"/><span className="dvw-commit-file-name">{file.path.split('/').at(-1)}</span><span className="dvw-commit-file-dir">{file.path.split('/').slice(0,-1).join('/')}</span><span className="dvw-badge">{file.status}</span></button>)}</div></div>}
    </div>
  })}</div>
}

function GitGroupHeader({ title, count, expanded, onToggle, children }: { title: string; count?: number; expanded: boolean; onToggle(): void; children?: ReactNode }) {
  return <div className="dvw-group-head"><button className="dvw-group-toggle" aria-expanded={expanded} onClick={onToggle}><Icon name={expanded?'chevron-down':'chevron-right'}/><span>{title}</span></button>{children}{count!==undefined&&<span className="dvw-count">{count}</span>}</div>
}

function Git(props: { visible: boolean; statusSlot: HTMLElement | null; sessionId: string; preferences: CommitMessagePreferences; model?: CommitModelSelection; modelConfigured: boolean; modelAvailable: boolean; modelHint: string; onOpenFile(path: string): void; onDiff(key:string, diff:GitDiff|undefined, title?:string, sourcePath?:string, preview?:{commit:string;path:string}): void }) {
  const [status, setStatus] = useState<GitStatus>(); const [commits,setCommits]=useState<GitCommit[]>([]); const [message, setMessage] = useState(''); const [actionError,setActionError]=useState<GitActionNotice>();const [busy,setBusy]=useState(false); const [expanded,setExpanded]=useState({staged:true,changes:true,graph:true});const [expandedCommit,setExpandedCommit]=useState<string>();const [commitFileMap,setCommitFileMap]=useState<Map<string,GitCommitFile[]>>(new Map());const [branchMenu,setBranchMenu]=useState(false);const [branches,setBranches]=useState<GitBranch[]>([]);const [newBranch,setNewBranch]=useState('');const [branchError,setBranchError]=useState<string>();const [generating,setGenerating]=useState(false);const [commitMenu,setCommitMenu]=useState(false)
  const generation = useRef<AbortController>()
  useEffect(() => () => generation.current?.abort(), [])
  const [repositoryExpanded, setRepositoryExpanded] = useState(true)
  const [tree, setTree] = useState(() => localStorage.getItem('dvw:git-tree') === 'true')
  const [sort, setSort] = useState<'path'|'name'|'status'>(() => {
    const saved = localStorage.getItem('dvw:git-sort')
    return saved === 'status' || saved === 'name' ? saved : 'path'
  })
  const [gitOutput, setGitOutput] = useState<string>()
  const [cloneOpen,setCloneOpen] = useState(false)
  const [creatingTag,setCreatingTag] = useState(false)
  const [editingMessage, setEditingMessage] = useState(false)
  const messageInput = useRef<HTMLTextAreaElement>(null)
  const [toolsSelection, setToolsSelection] = useState<GitToolsSelection>()
  const [toolsOpen, setToolsOpen] = useState(false)
  const openTools = (selection?: GitToolsSelection) => {
    if (selection !== undefined || toolsSelection === undefined) setToolsSelection(selection ?? {})
    setToolsOpen(true)
  }
  const refreshVersion = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    try {
      const [nextStatus, nextCommits] = await Promise.all([
        api<GitStatus>('git.status',{sessionId:props.sessionId}),
        props.visible ? api<GitCommit[]>('git.action',{sessionId:props.sessionId,action:'log'}) : Promise.resolve([]),
      ])
      if (version === refreshVersion.current) {
        setStatus(nextStatus)
        setCommits(nextCommits)
      }
    } catch (error) {
      if (version !== refreshVersion.current) return
      if (error instanceof ApiError && error.code === 'not-repository') {
        setStatus(undefined)
        setCommits([])
      } else {
        setActionError(gitActionErrorNotice('refresh', error))
      }
    }
  }, [props.sessionId, props.visible])
  const refreshDebounced = useDebouncedCallback(refresh, 500)
  useEffect(()=>{void refresh();return()=>{refreshVersion.current++}},[refresh])
  useEffect(()=>{const fn=()=>refreshDebounced();window.addEventListener('dvw-files-changed',fn);return()=>window.removeEventListener('dvw-files-changed',fn)},[refreshDebounced])
  const action = async (name: string, path?: string, value?: string) => { setBusy(true);setActionError(undefined);try { const result = await api<GitStatus | GitDiff>('git.action',{sessionId:props.sessionId,action:name,path,value}); if(name==='diff'&&'diff'in result){const key=path??'';props.onDiff(value==='staged'?`staged:${key}`:key,result,key.split('/').at(-1)??key,key)} else {setStatus(result as GitStatus);void refresh();window.dispatchEvent(new Event('dvw-files-changed'))} return true } catch(error){setActionError(gitActionErrorNotice(name,error,changed.length>0));return false}finally{setBusy(false)} }
  useEffect(()=>{if(!branchMenu)return;const close=()=>setBranchMenu(false);const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape)}},[branchMenu])
  useEffect(()=>{if(!commitMenu)return;const close=()=>setCommitMenu(false);const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape)}},[commitMenu])
  useEffect(()=>{if(actionError===undefined)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setActionError(undefined)};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[actionError])
  const openBranchMenu=async()=>{if(branchMenu){setBranchMenu(false);return}setBusy(true);setActionError(undefined);try{setBranches(await api<GitBranch[]>('git.action',{sessionId:props.sessionId,action:'branch.list'}));setBranchMenu(true)}catch(error){setActionError(gitActionErrorNotice('branch.list',error))}finally{setBusy(false)}}
  const switchBranch=async(name:string)=>{if(name===status?.branch){setBranchMenu(false);return}setBusy(true);try{setStatus(await api<GitStatus>('git.action',{sessionId:props.sessionId,action:'branch.switch',value:name}));setBranchMenu(false);refresh()}catch(error){setBranchError(branchErrorMessage(error))}finally{setBusy(false)}}
  const createBranch=async()=>{const name=newBranch.trim();if(name==='')return;setBusy(true);try{setStatus(await api<GitStatus>('git.action',{sessionId:props.sessionId,action:'branch.create',value:name}));setNewBranch('');setBranchMenu(false);refresh()}catch(error){setBranchError(branchErrorMessage(error))}finally{setBusy(false)}}
  const toggleCommit=async(commit:GitCommit)=>{if(expandedCommit===commit.hash){setExpandedCommit(undefined);return}setExpandedCommit(commit.hash);if(commitFileMap.has(commit.hash))return;setBusy(true);setActionError(undefined);try{const files=await api<GitCommitFile[]>('git.action',{sessionId:props.sessionId,action:'commit.files',value:commit.hash});setCommitFileMap(current=>new Map(current).set(commit.hash,files))}catch(error){setActionError(gitActionErrorNotice('commit.files',error))}finally{setBusy(false)}}
  const openCommitFile=async(commit:GitCommit,file:GitCommitFile)=>{const title=file.path.split('/').at(-1)??file.path;if(isPreviewDocumentPath(file.path)){props.onDiff(`commit:${commit.hash}:${file.path}`,undefined,title,file.path,{commit:commit.hash,path:file.path});return}setBusy(true);setActionError(undefined);try{const result=await api<GitDiff>('git.action',{sessionId:props.sessionId,action:'commit.file.diff',path:file.path,value:commit.hash});props.onDiff(`commit:${commit.hash}:${file.path}`,result,title,file.path)}catch(error){setActionError(gitActionErrorNotice('commit.file.diff',error))}finally{setBusy(false)}}
  const generateMessage = async () => {
    if (generation.current) {
      generation.current.abort()
      generation.current = undefined
      setGenerating(false)
      return
    }
    if (!props.model || !props.modelAvailable) return
    const controller = new AbortController()
    generation.current = controller
    setGenerating(true)
    setActionError(undefined)
    try {
      const selection = props.modelConfigured ? {provider:props.model.provider, model:props.model.model} : {}
      const result = await api<{message:string}>('git.commitMessage', {sessionId:props.sessionId, ...selection, ...props.preferences}, controller.signal)
      if (!controller.signal.aborted) setMessage(result.message)
    } catch (error) {
      if (!controller.signal.aborted) setActionError(gitActionErrorNotice('commitMessage', error))
    } finally {
      if (generation.current === controller) { generation.current = undefined; setGenerating(false) }
    }
  }
  const staged=status?.changes.filter(change=>!change.conflicted&&change.index!=='.'&&change.index!=='?')??[]
  const changed=status?.changes.filter(change=>!change.conflicted&&(change.worktree!=='.'||change.untracked))??[]
  const commitChanges=async(name:'commit'|'commit.amend'='commit')=>{
    const value=message.trim()
    if(value==='')return false
    if(name==='commit'&&staged.length===0){setActionError(noStagedCommitNotice(changed.length>0));return false}
    const complete=await action(name,undefined,value)
    if(complete)setMessage('')
    return complete
  }
  const commitThen=async(next:'push'|'sync')=>{setCommitMenu(false);if(await commitChanges())await action(next)}
  const stageAllAndCommit=async()=>{
    const value=message.trim()
    if(value==='')return
    setActionError(undefined)
    if(!await action('stage.all'))return
    if(await action('commit',undefined,value))setMessage('')
  }
  const renderChange=(change:GitStatus['changes'][number],group:'staged'|'worktree')=><div className="dvw-change" key={`${group}:${change.path}`} onClick={()=>void action('diff',change.path,change.untracked?'untracked':group)}><FileIcon name={change.path.split('/').at(-1) ?? change.path}/><span className="dvw-change-path" title={change.path}>{change.path.split('/').at(-1)}{!tree&&<small>{change.path.split('/').slice(0,-1).join('/')}</small>}</span><button className="dvw-icon" title="文件历史与逐行归属" onClick={event=>{event.stopPropagation();openTools({path:change.path})}}><Icon name="history"/></button><button className="dvw-icon" title={group==='staged'?'取消暂存':'暂存更改'} onClick={event=>{event.stopPropagation();void action(group==='staged'?'unstage':'stage',change.path)}}><Icon name={group==='staged'?'remove':'add'}/></button>{group==='worktree'&&<button className="dvw-icon" title="放弃更改" onClick={event=>{event.stopPropagation();if(confirm(`放弃 ${change.path} 的更改？此操作无法撤销。`))void action('discard',change.path,change.untracked?'untracked':undefined)}}><Icon name="discard"/></button>}<span className="dvw-badge">{change.untracked?'U':group==='staged'?change.index:change.worktree}</span></div>
  const branchPicker = status && branchMenu && <div className="dvw-branch-menu" role="menu" onPointerDown={event=>event.stopPropagation()}><div className="dvw-branch-current">当前分支：{status.branch}</div><div className="dvw-branch-list">{branches.map(branch=><button key={branch.name} role="menuitem" data-active={branch.name===status.branch} disabled={busy||branch.worktree!==undefined} title={branch.worktree!==undefined?`已在工作树 ${branch.worktree} 中检出`:undefined} onClick={()=>void switchBranch(branch.name)}><Icon name={branch.name===status.branch?'check':'git-branch'}/><span>{branch.name}</span>{branch.worktree!==undefined&&<span className="dvw-branch-worktree">工作树</span>}</button>)}</div><div className="dvw-branch-create"><input className="dvw-input" value={newBranch} placeholder="新分支名称" onChange={event=>setNewBranch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void createBranch()}}}/><button className="dvw-icon dvw-branch-create-button" title="创建并切换分支" disabled={busy||!newBranch.trim()} onClick={()=>void createBranch()}><Icon name="add"/></button></div></div>
  const remote = () => openTools({view:'remote'})
  const discardAll = () => { if (confirm('放弃所有已跟踪和未跟踪的更改？此操作无法撤销。')) void action('discard.all') }
  const commands: ScmCommand[] = [
    { label: tree ? '以列表形式查看' : '以树形式查看', run: () => { setTree(!tree); localStorage.setItem('dvw:git-tree',String(!tree)) } },
    { label: '查看和排序', children: ([['path','路径'],['name','名称'],['status','状态']] as const).map(([key,label]) => ({label:(sort===key?'✓ ':'')+label, run:()=>{setSort(key);localStorage.setItem('dvw:git-sort',key)}})) },
    { label:'拉取', divider:true, run:()=>void action('pull') }, { label:'推送', run:()=>void action('push') },
    { label:'克隆…', run:()=>setCloneOpen(true) },
    { label:'签出到…', run:()=>void openBranchMenu() }, { label:'抓取', run:()=>void action('fetch') },
    { label:'提交', divider:true, children:[{label:'提交暂存的更改',disabled:!message.trim(),run:()=>void commitChanges()},{label:'修改上次提交',disabled:!message.trim(),run:()=>void commitChanges('commit.amend')},{label:'提交历史',run:()=>openTools({view:'history'})}] },
    { label:'更改', children:[{label:'暂存所有更改',disabled:!changed.length,run:()=>void action('stage.all')},{label:'取消暂存所有更改',disabled:!staged.length,run:()=>void action('unstage.all')},{label:'放弃所有更改',disabled:!changed.length,run:discardAll}] },
    { label:'拉取，推送', children:[{label:'拉取',run:()=>void action('pull')},{label:'推送',run:()=>void action('push')},{label:'同步更改',run:()=>void action('sync')}] },
    { label:'分支', children:[{label:'切换或创建分支…',run:()=>void openBranchMenu()},{label:'管理分支…',run:remote}] },
    { label:'远程', children:[{label:'抓取所有远端',run:()=>void action('fetch')},{label:'同步与分支…',run:remote}] },
    { label:'存储', run:()=>openTools({view:'stash'}) }, { label:'标记', children:[
      {label:'创建标记…',run:()=>setCreatingTag(true)},
      {label:'列出标记',run:()=>{void api<string[]>('git.action',{sessionId:props.sessionId,action:'refs'}).then(refs=>setGitOutput(refs.filter(ref=>ref.startsWith('refs/tags/')).map(ref=>ref.slice(10)).join('\n')||'没有标记')).catch(error=>setActionError(gitActionErrorNotice('refs',error))) }}
    ] },
    { label:'显示 Git 输出', divider:true, run:()=>{void api<string>('git.action',{sessionId:props.sessionId,action:'output'}).then(setGitOutput).catch(error=>setActionError(gitActionErrorNotice('output',error)))} },
    { label:'打开提交消息编辑器',run:()=>setEditingMessage(true) },
    { label:'Git 工具',run:()=>openTools() },
  ]
  return <>
    {status && props.statusSlot && createPortal(<div className="dvw-scm-status">
      <button className="dvw-branch" title="切换分支" aria-haspopup="menu" aria-expanded={branchMenu} onClick={()=>void openBranchMenu()}><Icon name="git-branch"/> {status.branch}</button>
      <button className="dvw-branch" title="同步更改（先拉取再推送）" disabled={busy} onClick={()=>void action('sync')}><Icon name="refresh"/> ↓{status.behind} ↑{status.ahead}</button>
      {branchMenu&&branchPicker}
    </div>,props.statusSlot)}
    {props.visible&&<div className="dvw-side-head">源代码管理{!status&&<button className="dvw-icon" title="刷新" onClick={refresh}><Icon name="refresh"/></button>}</div>}
    {props.visible&&status&&<ScmPanes split={repositoryExpanded && expanded.graph}>
      <section className="dvw-scm-changes" data-expanded={repositoryExpanded}>
      <div className="dvw-scm-head">
        <button className="dvw-group-toggle" aria-expanded={repositoryExpanded} onClick={()=>setRepositoryExpanded(!repositoryExpanded)}><Icon name={repositoryExpanded?'chevron-down':'chevron-right'}/>更改</button>
        <button className="dvw-icon" title="提交" disabled={busy||!message.trim()} onClick={()=>void commitChanges()}><Icon name="check"/></button>
        <button className="dvw-icon" title="刷新" disabled={busy} onClick={refresh}><Icon name="refresh"/></button>
        <button className="dvw-icon" title="Git 工具" onClick={()=>openTools()}><Icon name="tools"/></button>
        <button className="dvw-icon" title="提交历史" onClick={()=>openTools({view:'history'})}><Icon name="history"/></button>
        <button className="dvw-icon" title="编辑提交消息" onClick={()=>setEditingMessage(true)}><Icon name="edit"/></button>
        <ScmMenu commands={commands}/>
        {!props.statusSlot&&branchMenu&&branchPicker}
      </div>
      {repositoryExpanded&&<>
      <div className="dvw-commit"><div className="dvw-commit-box"><textarea ref={messageInput} className="dvw-textarea dvw-commit-input" rows={1} value={message} onChange={event=>setMessage(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&message.trim()){event.preventDefault();void commitChanges()}}} placeholder={`消息 (${isMacPlatform()?'⌘':'Ctrl+'}Enter 在“${status.branch}”提交)`}/><button className="dvw-commit-ai" disabled={!generating&&(busy||!props.modelAvailable||status.changes.length===0)} aria-busy={generating} title={generating?'停止生成提交信息':props.modelAvailable?'根据当前更改生成提交信息':props.modelHint} aria-label={generating?'停止生成提交信息':'生成提交信息'} onClick={()=>void generateMessage()}>{generating?<span className="dvw-scm-stop" aria-hidden="true"/>:<Icon name="sparkle"/>}</button></div><div className="dvw-commit-actions"><button className="dvw-commit-button" disabled={busy||!message.trim()||status.changes.length===0} title={staged.length===0?'没有已暂存的更改':'提交暂存的更改'} onClick={()=>void commitChanges()}><Icon name="check"/> 提交</button><button className="dvw-commit-more" disabled={busy||!message.trim()||status.changes.length===0} aria-haspopup="menu" aria-expanded={commitMenu} title="更多提交操作" aria-label="更多提交操作" onClick={()=>setCommitMenu(value=>!value)}><Icon name="chevron-down"/></button>{commitMenu&&<div className="dvw-commit-menu" role="menu" onPointerDown={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>{setCommitMenu(false);void commitChanges()}}>提交</button><button role="menuitem" onClick={()=>{setCommitMenu(false);void commitChanges('commit.amend')}}>提交（修改）</button><div className="dvw-commit-menu-sep" role="separator"/><button role="menuitem" onClick={()=>void commitThen('push')}>提交和推送</button><button role="menuitem" onClick={()=>void commitThen('sync')}>提交和同步</button></div>}</div></div>
      <div className="dvw-git">{(status.operation||status.changes.some(change=>change.conflicted))&&<button className="dvw-commit-file" onClick={()=>openTools({ view: 'conflicts' })}><Icon name="warning"/> 处理 Git 操作与冲突</button>}{staged.length>0&&<section><GitGroupHeader title="暂存的更改" count={staged.length} expanded={expanded.staged} onToggle={()=>setExpanded(value=>({...value,staged:!value.staged}))}><button className="dvw-icon" title="取消暂存所有更改" onClick={()=>void action('unstage.all')}><Icon name="remove"/></button></GitGroupHeader>{expanded.staged&&<ChangeList files={staged} tree={tree} sort={sort} renderFile={change=>renderChange(change,'staged')}/>}</section>}<section><GitGroupHeader title="更改" count={changed.length} expanded={expanded.changes} onToggle={()=>setExpanded(value=>({...value,changes:!value.changes}))}><button className="dvw-icon" title="放弃所有更改" onClick={discardAll}><Icon name="discard"/></button><button className="dvw-icon" title="暂存所有更改" onClick={()=>void action('stage.all')}><Icon name="add"/></button></GitGroupHeader>{expanded.changes&&<ChangeList files={changed} tree={tree} sort={sort} renderFile={change=>renderChange(change,'worktree')}/>}</section></div>
      </>}
      </section>
      <section className="dvw-graph" data-expanded={expanded.graph}>
        <GitGroupHeader title="图表" expanded={expanded.graph} onToggle={()=>setExpanded(value=>({...value,graph:!value.graph}))}>
          <button className="dvw-icon" title="刷新提交图表" onClick={refresh}><Icon name="refresh"/></button>
        </GitGroupHeader>
        {expanded.graph&&<CommitGraph sessionId={props.sessionId} commits={commits} expanded={expandedCommit} files={commitFileMap} onToggle={commit=>void toggleCommit(commit)} onOpenFile={(commit,file)=>void openCommitFile(commit,file)}/>}
      </section>
    </ScmPanes>}
    {(cloneOpen||creatingTag)&&<dialog className="dvw-scm-dialog" ref={node=>{if(node&&!node.open)node.showModal()}} onCancel={()=>{setCloneOpen(false);setCreatingTag(false)}}>
      <form onSubmit={event=>{
        event.preventDefault()
        const data=new FormData(event.currentTarget)
        if (creatingTag) void action('tag.create',undefined,String(data.get('tag')).trim())
        else void action('clone',String(data.get('folder')).trim(),String(data.get('url')).trim())
        setCloneOpen(false);setCreatingTag(false)
      }}>
        <h3>{creatingTag?'创建标记':'克隆仓库'}</h3>
        {creatingTag?<label>标记名称<input className="dvw-input" name="tag" required autoFocus/></label>:<>
          <label>HTTPS 仓库地址<input className="dvw-input" type="url" name="url" required autoFocus/></label>
          <label>工作区内的新文件夹<input className="dvw-input" name="folder" required/></label>
        </>}
        <button type="button" onClick={()=>{setCloneOpen(false);setCreatingTag(false)}}>取消</button>
        <button>{creatingTag?'创建':'克隆'}</button>
      </form>
    </dialog>}
    {(editingMessage || gitOutput!==undefined)&&<dialog className="dvw-scm-dialog" ref={node=>{if(node&&!node.open)node.showModal()}} onCancel={()=>{setEditingMessage(false);setGitOutput(undefined)}}>
      <h3>{editingMessage?'提交消息':'Git 输出'}</h3>
      {editingMessage?<textarea autoFocus className="dvw-textarea" value={message} onChange={event=>setMessage(event.target.value)}/>:<pre>{gitOutput}</pre>}
      <button onClick={()=>{setEditingMessage(false);setGitOutput(undefined);messageInput.current?.focus()}}>关闭</button>
    </dialog>}
    {status&&toolsSelection&&<GitTools key={JSON.stringify(toolsSelection)} open={toolsOpen} sessionId={props.sessionId} status={status} selection={toolsSelection} onClose={()=>setToolsOpen(false)} onRefresh={refresh} onOpenFile={props.onOpenFile} onDiff={props.onDiff}/>}
    {actionError!==undefined&&createPortal(<div className="dvw-confirm-backdrop dvw-git-dialog-layer" role="presentation" onMouseDown={()=>setActionError(undefined)}><section className="dvw-confirm dvw-git-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dvw-git-error-title" aria-describedby="dvw-git-error-message" onMouseDown={event=>event.stopPropagation()}><header className="dvw-git-error-head"><span className="dvw-git-error-mark" aria-hidden="true"><Icon name="git-commit"/></span><div><h2 id="dvw-git-error-title">{actionError.title}</h2><p id="dvw-git-error-message">{actionError.message}</p></div></header>{actionError.detail!==undefined&&<details className="dvw-git-error-detail"><summary>技术详情</summary><pre>{actionError.detail}</pre></details>}<footer><button autoFocus onClick={()=>setActionError(undefined)}>{actionError.canStageAll?'取消':'知道了'}</button>{actionError.canStageAll&&<button className="dvw-git-error-primary" onClick={()=>void stageAllAndCommit()}>暂存全部并提交</button>}</footer></section></div>,document.body)}
    {branchError!==undefined&&<div className="dvw-confirm-backdrop" role="presentation" onMouseDown={()=>setBranchError(undefined)}><section className="dvw-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dvw-branch-error-title" onMouseDown={event=>event.stopPropagation()}><h2 id="dvw-branch-error-title">无法切换分支</h2><p className="dvw-branch-error-message">{branchError}</p><footer><button autoFocus onClick={()=>setBranchError(undefined)}>确定</button></footer></section></div>}
  </>
}

const ExplorerView = memo(Explorer)
const GitView = memo(Git)

export function Workbench({ service, browser, sessionId, cwd, navigation, dshPanelId: hostDshPanelId, onOpenDshPanel, onRestoreConversation, onCloseDshPanel, openSettings }: { service: VscodeWorkbench; browser?: NativeBrowser; sessionId?: string; cwd?: string; navigation?: DshNavigation; dshPanelId?: string; onOpenDshPanel?(panelId: string): void; onRestoreConversation?(): void; onCloseDshPanel?(): void; openSettings?(): void }) {
  const [snapshot, setSnapshot] = useState(() => service.getSnapshot()); const [panels, setPanels] = useState(() => service.getPanels())
  useEffect(() => service.subscribe(() => { setSnapshot(service.getSnapshot()); setPanels(service.getPanels()) }), [service])
  const [workspace,setWorkspace]=useState<{cwd:string;name:string}>()
  const [groups,setGroups]=useState<EditorGroup[]>(()=>[{id:'pane-1',tabs:[]}])
  const [focusedId,setFocusedId]=useState('pane-1')
  const [layout,setLayout]=useState<PaneNode>(()=>createLeaf('pane-1'))
  // Reads and writes of the focused group go through this ref, so a handler that focuses a pane
  // and then mutates tabs in the same tick still targets the pane it just focused.
  const focusedRef=useRef('pane-1')
  const focusedGroup=groups.find(group=>group.id===focusedId)??groups[0]!
  const tabs=focusedGroup.tabs; const active=focusedGroup.active
  const debugState = useSyncExternalStore(debugController.subscribe, debugController.getSnapshot)
  useEffect(() => { debugController.setActive(active) }, [active])
  // F5 must work even when the debug panel is closed, so the session is registered here.
  useEffect(() => { if (sessionId !== undefined) debugController.setSession(sessionId) }, [sessionId])
  const setTabsIn=useCallback((id:string,update:Tab[]|((rows:Tab[])=>Tab[]))=>setGroups(current=>current.map(group=>group.id===id?{...group,tabs:typeof update==='function'?update(group.tabs):update}:group)),[])
  const setActiveIn=useCallback((id:string,value:string|undefined)=>setGroups(current=>current.map(group=>group.id===id?{...group,active:value}:group)),[])
  const setTabs=useCallback((update:Tab[]|((rows:Tab[])=>Tab[]))=>setTabsIn(focusedRef.current,update),[setTabsIn])
  const setActive=useCallback((value?:string)=>setActiveIn(focusedRef.current,value),[setActiveIn])
  const focusGroup=useCallback((id:string)=>{if(focusedRef.current!==id){focusedRef.current=id;setFocusedId(id)}},[])
  const [paneDrop,setPaneDrop]=useState<{group:string;direction:SplitDirection;position:SplitPosition}|undefined>()
  const [tabDrop,setTabDrop]=useState<{group:string;index:number}|undefined>()
  // A cancelled drag (Esc) or a drop outside the panes never reaches the drop handler, and a
  // highlight left behind would then describe a position that is no longer true.
  useEffect(() => {
    const clear = () => { setPaneDrop(undefined); setTabDrop(undefined) }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear) }
  }, []);
  const [gitDiffStyle, setGitDiffStyle] = useState<GitDiffStyle>(() => localStorage.getItem('dvw:git-diff-style') === 'ribbon' ? 'ribbon' : 'classic')
  const [preferredDiffMode, setPreferredDiffMode] = useState<GitDiffMode | undefined>(() => {
    const saved = storedValue(GIT_DIFF_MODE_KEY)
    return saved === 'inline' || saved === 'split' ? saved : undefined
  })
  const [gitLineBlame, setGitLineBlame] = useState(() => localStorage.getItem('dvw:git-line-blame') !== 'false')
  const defaultDiffMode = gitDiffStyle === 'ribbon' ? 'split' : 'inline'
  const diffMode = preferredDiffMode ?? defaultDiffMode
  const selectDiffMode = (mode: GitDiffMode) => {
    setPreferredDiffMode(mode)
    try { localStorage.setItem(GIT_DIFF_MODE_KEY, mode) } catch { /* Browser privacy settings may deny storage. */ }
  }
  const [dshTabActive,setDshTabActive]=useState(hostDshPanelId!==undefined); const [dshTabId,setDshTabId]=useState<string|undefined>(hostDshPanelId); const dshPanelId=dshTabId; const [error,setError]=useState<string>(); const [panelHeight,setPanelHeight]=useState(260); const [sideWidth,setSideWidth]=useState(210); const [primarySideVisible,setPrimarySideVisible]=useState(()=>localStorage.getItem('dvw:primary-side-visible')!=='closed');const [statusVisible,setStatusVisible]=useState(()=>localStorage.getItem('dvw:status-bar-visible')!=='closed');const settingsNode=useSyncExternalStore(settingsHost.subscribe,settingsHost.getSnapshot);const settingsOpen=settingsNode!==undefined;const [chatWidth,setChatWidth]=useState(()=>clampChatWidth(Number(localStorage.getItem('dvw:dsh-chat-width'))||DSH_CHAT_DEFAULT_WIDTH));const [chatVisible,setChatVisible]=useState(()=>localStorage.getItem('dvw:dsh-chat-visible')!=='closed');const [outlineVisible,setOutlineVisible]=useState(()=>localStorage.getItem('dvw:outline')!=='closed');const [tsIntellisense,setTsIntellisense]=useState(tsIntellisenseEnabled);const [tsIndex,setTsIndex]=useState<{state:'idle'|'loading'|'ready'|'error';files?:number;truncated?:boolean;error?:string}>({state:'idle'});const [lspServers,setLspServers]=useState<LspServerStatus[]>([]);const [lspBusy,setLspBusy]=useState<string>();const [lspError,setLspError]=useState('');const lspManager=useRef<LspManager>();const [fontSize,setFontSize]=useState(()=>{const saved=Math.round(Number(localStorage.getItem('dvw:font-size')));return Number.isFinite(saved)&&saved>=11&&saved<=20?saved:14});const [tabMenu,setTabMenu]=useState<{x:number;y:number;path:string}>()
  const [browserSnapshot,setBrowserSnapshot]=useState<BrowserSnapshot>(()=>browser?.getSnapshot()??{available:false,tabs:[]})
  const [browserId,setBrowserId]=useState<string>()
  const browserTabs=browserSnapshot.tabs.filter(tab=>tab.sessionId===sessionId)
  const previousBrowserIds=useRef(new Set(browserTabs.map(tab=>tab.id)))
  useEffect(()=>{if(browser===undefined)return;setBrowserSnapshot(browser.getSnapshot());return browser.subscribe(()=>setBrowserSnapshot(browser.getSnapshot()))},[browser])
  useEffect(()=>{
    const next=new Set(browserTabs.map(tab=>tab.id))
    const added=browserTabs.find(tab=>!previousBrowserIds.current.has(tab.id))
    previousBrowserIds.current=next
    if(added!==undefined&&snapshot.visible){setBrowserId(added.id);setDshTabActive(false)}
    else if(browserId!==undefined&&!next.has(browserId))setBrowserId(undefined)
  },[browserSnapshot,sessionId,browserId,snapshot.visible])
  const browserRequest=useRef<AbortController>()
  useEffect(()=>()=>browserRequest.current?.abort(),[browser,sessionId,snapshot.visible])
  const browserIdRef=useRef(browserId);browserIdRef.current=browserId
  const newBrowser=async(url?:string)=>{
    if(browser===undefined||sessionId===undefined)return
    setDshTabActive(false);onRestoreConversation?.()
    browserRequest.current?.abort();const request=new AbortController();browserRequest.current=request
    try{setBrowserId(await browser.open(sessionId,request.signal,url,browserIdRef.current))}catch(error){if(!request.signal.aborted)setError(error instanceof Error?error.message:String(error))}
  }
  const [defaultBrowser,setDefaultBrowser]=useState<DefaultBrowser>(()=>localStorage.getItem(DEFAULT_BROWSER_KEY)==='system'?'system':'builtin')
  useEffect(()=>localStorage.setItem(DEFAULT_BROWSER_KEY,defaultBrowser),[defaultBrowser])
  const [openMode,setOpenMode]=useState<WorkbenchOpenMode>(()=>readOpenMode())
  const floating=openMode==='floating'
  useEffect(()=>writeOpenMode(openMode),[openMode])
  const overlayRef=useRef<HTMLDivElement>(null)
  const [floatFullscreen,setFloatFullscreen]=useState(false)
  const [viewport,setViewport]=useState(viewportSize)
  const [floatRect,setFloatRect]=useState<FloatRect>(()=>readFloatRect(storedValue(FLOAT_RECT_KEY),viewportSize(),dshTitlebarHeight()))
  const [floatMax,setFloatMax]=useState(()=>readFloatMax(storedValue(FLOAT_MAX_KEY)))
  useEffect(()=>{
    const sync=()=>setFloatFullscreen(document.fullscreenElement!==null&&document.fullscreenElement===overlayRef.current)
    sync()
    document.addEventListener('fullscreenchange',sync)
    return ()=>document.removeEventListener('fullscreenchange',sync)
  },[])
  useEffect(()=>{
    const reflow=()=>{
      setViewport(viewportSize())
      // The native title bar disappears while fullscreen, so remeasuring the inset
      // there would push the restored window under the traffic lights.
      if(document.fullscreenElement===overlayRef.current)return
      setFloatRect(current=>clampFloatRect(current,viewportSize(),dshTitlebarHeight()))
    }
    window.addEventListener('resize',reflow)
    return ()=>window.removeEventListener('resize',reflow)
  },[])
  const toggleFloatFullscreen=useCallback(async()=>{
    const overlay=overlayRef.current
    if(overlay===null)return
    try{
      if(typeof document.exitFullscreen==='function'&&document.fullscreenElement!==null){await document.exitFullscreen();return}
      if(typeof overlay.requestFullscreen!=='function'){
        // Hosts can refuse the Fullscreen API (permissions, kiosk policy). Keep the
        // workbench usable by falling back to the old in-window maximized layer.
        setFloatMax(true);persistFloatMax(true)
        return
      }
      await overlay.requestFullscreen()
    }catch{
      setFloatMax(true);persistFloatMax(true)
    }
  },[])
  const resetFloatGeometry=()=>{
    const next=defaultFloatRect(viewportSize(),dshTitlebarHeight())
    setViewport(viewportSize())
    setFloatRect(next)
    persistFloatRect(next)
    setFloatMax(false)
    persistFloatMax(false)
  }
  const beginFloatGesture=(event:React.PointerEvent,mode:FloatGesture)=>{
    if(event.button!==0||floatMax||floatFullscreen)return
    event.preventDefault()
    const start=floatRect,startX=event.clientX,startY=event.clientY,top=dshTitlebarHeight()
    const target=event.currentTarget as HTMLElement
    try{target.setPointerCapture(event.pointerId)}catch{/* Synthetic pointer events may lack a pointerId. */}
    const move=(moveEvent:PointerEvent)=>setFloatRect(applyFloatGesture(mode,start,moveEvent.clientX-startX,moveEvent.clientY-startY,viewportSize(),top))
    const up=()=>{
      window.removeEventListener('pointermove',move)
      window.removeEventListener('pointerup',up)
      setFloatRect(current=>{persistFloatRect(current);return current})
    }
    window.addEventListener('pointermove',move)
    window.addEventListener('pointerup',up)
  }
  const openBrowserUrl=(url:string)=>{
    if(defaultBrowser==='system'||browser===undefined){window.open(url,'_blank','noopener,noreferrer');return}
    void newBrowser(url)
  }
  const openSiteFile=async(path:string)=>{
    if(sessionId===undefined)return
    try{
      const {url}=await api<{url:string}>('preview.site',{sessionId,path})
      openBrowserUrl(url)
    }catch(error){setError(error instanceof Error?error.message:String(error))}
  }
  useEffect(()=>{if(browserId!==undefined&&!dshTabActive)browser?.focus(browserId)},[browser,browserId,dshTabActive])
  useEffect(()=>{if(!snapshot.visible)return;const open=()=>void newBrowser();window.addEventListener('dvw-browser-new',open);return()=>window.removeEventListener('dvw-browser-new',open)},[browser,sessionId,snapshot.visible])
  useEffect(()=>{
    const open=(event:Event)=>{const url=(event as CustomEvent<string>).detail;if(typeof url==='string'&&url!=='')openBrowserUrl(url)}
    window.addEventListener('dvw-open-external-url',open)
    return ()=>window.removeEventListener('dvw-open-external-url',open)
  },[defaultBrowser,browser,sessionId])
  useEffect(()=>{if(hostDshPanelId!==undefined)setBrowserId(undefined)},[hostDshPanelId])
  const groupsRef=useRef(groups);groupsRef.current=groups
  const hasUnsavedSearchFile = useCallback((path: string) => groupsRef.current.some(group => group.tabs.some(tab => tab.path === path && tab.dirty)), [])
  const [searchFocus, setSearchFocus] = useState<{ replace: boolean }>()
  const searchNavigationPending = useRef(false)
  useEffect(() => {
    const focus = (event: Event) => {
      searchNavigationPending.current = workspace === undefined
      setPrimarySideVisible(true)
      setSearchFocus({ replace: (event as CustomEvent<boolean>).detail })
    }
    window.addEventListener('dvw-focus-search', focus)
    return () => window.removeEventListener('dvw-focus-search', focus)
  }, [workspace])

  const tabsRef=useRef(tabs);tabsRef.current=tabs
  // DSH unmounts its conversation while a global panel (Plugins…) is selected,
  // so the tab outlives the panel: opening a file hands the centre back to the
  // conversation, and clicking the tab re-selects the panel.
  const dshTabActiveRef=useRef(dshTabActive);dshTabActiveRef.current=dshTabActive
  const dshTabIdRef=useRef(dshTabId);dshTabIdRef.current=dshTabId
  const hostDshPanelIdRef=useRef(hostDshPanelId);hostDshPanelIdRef.current=hostDshPanelId
  const openDshPanelRef=useRef(onOpenDshPanel);openDshPanelRef.current=onOpenDshPanel
  const restoreConversationRef=useRef(onRestoreConversation);restoreConversationRef.current=onRestoreConversation
  const leaveDshPanel=useCallback(()=>{setBrowserId(undefined);const wasActive=dshTabActiveRef.current;setDshTabActive(false);if(wasActive)restoreConversationRef.current?.()},[])
  const openDshTab=useCallback(()=>{setBrowserId(undefined);const id=dshTabIdRef.current;if(id===undefined)return;setDshTabActive(true);if(hostDshPanelIdRef.current!==id)openDshPanelRef.current?.(id)},[])
  // Bring the official conversation back without requiring another tab: while a
  // DSH panel is pinned, the chat column is intentionally hidden, so the whale
  // button and Ctrl+Alt+B must first leave that panel.
  const showConversation=useCallback(()=>{setBrowserId(undefined);setDshTabActive(false);setChatVisible(true)},[])
  const tabListRef=useRef<HTMLDivElement>(null)
  const workspaceRequests=useRef(new WorkspaceRequestScope());const loadedWorkspaceCwd=useRef<string>();const loadingTabs=useRef(new Map<string, symbol>())
  const dshDark = useDshDarkTheme()
  const [theme,setTheme]=useState<WorkbenchTheme>(()=>{const saved=localStorage.getItem('dvw:theme');return saved==='dark'||saved==='light'||saved==='white'||saved==='eyecare'?saved:'dsh'})
  const [markdownView,setMarkdownView]=useState<MarkdownDefaultView>(()=>markdownDefaultView())
  const [reviewMode,setReviewMode]=useState<ReviewMode>(()=>{
    const saved=storedValue('dvw:ai-review-mode')
    return saved==='all'||saved==='latest'||saved==='none'
      ?saved
      :storedValue('dvw:ai-review')==='on'?'all':'none'
  })
  const reviewEnabled=reviewMode!=='none'
  const [reviewFollow,setReviewFollow]=useState(()=>storedValue('dvw:ai-review-follow')!=='off')
  const [reviewFollowing,setReviewFollowing]=useState(reviewFollow)
  const [reviewActiveId,setReviewActiveId]=useState<string>()
  const [reviewPageVisible,setReviewPageVisible]=useState(()=>document.visibilityState!=='hidden')
  const reviewController=useMemo(()=>sessionId===undefined||!reviewEnabled?undefined:new AiReviewController({sessionId,mode:reviewMode}),[sessionId,reviewEnabled,reviewMode])
  const [reviewSnapshot,setReviewSnapshot]=useState<AiReviewSnapshot>(()=>reviewController?.getSnapshot()??{changes:[],conflicts:{},busy:false,loading:false,working:false})
  const reviewFollowRef=useRef(false);reviewFollowRef.current=reviewFollowing
  const reviewSeenIds=useRef(new Set<string>())
  const reviewFollowCandidate=useRef<ReviewChange>()
  const reviewFollowTimer=useRef<ReturnType<typeof setTimeout>>()
  const reviewInteractionAt=useRef(Date.now())
  const reviewRunFollowRef=useRef<() => Promise<void>>(async()=>{})
  useEffect(()=>{localStorage.setItem('dvw:ai-review',reviewEnabled?'on':'off')},[reviewEnabled])
  useEffect(()=>localStorage.setItem('dvw:ai-review-mode',reviewMode),[reviewMode])
  useEffect(()=>{localStorage.setItem('dvw:ai-review-follow',reviewFollow?'on':'off')},[reviewFollow])
  useEffect(()=>setReviewFollowing(reviewFollow),[reviewFollow])
  useEffect(()=>{
    if(reviewController===undefined)return
    setReviewSnapshot(reviewController.getSnapshot())
    const unsubscribe=reviewController.subscribe(()=>setReviewSnapshot(reviewController.getSnapshot()))
    return()=>{unsubscribe();reviewController.dispose()}
  },[reviewController])
  useEffect(()=>{
    if(reviewController===undefined)return
    if(reviewEnabled&&snapshot.visible&&reviewPageVisible)reviewController.start()
    else reviewController.stop()
  },[reviewController,reviewEnabled,snapshot.visible,reviewPageVisible])
  useEffect(()=>{
    if(reviewEnabled)return
    try{localStorage.removeItem(`dvw:review:${sessionId??''}`)}catch{}
    setReviewSnapshot({changes:[],conflicts:{},busy:false,loading:false,working:false})
    setReviewActiveId(undefined)
  },[reviewEnabled,sessionId])
  useEffect(()=>{
    const visibility=()=>setReviewPageVisible(document.visibilityState!=='hidden')
    document.addEventListener('visibilitychange',visibility)
    return()=>document.removeEventListener('visibilitychange',visibility)
  },[])
  useEffect(()=>()=>{if(reviewFollowTimer.current!==undefined)clearTimeout(reviewFollowTimer.current)},[])
  const [commitDetail,setCommitDetail]=useState<CommitDetail>(()=>{const saved=localStorage.getItem('dvw:commit-detail');return saved==='concise'||saved==='detailed'?saved:'standard'})
  const [commitLanguage,setCommitLanguage]=useState<CommitLanguage>(()=>{const saved=localStorage.getItem('dvw:commit-language');return saved==='zh'||saved==='en'?saved:'auto'})
  const [commitModel,setCommitModel]=useState<CommitModelSelection|undefined>(readStoredCommitModel)
  const [commitModelConfigured,setCommitModelConfigured]=useState(()=>readStoredCommitModel()!==undefined)
  const [commitModels,setCommitModels]=useState<{status:'idle'|'loading'|'ready'|'error';models:CommitModelOption[];unavailable:CommitModelCatalog['unavailable'];defaultModel?:CommitModelSelection;error?:string}>({status:'idle',models:[],unavailable:[]})
  const commitModelsRequest=useRef(0)
  const commitModelsAbort=useRef<AbortController>()
  const refreshCommitModels=useCallback(async()=>{
    const request=++commitModelsRequest.current
    commitModelsAbort.current?.abort()
    const controller=commitModelsAbort.current=new AbortController()
    setCommitModels(current=>({...current,status:'loading',error:undefined}))
    try{
      const result=await api<unknown>('commit.models',sessionId===undefined?{}:{sessionId},controller.signal)
      if(result===null||typeof result!=='object'||Array.isArray(result)||!Array.isArray((result as Partial<CommitModelCatalog>).models)){
        throw new Error('DSH 返回的模型目录格式不正确')
      }
      const catalog=result as CommitModelCatalog
      const defaultModel=catalog.defaultModel===undefined?undefined:{provider:catalog.defaultModel.provider,model:catalog.defaultModel.model}
      if(request!==commitModelsRequest.current)return
      setCommitModels({status:'ready',models:catalog.models,unavailable:Array.isArray(catalog.unavailable)?catalog.unavailable:[],...(defaultModel===undefined?{}:{defaultModel})})
    }catch(error){
      if(request!==commitModelsRequest.current||controller.signal.aborted)return
      setCommitModels(current=>({...current,status:'error',error:error instanceof Error?error.message:String(error)}))
    }
  },[sessionId])
  useEffect(()=>{if(snapshot.visible||settingsOpen)void refreshCommitModels();else commitModelsAbort.current?.abort()},[snapshot.visible,settingsOpen,refreshCommitModels])
  useEffect(()=>()=>commitModelsAbort.current?.abort(),[])
  useEffect(()=>{
    if(commitModels.status!=='ready')return
    const defaultModel=commitModels.defaultModel
    const availableDefault=defaultModel!==undefined&&commitModels.models.some(model=>model.provider===defaultModel.provider&&model.model===defaultModel.model)?defaultModel:undefined
    if(!commitModelConfigured){setCommitModel(availableDefault);return}
    if(commitModel!==undefined){
      const selection=commitModel
      const available=commitModels.models.some(model=>model.provider===selection.provider&&model.model===selection.model)
      const providerUnavailable=commitModels.unavailable.some(provider=>provider.provider===selection.provider)
      if(available||providerUnavailable)return
    }
    setCommitModelConfigured(false)
    setCommitModel(availableDefault)
  },[commitModel,commitModelConfigured,commitModels])
  const colorScheme: 'dark' | 'light' | 'white' | 'eyecare' = theme === 'dsh' ? dshDark ? 'dark' : 'light' : theme
  const commitPreferences=useMemo<CommitMessagePreferences>(()=>({detail:commitDetail,language:commitLanguage}),[commitDetail,commitLanguage])
  useEffect(()=>localStorage.setItem('dvw:theme',theme),[theme])
  useEffect(()=>localStorage.setItem(MARKDOWN_DEFAULT_VIEW_KEY,markdownView),[markdownView])
  useEffect(()=>localStorage.setItem('dvw:commit-detail',commitDetail),[commitDetail])
  useEffect(()=>localStorage.setItem('dvw:commit-language',commitLanguage),[commitLanguage])
  useEffect(()=>{try{if(!commitModelConfigured)localStorage.removeItem('dvw:commit-model');else if(commitModel!==undefined)localStorage.setItem('dvw:commit-model',JSON.stringify(commitModel))}catch{/* Browser privacy settings may deny storage. */}},[commitModel,commitModelConfigured])
  const selectCommitModel=useCallback((value:CommitModelSelection|undefined)=>{setCommitModelConfigured(value!==undefined);setCommitModel(value)},[])
  useEffect(()=>{if(!snapshot.visible||theme==='dsh')return;const body=document.body;const root=document.documentElement;const wasDark=body.hasAttribute('data-ds-dark-theme');const previousColorScheme=root.style.colorScheme;body.toggleAttribute('data-ds-dark-theme',theme==='dark');root.style.colorScheme=theme==='dark'?'dark':'light';return()=>{body.toggleAttribute('data-ds-dark-theme',wasDark);if(previousColorScheme==='')root.style.removeProperty('color-scheme');else root.style.colorScheme=previousColorScheme}},[snapshot.visible,theme])
  useEffect(()=>localStorage.setItem('dvw:outline',outlineVisible?'open':'closed'),[outlineVisible])
  useEffect(()=>localStorage.setItem('dvw:dsh-chat-visible',chatVisible?'open':'closed'),[chatVisible])
  // A session created from DSH's own menu (including Creator mode) must land in the
  // conversation panel rather than leaving the workbench on the previous panel.
  const sessionIdRef=useRef(sessionId)
  const sessionHydrated=useRef(sessionId!==undefined)
  useEffect(()=>{
    if(!sessionHydrated.current){
      if(sessionId===undefined)return
      sessionIdRef.current=sessionId
      sessionHydrated.current=true
      return
    }
    if(sessionIdRef.current===sessionId)return
    sessionIdRef.current=sessionId
    if(sessionId===undefined)return
    setDshTabActive(false)
    if(snapshot.visible)setChatVisible(true)
  },[sessionId,snapshot.visible])
  useEffect(()=>localStorage.setItem('dvw:dsh-chat-width',String(Math.round(chatWidth))),[chatWidth])
  useEffect(()=>localStorage.setItem('dvw:primary-side-visible',primarySideVisible?'open':'closed'),[primarySideVisible])
  useEffect(()=>localStorage.setItem('dvw:status-bar-visible',statusVisible?'open':'closed'),[statusVisible])
  useEffect(()=>localStorage.setItem('dvw:git-diff-style',gitDiffStyle),[gitDiffStyle])
  useEffect(()=>localStorage.setItem('dvw:git-line-blame',String(gitLineBlame)),[gitLineBlame])
  useEffect(()=>localStorage.setItem('dvw:font-size',String(fontSize)),[fontSize])
  useEffect(()=>{
    if(hostDshPanelId!==undefined){setDshTabId(hostDshPanelId);setDshTabActive(true);return}
    // DSH's own navigation left the panel (for example the user clicked the
    // conversation). Release the tab instead of selecting the panel again: a
    // reopen here would fight the host and trap the user on the plugin page.
    if(dshTabActiveRef.current){setDshTabId(undefined);setDshTabActive(false)}
  },[hostDshPanelId])
  // The host only mounts its conversation while no global panel is selected, so
  // showing a file must hand the centre back; clicking the tab re-selects it.
  useEffect(()=>{
    if(dshTabActive||dshTabId===undefined||hostDshPanelId===undefined)return
    restoreConversationRef.current?.()
  },[dshTabActive,dshTabId,hostDshPanelId])
  // Only a local activation (clicking the tab) asks DSH to select the panel
  // again. Host-driven changes must never bounce the centre back to the panel.
  useEffect(()=>{
    if(!dshTabActive)return
    const id=dshTabIdRef.current
    if(id===undefined||hostDshPanelIdRef.current===id)return
    openDshPanelRef.current?.(id)
  },[dshTabActive])
  useEffect(()=>{if(tabMenu===undefined)return;const close=()=>setTabMenu(undefined);const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape)}},[tabMenu])
  useEffect(() => {
    if (!snapshot.visible || openMode === 'floating') return
    document.body.setAttribute('data-dvw-workbench-active', '')
    return () => document.body.removeAttribute('data-dvw-workbench-active')
  }, [snapshot.visible, openMode])
  useEffect(()=>{if(!snapshot.visible)return;const onKey=(event:KeyboardEvent)=>{if(event.isComposing||!event.ctrlKey||!event.altKey||event.shiftKey||event.code!=='KeyB')return;event.preventDefault();if(dshTabActiveRef.current&&dshTabIdRef.current!==undefined){showConversation();return}setChatVisible(value=>!value)};window.addEventListener('keydown',onKey,true);return()=>window.removeEventListener('keydown',onKey,true)},[snapshot.visible,showConversation])
  useEffect(()=>{
    if(!floating||!snapshot.visible)return
    const onKey=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.isComposing||event.repeat||event.altKey)return
      const toggle=event.key==='F11'||(event.ctrlKey&&event.metaKey&&!event.shiftKey&&event.code==='KeyF')
      if(!toggle)return
      event.preventDefault()
      event.stopPropagation()
      void toggleFloatFullscreen()
    }
    window.addEventListener('keydown',onKey,true)
    return ()=>window.removeEventListener('keydown',onKey,true)
  },[floating,snapshot.visible,toggleFloatFullscreen])
  useEffect(()=>{
    if(openMode==='floating'||document.fullscreenElement===null||typeof document.exitFullscreen!=='function')return
    void document.exitFullscreen().catch(()=>{})
  },[openMode])
  // The conversation may still be attaching after the chat column opens, so retry for about a second.
  const addToDsh=useCallback((reference:string)=>{setChatVisible(true);let frames=0;const attempt=()=>{void insertIntoDshComposer(reference).then(done=>{if(done)return;if(++frames<60){requestAnimationFrame(attempt);return}alert('DSH 对话输入框当前不可用，请先选择会话或等待当前回复结束。')})};requestAnimationFrame(attempt)},[])
  const addEntryToDsh=useCallback((path:string,directory:boolean)=>addToDsh(dshReference(path,{directory})),[addToDsh])
  const openForWorkspace=(path:string,line?:number,column?:number,highlight?:string,focusOnReveal=true)=>{
    // HTML is a page, not source: hand it to the configured browser so its assets resolve.
    if(!path.startsWith('diff:')&&/\.html?$/i.test(path)){void openSiteFile(path);return}
    const existing=tabsRef.current.find(tab=>tab.path===path);if(existing)setTabs(rows=>rows.map(tab=>tab.path===path?{...tab,line,column,highlight,focusOnReveal,preview:line!==undefined?false:tab.preview}:tab));else setTabs(rows=>[...rows,{...unloadedTab(path),line,column,highlight,focusOnReveal,...(line!==undefined?{preview:false}:{})}]);leaveDshPanel();setActive(path)}
  useEffect(() => {
    if (sessionId === undefined) return
    // Switching sessions inside one workspace must keep the explorer, tabs and layout as they are.
    if (loadedWorkspaceCwd.current !== undefined && loadedWorkspaceCwd.current === cwd) return
    const epoch = workspaceRequests.current.begin()
    const cleared = resetWorkspaceDocuments<Tab>()
    loadingTabs.current.clear(); setWorkspace(undefined); setTabs(cleared.tabs)
    tabsRef.current = cleared.tabs; focusedRef.current = 'pane-1'; setFocusedId('pane-1'); setGroups([{ id: 'pane-1', tabs: cleared.tabs, active: cleared.active }]); setLayout(createLeaf('pane-1')); setError(cleared.error)
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
            if (parsed.view && service.getSnapshot().visible && !searchNavigationPending.current) service.show(parsed.view)
            searchNavigationPending.current = false
            if (typeof parsed.panelHeight === 'number') setPanelHeight(parsed.panelHeight)
            if (typeof parsed.sideWidth === 'number') setSideWidth(Math.max(210, Math.min(640, Math.round(parsed.sideWidth))))
            restored = restoreTabPaths(parsed.paths ?? []); selected = parsed.active
            const savedLayout = (parsed as { layout?: unknown }).layout
            const savedGroups = (parsed as { groups?: Array<{ id?: string; paths?: string[]; active?: string }> }).groups
            const drafts: unknown = JSON.parse(localStorage.getItem(`dvw:drafts:${sessionId}:${value.cwd}`) ?? '[]')
            const draftTabs: Tab[] = []
            if (Array.isArray(drafts)) for (const draft of drafts) {
              if (!draft || typeof draft.path !== 'string' || typeof draft.content !== 'string' || typeof draft.draft !== 'string' || typeof draft.revision !== 'string' || draft.path.startsWith('diff:')) continue
              const tab = { ...unloadedTab(draft.path), content: draft.content, draft: draft.draft, revision: draft.revision, dirty: draft.draft !== draft.content, loaded: true }
              draftTabs.push(tab as Tab)
            }
            const withDrafts = (rows: Tab[]): Tab[] => rows.map(row => draftTabs.find(tab => tab.path === row.path) ?? row)
            if (Array.isArray(savedGroups) && savedGroups.length > 0) {
              // A saved pane layout owns both the tabs and the actives; the flat `paths`/`active`
              // above are only the legacy single-pane shape and must not overwrite the first pane.
              const rebuilt: EditorGroup[] = savedGroups.map((row, index) => ({
                id: typeof row.id === 'string' && row.id !== '' ? row.id : `pane-${index + 1}`,
                tabs: withDrafts(restoreTabPaths(Array.isArray(row.paths) ? row.paths.filter((item): item is string => typeof item === 'string') : [])),
                active: typeof row.active === 'string' ? row.active : undefined,
              }))
              focusedRef.current = rebuilt[0]!.id; setFocusedId(rebuilt[0]!.id)
              setLayout(normalizeLayout(savedLayout, rebuilt.map(row => row.id), rebuilt[0]!.id))
              setGroups(rebuilt)
              // Restored tabs carry no content; without this they stay on 正在加载文件 forever.
              for (const group of rebuilt) for (const tab of group.tabs) if (!tab.loaded) loadTab(tab.path, group.id)
            } else {
              for (const tab of draftTabs) restored = [...restored.filter(row => row.path !== tab.path), tab]
              setTabs(restored)
              setActive(restored.some(tab => tab.path === selected) ? selected : restored.at(-1)?.path)
              for (const tab of restored) if (!tab.loaded) loadTab(tab.path)
            }
          } catch { /* Invalid saved state must not prevent opening the workspace. */ }
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
        localStorage.setItem(`dvw:${workspace.cwd}`, JSON.stringify({ view: snapshot.view, paths: tabs.filter(t => !t.path.startsWith('diff:')).map(t => t.path), active, panelHeight, sideWidth, layout, groups: groups.map(group => ({ id: group.id, paths: group.tabs.filter(t => !t.path.startsWith('diff:')).map(t => t.path), active: group.active })) }))
        localStorage.setItem(`dvw:drafts:${sessionId}:${workspace.cwd}`, JSON.stringify(tabs.filter(tab => tab.dirty).map(({ path, content, draft, revision }) => ({ path, content, draft, revision }))))
      } catch { setError('无法保存工作区草稿，请在离开页面前保存文件。') }
    }
    persistWorkspace.current = persist
    const timer = setTimeout(persist, 300)
    return () => clearTimeout(timer)
  }, [workspace, sessionId, snapshot.view, tabs, active, panelHeight, sideWidth, layout, groups])
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
  const openTabPaths = groups.flatMap(group => group.tabs).filter(tab => !tab.path.startsWith('diff:')).map(tab => tab.path).join('\0')
  useEffect(() => {
    if (workspace !== undefined) retainEditorModels(openTabPaths === '' ? [] : openTabPaths.split('\0').map(path => `${workspace.cwd}/${path}`))
  }, [workspace, openTabPaths])
  const loadTab = useCallback((path: string, groupId = focusedRef.current) => {
    if (sessionId === undefined) return
    const epoch = workspaceRequests.current.current()
    // The read may finish after the user moved to another pane; keep writing to the pane that asked.
    const token = Symbol(path)
    const key = tabLoadKey(groupId, path)
    loadingTabs.current.set(key, token)
    const current = () => workspaceRequests.current.isCurrent(epoch) && loadingTabs.current.get(key) === token
    const documentPreview = documentPreviewKind(path)
    const image = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path)
    if (documentPreview !== undefined || image) {
      const url = `/dsh-vscode/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}&v=${Date.now()}`
      setTabsIn(groupId, rows => rows.map(row => row.path === path ? { ...row, loaded: true, ...(image ? { imageUrl: url } : { documentPreview, documentUrl: url }) } : row))
      loadingTabs.current.delete(key); return
    }
    void withTimeout(api<FileDocument>('fs.read', { sessionId, path }), 12000, `读取 ${path}`).then(doc => {
      if (!current()) return
      if (doc.binary || doc.tooLarge) {
        setTabsIn(groupId, rows => rows.map(row => row.path === path ? { ...row, loaded: true, ...(row.dirty ? {} : { binary: doc.binary, tooLarge: doc.tooLarge }), external: true } : row)); return
      }
      setTabsIn(groupId, rows => rows.map(row => row.path !== path ? row : row.dirty
        ? { ...row, external: row.revision !== doc.revision }
        : { ...row, ...doc, draft: doc.content, loaded: true, external: false }))
    }).catch(error => { if (current()) setError(String(error)) })
      .finally(() => { if (current()) loadingTabs.current.delete(key) })
  }, [sessionId])
  const refreshChangedTabs = useCallback((paths?: string[]) => {
    window.dispatchEvent(new CustomEvent('dvw-files-changed', { detail: paths }))
    for (const group of groupsRef.current) for (const tab of group.tabs) {
      if (tab.path.startsWith('diff:') || tab.loaded === false) continue
      if (paths === undefined || paths.some(path => tab.path === path || tab.path.startsWith(`${path}/`))) loadTab(tab.path, group.id)
    }
  }, [loadTab])
  useEffect(() => {
    if (!snapshot.visible || sessionId === undefined || workspace === undefined) return
    const query = new URLSearchParams({ sessionId })
    const url = websocketUrl(`/dsh-vscode/ws/files?${query.toString()}`)
    if (url === undefined) return
    const ws = new WebSocket(url)
    let closed = false
    const refresh = (paths?: string[]) => {
      if (closed) return
      refreshChangedTabs(paths)
    }
    ws.onopen = () => refresh()
    ws.onmessage = event => {
      try { const value = JSON.parse(String(event.data)) as { paths?: string[] }; if (Array.isArray(value.paths) && value.paths.every(path => typeof path === 'string')) refresh(value.paths) } catch { /* Ignore invalid notifications. */ }
    }
    return () => { closed = true; ws.close() }
  }, [snapshot.visible, sessionId, workspace, refreshChangedTabs])
  useEffect(() => {
    if (!snapshot.visible || sessionId === undefined || workspace === undefined) return
    for (const group of groups) {
      const tab = group.tabs.find(row => row.path === group.active)
      if (tab?.loaded === false && !loadingTabs.current.has(tabLoadKey(group.id, tab.path))) loadTab(tab.path, group.id)
    }
  }, [snapshot.visible, sessionId, workspace, groups, loadTab])
  useEffect(() => {
    const list = tabListRef.current
    const selected = list?.querySelector<HTMLElement>('.dvw-tab[data-active="true"]')
    if (list === null || selected === null || selected === undefined) return
    const listRect = list.getBoundingClientRect()
    const tabRect = selected.getBoundingClientRect()
    list.scrollLeft = tabScrollLeft(list.scrollLeft, listRect, tabRect)
  }, [active, tabs.length])
  const open=(path:string,line?:number,column?:number,highlight?:string,focusOnReveal=true)=>{if(sessionId!==undefined)openForWorkspace(path,line,column,highlight,focusOnReveal)}
  // Stable handlers let the memoised side views skip re-rendering while the editor types.
  const openRef=useRef(open);openRef.current=open
  const openPath=useCallback((path:string,line?:number,column?:number,highlight?:string,focusOnReveal=true)=>openRef.current(path,line,column,highlight,focusOnReveal),[])
  const [switcherOpen,setSwitcherOpen]=useState(false);const [switcherChoices,setSwitcherChoices]=useState<WorkspaceChoice[]>([]);const [switcherBusy,setSwitcherBusy]=useState(false);const [switcherError,setSwitcherError]=useState<string>()
  const openSwitcher=useCallback(()=>{setSwitcherError(undefined);setSwitcherChoices(navigation?.choices(sessionId)??[]);setSwitcherOpen(true)},[navigation,sessionId])
  const showConversationAfterSwitch=useCallback(()=>{setSwitcherOpen(false);setDshTabActive(false);setChatVisible(true)},[])
  const switchSession=useCallback((id:string)=>{navigation?.openSession(id);showConversationAfterSwitch()},[navigation,showConversationAfterSwitch])
  const newSession=useCallback((workspaceId?:string)=>{
    const target=workspaceId??navigation?.choices(sessionId).find(choice=>choice.sessions.some(session=>session.id===sessionId))?.id
    if(navigation?.startSession(target)===true)showConversationAfterSwitch()
  },[navigation,sessionId,showConversationAfterSwitch])
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
  // The settings page is rendered through a portal from this tree; keep its callbacks referentially stable
  // so its mount effect re-probes the machine once instead of on every render.
  const refreshLspAction=useCallback(()=>{void refreshLsp()},[refreshLsp])
  const changeLspAction=useCallback((id:string,action:'install'|'uninstall')=>{void changeLsp(id,action)},[changeLsp])
  useEffect(()=>{if(!snapshot.visible||sessionId===undefined||workspace===undefined)return;void refreshLsp()},[snapshot.visible,sessionId,workspace,refreshLsp])
  useEffect(()=>()=>{lspManager.current?.dispose()},[])
  useEffect(()=>{try{localStorage.setItem(TS_INTELLISENSE_KEY,tsIntellisense?'on':'off')}catch{}},[tsIntellisense])
  const hasTextTabs = groups.some(group => group.tabs.some(tab => tab.loaded && !tab.documentPreview && !tab.imageUrl))
  // Definition and reference jumps land in workbench tabs for every language, including LSP servers
  // that are independent of Monaco's built-in TypeScript index.
  useEffect(()=>{
    if(!snapshot.visible||sessionId===undefined||workspace===undefined)return
    if (!hasTextTabs) return
    let cancelled=false;let disposable:{dispose():void}|undefined
    void loadMonaco().then(monaco=>{
      if(cancelled)return
      const cwd=workspace.cwd
      disposable=monaco.editor.registerEditorOpener({openCodeEditor:(_source,resource,selection)=>{const path=workspacePathFromModel(cwd,resource.toString());if(path===undefined)return false;const position=selection===undefined?undefined:'startLineNumber' in selection?{line:selection.startLineNumber,column:selection.startColumn}:{line:selection.lineNumber,column:selection.column};openPath(path,position?.line,position?.column);return true}})
    }).catch(error => { if (!cancelled) setError(String(error)) })
    return()=>{cancelled=true;disposable?.dispose()}
  },[snapshot.visible,sessionId,workspace,openPath,hasTextTabs])
  useEffect(()=>{
    if(sessionId===undefined||workspace===undefined)return
    const cwd=workspace.cwd
    // Not installed: never load Monaco just for this, only release an index a previous install built.
    if(!tsIntellisense){if(window.monaco!==undefined)disposeTypeScriptProject(window.monaco);setTsIndex({state:'idle'});return}
    const existing=typeScriptProjectStatus(cwd)
    if(existing!==undefined)setTsIndex(current=>current.state==='ready'&&current.files===existing.files&&current.truncated===existing.truncated?current:{state:'ready',...existing})
    if(!snapshot.visible)return
    let cancelled=false
    let changed: ((event: Event) => void) | undefined
    const start=(monaco:Awaited<ReturnType<typeof loadMonaco>>)=>{
      if(cancelled)return
      if(existing===undefined)setTsIndex({state:'loading'})
      changed=(event:Event)=>{const paths=(event as CustomEvent<string[]|undefined>).detail;if(Array.isArray(paths))void refreshIndexedFiles(monaco,sessionId,cwd,paths)}
      window.addEventListener('dvw-files-changed',changed)
      void indexTypeScriptProject(monaco,sessionId,cwd).then(result=>{if(!cancelled)setTsIndex({state:'ready',...result})}).catch(error=>{if(!cancelled)setTsIndex({state:'error',error:error instanceof Error?error.message:String(error)})})
    }
    if(window.monaco!==undefined)start(window.monaco)
    else void loadMonaco().then(start).catch(error => { if (!cancelled) setTsIndex({state:"error",error:String(error)}) })
    return()=>{cancelled=true;if(changed!==undefined)window.removeEventListener('dvw-files-changed',changed)}
  },[snapshot.visible,sessionId,workspace,tsIntellisense])
  useEffect(()=>()=>{if(window.monaco!==undefined)disposeTypeScriptProject(window.monaco)},[])
  const openCommitPreview=useCallback((commit:string,path:string,title?:string)=>{
    const key=`commit-file:${commit}:${path}`
    const url=`/dsh-vscode/file?sessionId=${encodeURIComponent(sessionId??'')}&path=${encodeURIComponent(path)}&commit=${encodeURIComponent(commit)}`
    const image=IMAGE_PREVIEW_FILE.test(path)
    const documentPreview=documentPreviewKind(path)
    setTabs(rows=>[...rows.filter(row=>row.path!==key),{path:key,title:title??path.split('/').at(-1)??path,content:'',draft:'',revision:commit,size:0,dirty:false,loaded:true,binary:false,tooLarge:false,diffSourcePath:path,imageUrl:image?url:undefined,documentPreview,documentUrl:documentPreview===undefined?undefined:url}])
    leaveDshPanel();setActive(key)
  },[sessionId,leaveDshPanel])
  const openDiff=useCallback((path:string,diff:GitDiff|undefined,title?:string,diffSourcePath?:string,preview?:{commit:string;path:string})=>{const key=`diff:${path}`;const source=diffSourcePath??path
    // Previewable documents open like VS Code's PDF/Office editors, including versions from commit history.
    if(preview!==undefined&&isPreviewDocumentPath(preview.path)){openCommitPreview(preview.commit,preview.path,title);return}
    if(diff===undefined)return
    if(isPreviewDocumentPath(source)&&!path.startsWith('commit:')){openPath(source);return}const binary=isBinaryDiffPath(source)||diff.original.includes('\0')||diff.modified.includes('\0')||/^Binary files .* differ$/m.test(diff.diff);setTabs(rows=>[...rows.filter(row=>row.path!==key),{path:key,title,content:diff.diff,draft:diff.diff,revision:'',size:diff.diff.length,binary,tooLarge:false,dirty:false,diff:binary?undefined:diff,diffSourcePath:source}]);leaveDshPanel();setActive(key)},[openPath,openCommitPreview,leaveDshPanel])
  useEffect(()=>{
    const listener=(event:Event)=>{
      const detail=(event as CustomEvent<string|{sessionId?:string;path?:string;line?:number}>).detail
      if(typeof detail==='string'){void open(detail);return}
      if(detail?.sessionId!==undefined&&detail.sessionId!==sessionId)return
      if(typeof detail?.path==='string'&&detail.path!=='')void open(detail.path,detail.line)
    }
    window.addEventListener('dvw-open-workspace-path',listener)
    window.addEventListener('dvw-open-generated-file',listener)
    return()=>{window.removeEventListener('dvw-open-workspace-path',listener);window.removeEventListener('dvw-open-generated-file',listener)}
  },[sessionId])
  const savingTabs = useRef(new Set<string>())
  const cancelTabLoads = useCallback((path: string) => {
    const suffix = `\0${path}`
    for (const key of loadingTabs.current.keys()) if (key.endsWith(suffix)) loadingTabs.current.delete(key)
  },[])
  const save = async (tab: Tab) => {
    if (sessionId === undefined || !tab.dirty || savingTabs.current.has(tab.path)) return
    const epoch = workspaceRequests.current.current()
    const groupId = focusedRef.current
    savingTabs.current.add(tab.path)
    cancelTabLoads(tab.path)
    try {
      const doc = await api<FileDocument>('fs.save', { sessionId, path: tab.path, content: tab.draft, revision: tab.revision })
      if (!workspaceRequests.current.isCurrent(epoch)) return
      cancelTabLoads(tab.path)
      setTabsIn(groupId, rows => rows.map(row => row.path === tab.path && row.instance === tab.instance ? { ...row, ...doc, draft: row.draft, dirty: row.draft !== doc.content, external: false } : row))
    } catch (error) { if (workspaceRequests.current.isCurrent(epoch)) setError(String(error)) }
    finally { savingTabs.current.delete(tab.path) }
  }
  const close=(tab:Tab)=>{if(tab.dirty&&!confirm(`${tab.path} 有未保存更改，确定关闭？`))return;loadingTabs.current.delete(tabLoadKey(focusedRef.current,tab.path));setTabs(rows=>rows.filter(row=>row.path!==tab.path));if(active===tab.path)setActive(tabs.filter(row=>row.path!==tab.path).at(-1)?.path)}
  const closeAll=()=>{const dirty=tabs.filter(tab=>tab.dirty);if(dirty.length>0&&!confirm(`有 ${dirty.length} 个文件包含未保存更改，确定全部关闭？`))return;loadingTabs.current.clear();setTabs([]);setActive(undefined);setError(undefined);setTabMenu(undefined)}
  const removeTabs=(targets:Tab[],verb:string)=>{if(targets.length===0)return;const dirty=targets.filter(tab=>tab.dirty).length;if(dirty>0&&!confirm(`有 ${dirty} 个文件包含未保存更改，确定${verb}？`))return;const paths=new Set(targets.map(tab=>tab.path));for(const path of paths)loadingTabs.current.delete(tabLoadKey(focusedRef.current,path));const remaining=tabsRef.current.filter(tab=>!paths.has(tab.path));setTabs(remaining);if(active!==undefined&&paths.has(active))setActive(remaining.at(-1)?.path);setTabMenu(undefined)}
  const activeTab=tabs.find(tab=>tab.path===active)
  // Files the workbench cannot render fall back to the desktop's own file handlers.
  const unsupportedTab=activeTab!==undefined&&(activeTab.binary||activeTab.tooLarge)&&!activeTab.path.startsWith('diff:')
    ?{path:activeTab.path,label:activeTab.binary?'该格式文件暂时无法预览':`文件超过 5 MiB：${activeTab.path}`}
    :undefined
  const reviewByPath=useMemo(()=>{
    const map=new Map<string,ReviewChange[]>()
    for(const change of reviewSnapshot.changes){const list=map.get(change.path);if(list===undefined)map.set(change.path,[change]);else list.push(change)}
    return map
  },[reviewSnapshot.changes])
  const reviewFiles=useMemo(()=>[...reviewByPath].map(([path,changes])=>({path,count:changes.length})).sort((left,right)=>left.path.localeCompare(right.path)),[reviewByPath])
  const rejectReviewIn=async(groupId:string,tab:Tab,ids:string[])=>{
    if(reviewController===undefined||ids.length===0)return
    if(tab.dirty){setError('文件存在未保存的手动修改，请先处理后再撤销');return}
    if(reviewSnapshot.busy||reviewSnapshot.working)return
    setError(undefined)
    try{
      const result=await reviewController.reject(tab.path,ids)
      setReviewActiveId(undefined)
      if(result.deleted)closeInGroup(groupId,tab)
      window.dispatchEvent(new CustomEvent('dvw-files-changed',{detail:[tab.path]}))
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
  }
  const keepReview=(ids:string[])=>{if(reviewController!==undefined)void reviewController.keep(ids)}
  const keepAllReview=()=>keepReview(reviewSnapshot.changes.map(change=>change.id))
  const rejectAllReview=async()=>{
    if(reviewController===undefined||reviewSnapshot.changes.length===0)return
    if(reviewSnapshot.busy||reviewSnapshot.working)return
    const paths=[...new Set(reviewSnapshot.changes.map(change=>change.path))]
    const dirtyPaths=new Set(groupsRef.current.flatMap(group=>group.tabs.filter(tab=>tab.dirty).map(tab=>tab.path)))
    const dirty=paths.find(path=>dirtyPaths.has(path))
    if(dirty!==undefined){setError(`${dirty} 存在未保存的手动修改，请先处理后再撤销`);return}
    setError(undefined)
    try{
      for(const path of paths){
        const result=await reviewController.reject(path)
        if(result.deleted){
          setGroups(current=>current.map(group=>({...group,tabs:group.tabs.filter(tab=>tab.path!==path),active:group.active===path?group.tabs.filter(tab=>tab.path!==path).at(-1)?.path:group.active})))
        }
      }
      setReviewActiveId(undefined)
      window.dispatchEvent(new CustomEvent('dvw-files-changed',{detail:paths}))
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
  }
  const Panel=panels.find(panel=>panel.id===snapshot.bottomPanel)?.component; const terminalAvailable=panels.some(panel=>panel.id==='terminal')
  const menuTab=tabMenu===undefined?undefined:tabs.find(tab=>tab.path===tabMenu.path); const menuIndex=menuTab===undefined?-1:tabs.findIndex(tab=>tab.path===menuTab.path); const savedTabs=tabs.filter(tab=>!tab.dirty)
  const selectView=(view:WorkbenchView)=>{if(snapshot.view===view&&primarySideVisible){setPrimarySideVisible(false);return}setPrimarySideVisible(true);service.show(view)}
  const [activityOrder,setActivityOrder]=useState<string[]>(readActivityOrder)
  const [activityHidden,setActivityHidden]=useState<string[]>(()=>{const value=readActivityJSON('dvw:activity-hidden');return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&(ACTIVITY_VIEW_IDS as readonly string[]).includes(id)):[]})
  useEffect(()=>localStorage.setItem('dvw:activity-order-v2',JSON.stringify(activityOrder)),[activityOrder])
  useEffect(()=>localStorage.setItem('dvw:activity-hidden',JSON.stringify(activityHidden)),[activityHidden])
  useEffect(()=>{
    if(activityHidden.includes('chat')&&chatVisible)setChatVisible(false)
    if(activityHidden.includes('terminal')&&snapshot.bottomPanel==='terminal')toggleTerminal(service)
    if(primarySideVisible&&(snapshot.view==='explorer'||snapshot.view==='search'||snapshot.view==='git')&&activityHidden.includes(snapshot.view))setPrimarySideVisible(false)
  },[activityHidden])
  const openInGroup = useCallback((groupId: string, path: string, line?: number, column?: number, highlight?: string, focusOnReveal = true) => {
    focusGroup(groupId)
    requestAnimationFrame(() => openPath(path, line, column, highlight, focusOnReveal))
  },[focusGroup,openPath])
  useEffect(()=>{
    const current=new Set(reviewSnapshot.changes.map(change=>change.id))
    const previousSeen=new Set(reviewSeenIds.current)
    reviewSeenIds.current=current
    if(!reviewEnabled||!reviewFollowing||!reviewPageVisible||reviewController===undefined){
      if(reviewFollowTimer.current!==undefined){clearTimeout(reviewFollowTimer.current);reviewFollowTimer.current=undefined}
      reviewFollowCandidate.current=undefined
      return
    }
    // Turning follow on after review is already active should still jump to the
    // latest pending change; waiting only for a brand-new ID leaves the user
    // stranded on whichever tab happened to be open.
    const latest=latestReviewFollowChange(reviewSnapshot.changes,previousSeen)
    if(latest===undefined)return
    if(reviewFollowTimer.current!==undefined){clearTimeout(reviewFollowTimer.current);reviewFollowTimer.current=undefined}
    reviewFollowCandidate.current=latest
    const schedule=()=>{
      if(reviewFollowTimer.current!==undefined)clearTimeout(reviewFollowTimer.current)
      const wait=Math.max(0,1500-(Date.now()-reviewInteractionAt.current))
      reviewFollowTimer.current=setTimeout(()=>{reviewFollowTimer.current=undefined;void reviewRunFollowRef.current()},wait)
    }
    reviewRunFollowRef.current=async()=>{
      const candidate=reviewFollowCandidate.current
      if(candidate===undefined||!reviewFollowRef.current||!reviewEnabled||document.visibilityState==='hidden')return
      const snapshot=reviewController.getSnapshot()
      const target=snapshot.changes.find(change=>change.id===candidate.id)??snapshot.changes.find(change=>change.path===candidate.path)
      if(target===undefined)return
      try{
        const inspected=await reviewController.inspect(target.path)
        const targetChange=snapshot.changes.find(change=>change.id===candidate.id)??target
        const change=inspected.changes.find(item=>item.id===targetChange.id)?.id===targetChange.id?targetChange:target
        const location=locateReviewChange(inspected.content,change)
        setReviewActiveId(change.id)
        openPath(change.path,location?.startLine,location===undefined?undefined:1,undefined,false)
      }catch{/* A conflict or vanished file remains visible in its tab and review bar. */}
    }
    schedule()
  },[reviewSnapshot.changes,reviewEnabled,reviewFollowing,reviewPageVisible,reviewController,openPath])
  useEffect(()=>{
    if(!reviewEnabled)return
    const interacted=()=>{
      reviewInteractionAt.current=Date.now()
      if(reviewFollowTimer.current!==undefined){clearTimeout(reviewFollowTimer.current);reviewFollowTimer.current=undefined}
      if(reviewFollowCandidate.current===undefined||!reviewFollowRef.current)return
      reviewFollowTimer.current=setTimeout(()=>{reviewFollowTimer.current=undefined;void reviewRunFollowRef.current()},1500)
    }
    const options:AddEventListenerOptions={passive:true,capture:true}
    window.addEventListener('pointerdown',interacted,options)
    window.addEventListener('wheel',interacted,options)
    window.addEventListener('keydown',interacted,options)
    window.addEventListener('touchstart',interacted,options)
    return()=>{
      window.removeEventListener('pointerdown',interacted,options)
      window.removeEventListener('wheel',interacted,options)
      window.removeEventListener('keydown',interacted,options)
      window.removeEventListener('touchstart',interacted,options)
    }
  },[reviewEnabled])
  const suppressAttachmentDrop=(event:DragEvent)=>{if(!event.dataTransfer.types.includes('Files'))return;const target=event.target;const insideTree=target instanceof Element&&target.closest('.dvw-tree')!==null;if(!insideTree){event.preventDefault();event.stopPropagation()}}
  const commitModelAvailable=commitModels.status==='ready'&&commitModel!==undefined&&commitModels.models.some(model=>model.provider===commitModel.provider&&model.model===commitModel.model)
  const commitModelHint=commitModels.status==='loading'||commitModels.status==='idle'?'正在读取 DSH 聊天中的模型':commitModels.status==='error'||commitModels.unavailable.length>0?'聊天模型当前不可用，请在设置中刷新或重新选择':'没有可用的聊天模型，请在设置中选择'
  const [gitStatusSlot,setGitStatusSlot] = useState<HTMLDivElement|null>(null)
  const settingsPage=<WorkbenchSettings gitDiffStyle={gitDiffStyle} setGitDiffStyle={setGitDiffStyle} gitLineBlame={gitLineBlame} setGitLineBlame={setGitLineBlame} reviewMode={reviewMode} setReviewMode={setReviewMode} reviewFollow={reviewFollow} setReviewFollow={setReviewFollow} theme={theme} setTheme={setTheme} fontSize={fontSize} setFontSize={setFontSize} primarySideVisible={primarySideVisible} setPrimarySideVisible={setPrimarySideVisible} chatVisible={chatVisible} setChatVisible={setChatVisible} statusVisible={statusVisible} setStatusVisible={setStatusVisible} markdownView={markdownView} setMarkdownView={setMarkdownView} defaultBrowser={defaultBrowser} setDefaultBrowser={setDefaultBrowser} openMode={openMode} setOpenMode={setOpenMode} resetFloatWindow={resetFloatGeometry} commitDetail={commitDetail} setCommitDetail={setCommitDetail} commitLanguage={commitLanguage} setCommitLanguage={setCommitLanguage} commitModel={commitModel} commitModelConfigured={commitModelConfigured} setCommitModel={selectCommitModel} commitModels={commitModels.models} commitModelStatus={commitModels.status} commitModelUnavailable={commitModels.unavailable} commitModelError={commitModels.error??''} refreshCommitModels={()=>void refreshCommitModels()} tsIntellisense={tsIntellisense} setTsIntellisense={setTsIntellisense} tsIndex={tsIndex} lspServers={lspServers} lspBusy={lspBusy} lspError={lspError} changeLsp={changeLspAction} refreshLsp={refreshLspAction}/>
  if(!snapshot.visible)return settingsNode===undefined?null:createPortal(settingsPage,settingsNode)
  const floatTop=dshTitlebarHeight()
  const floatRectNow=floatMax
    ?{left:0,top:floatTop,width:viewport.width,height:Math.max(320,viewport.height-floatTop)}
    :{left:floatRect.x,top:floatRect.y,width:floatRect.width,height:floatRect.height}
  const floatStyle=floating?{...floatRectNow,paddingTop:FLOAT_BAR_HEIGHT} as CSSProperties:undefined
  if(sessionId===undefined)return settingsNode===undefined
    ? <div ref={overlayRef} className="dvw-overlay" data-dvw-theme={colorScheme} data-dvw-theme-name={theme} data-dvw-float={floating||undefined} data-dvw-float-max={floating&&floatMax||undefined} data-dvw-float-fullscreen={floating&&floatFullscreen||undefined} style={floatStyle}>{floating&&<FloatBar fullscreen={floatFullscreen} onPointerDown={event=>beginFloatGesture(event,'move')} onToggleFullscreen={()=>void toggleFloatFullscreen()} onClose={()=>service.hide()}/>}<div className="dvw-empty" style={{gridColumn:'1/4'}}><div>请先选择或创建一个 DSH 会话。<br/><button onClick={()=>service.hide()}>返回 DSH</button></div></div></div>
    : createPortal(settingsPage,settingsNode)
  const showingDshPanel=dshTabId!==undefined&&dshTabActive
  const closeDshPanel=()=>{setDshTabActive(false);setDshTabId(undefined);onCloseDshPanel?.()}
  const openFromView=openPath
  const chatShown=chatVisible&&!showingDshPanel&&!floating
  const renderPaneChrome = (group: EditorGroup, tabs: Tab[], active: string | undefined, activeTab: Tab | undefined, focused: boolean, paneMarkdown: boolean, paneDiffMarkdown: boolean, markdownPreview: boolean) => {
    const setActive = (value?: string) => { focusGroup(group.id); setActiveIn(group.id, value) }
    const setTabs = (update: Tab[] | ((rows: Tab[]) => Tab[])) => setTabsIn(group.id, update)
    const close = (tab: Tab) => closeInGroup(group.id, tab)
    const openPath = (path: string, line?: number, column?: number, highlight?: string) => openInGroup(group.id, path, line, column, highlight)
    const markdown = paneMarkdown
    const diffMarkdown = paneDiffMarkdown
    const showTextDiff = activeTab?.diff !== undefined && !(diffMarkdown && activeTab.preview)
    const diffControls = activeTab?.diff&&<>{diffMarkdown&&<div className="dvw-diff-preview-switch"><button className="dvw-mode-button" data-diff-view="diff" data-active={!activeTab.preview} onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:false}:tab))}><Icon name="diff"/> 差异</button><button className="dvw-mode-button" data-diff-view="preview" data-active={activeTab.preview} onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:true}:tab))}><Icon name="preview"/> 预览</button></div>}{!activeTab.preview&&<><button className="dvw-mode-button dvw-diff-mode-button" data-mode="inline" data-active={diffMode==='inline'} title="内联视图" aria-label="内联视图" aria-pressed={diffMode==='inline'} onClick={()=>selectDiffMode('inline')}><Icon name="diff-single"/> 内联</button><button className="dvw-mode-button dvw-diff-mode-button" data-mode="split" data-active={diffMode==='split'} title="并排视图" aria-label="并排视图" aria-pressed={diffMode==='split'} onClick={()=>selectDiffMode('split')}><Icon name="diff-sidebyside"/> 并排</button></>}</>
    const diffVersions = activeTab?.path.startsWith('diff:staged:') ? ['HEAD', '暂存区'] as const
      : activeTab?.path.startsWith('diff:commit:') ? ['原版本', '对比版本'] as const
      : ['暂存区', '工作区'] as const

    const headings = markdownPreview && activeTab ? markdownHeadings(activeTab.diff?.modified ?? activeTab.draft) : []
    const paneReviewChanges=reviewEnabled&&activeTab!==undefined?(reviewByPath.get(activeTab.path)??[]):[]
    const activeReviewChanges=paneReviewChanges
    const hasActiveReview=activeReviewChanges.length>0
    const inlineReviewChanges=activeReviewChanges.filter(change=>!change.created||activeReviewChanges.length===1)
    const rejectReview=(ids:string[])=>{if(activeTab!==undefined)void rejectReviewIn(group.id,activeTab,ids)}
    const selectHeading = (index: number) => { if (activeTab === undefined) return; setTabs(rows => rows.map(tab => tab.path === activeTab.path ? { ...tab, preview: true } : tab)); window.setTimeout(() => window.dispatchEvent(new CustomEvent('dvw-markdown-heading', { detail: index })), 50) }
    return <><div className="dvw-tabs" data-empty={(tabs.length===0&&dshPanelId===undefined&&browserTabs.length===0)||undefined}><div className="dvw-tab-list" ref={focused?tabListRef:undefined}>{focused&&browserTabs.map(tab=><button className="dvw-tab" key={tab.id} data-dvw-browser-tab={tab.id} data-active={browserId===tab.id&&!dshTabActive} title={tab.title} onClick={()=>{leaveDshPanel();setBrowserId(tab.id)}}><Icon name="globe"/><span className="dvw-tab-name">{tab.title}</span><span className="dvw-tab-close" onClick={event=>{event.stopPropagation();browser?.close(tab.sessionId,tab.id)}}><Icon name="close"/></span></button>)}{focused&&dshPanelId!==undefined&&<button className="dvw-tab" data-active={dshTabActive} data-dvw-dsh-tab="" title={`${dshPanelLabel(dshPanelId)}（DSH 官方页面）`} onClick={()=>setDshTabActive(true)}><span className="dvw-dsh-tab-mark"/><span className="dvw-tab-name">{dshPanelLabel(dshPanelId)}</span><span className="dvw-tab-close" onClick={event=>{event.stopPropagation();closeDshPanel()}}><Icon name="close"/></span></button>}{tabs.map(tab=>{const count=reviewEnabled?(reviewByPath.get(tab.path)?.length??0):0;const conflict=reviewEnabled&&(reviewByPath.get(tab.path)??[]).some(change=>reviewSnapshot.conflicts[change.id]!==undefined);return <button className="dvw-tab" data-active={tab.path===active&&!dshTabActive&&browserId===undefined} data-review-conflict={conflict||undefined} key={tab.path} data-tab-path={tab.path} draggable onDragStart={event=>startTabDrag(event,group.id,tab)} onDragEnd={endTabDrag} title={conflict?`${tab.diffSourcePath??tab.path} · AI 改动与当前文件状态冲突`:tab.diffSourcePath??tab.path} onClick={()=>{setBrowserId(undefined);setDshTabActive(false);setActive(tab.path)}} onAuxClick={event=>{if(event.button===1){event.preventDefault();close(tab)}}} onMouseDown={event=>{if(event.button===1)event.preventDefault()}} onContextMenu={event=>{event.preventDefault();setBrowserId(undefined);setDshTabActive(false);setActive(tab.path);setTabMenu({x:event.clientX,y:event.clientY,path:tab.path})}}><FileIcon name={tabLabel(tab)} className="dvw-tab-icon"/><span className="dvw-tab-name">{tab.dirty?'● ':''}{tabLabel(tab)}</span>{count>0&&<span className="dvw-tab-review" data-conflict={conflict||undefined} title={`${count} 处 AI 改动待审阅`}>{count}</span>}<span className="dvw-tab-close" onClick={event=>{event.stopPropagation();close(tab)}}><Icon name="close"/></span></button>})}</div></div><div className="dvw-editor" data-dvw-focused-editor={focused||undefined} data-review={hasActiveReview||undefined} data-outline={markdownPreview&&outlineVisible&&headings.length>0} data-browser-active={focused&&browserId!==undefined||undefined} onKeyDownCapture={event=>{if(!hasActiveReview||activeTab===undefined||!(event.target instanceof Element)||event.target.closest('.monaco-editor')===null)return;const command=event.ctrlKey||event.metaKey;if(command&&!event.altKey&&!event.shiftKey&&event.key==='Enter'){event.preventDefault();event.stopPropagation();keepReview(activeReviewChanges.map(change=>change.id));return}if(command&&!event.altKey&&!event.shiftKey&&event.key==='Backspace'){event.preventDefault();event.stopPropagation();rejectReview(activeReviewChanges.map(change=>change.id));return}const singleModifier=navigator.userAgent.includes('Mac')?event.ctrlKey&&!event.metaKey&&!event.altKey:event.altKey&&!command;if(singleModifier&&!event.shiftKey&&(event.code==='KeyY'||event.code==='KeyN')){const change=inlineReviewChanges.find(item=>item.id===reviewActiveId)??inlineReviewChanges[0];if(change===undefined)return;event.preventDefault();event.stopPropagation();if(event.code==='KeyY')keepReview([change.id]);else rejectReview([change.id])}}}>{error&&<div className="dvw-error"><button className="dvw-icon" onClick={()=>setError(undefined)}><Icon name="close"/></button>{error}</div>}{sessionId===undefined&&<div className="dvw-error">未取得当前会话（sessionId 为空）：文件与目录都无法加载。请切换到任意会话后重试，仍不行请重启 DSH。</div>}{hasActiveReview&&activeTab&&<div className="dvw-review-filebar"><strong>AI 改动 · {activeReviewChanges.length} 处</strong><span>{activeTab.path}</span><button type="button" data-action="accept" disabled={reviewSnapshot.busy||reviewSnapshot.working} title="接受本文件全部 AI 改动 (Ctrl+Enter)" onClick={()=>keepReview(activeReviewChanges.map(change=>change.id))}>接受</button><button type="button" data-action="reject" disabled={reviewSnapshot.busy||reviewSnapshot.working||activeTab.dirty} title="拒绝本文件全部 AI 改动 (Ctrl+Backspace)" onClick={()=>rejectReview(activeReviewChanges.map(change=>change.id))}>拒绝</button></div>}{markdownPreview&&outlineVisible&&headings.length>0&&<MarkdownOutline headings={headings} onClose={()=>setOutlineVisible(false)} onHeading={selectHeading}/>} {markdown&&activeTab&&<div className="dvw-editor-toolbar" style={{top:hasActiveReview?35:0}}><button className="dvw-icon dvw-outline-toggle" data-active={outlineVisible} title={outlineVisible?'关闭 Markdown 大纲':'显示 Markdown 大纲'} onClick={()=>setOutlineVisible(value=>!value)}><Icon name="list-tree"/></button><button className="dvw-mode-button" data-active={!activeTab.preview} onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:false}:tab))}><Icon name="code"/> 源码</button><button className="dvw-mode-button" data-active={activeTab.preview} onClick={()=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,preview:true}:tab))}><Icon name="preview"/> 预览</button></div>}{activeTab?.diff&&!showTextDiff&&<div className="dvw-editor-toolbar dvw-diff-toolbar" style={{top:hasActiveReview?35:0}}>{diffControls}</div>}<div className="dvw-editor-body" data-toolbar={markdown||activeTab?.diff!==undefined} style={{top:(markdown&&!activeTab?.preview?35:0)+(activeTab?.diff&&!showTextDiff?35:0)+(hasActiveReview?35:0)}}>{activeTab===undefined?<div className="dvw-empty"><div><strong>DSH Workbench</strong><br/>从资源管理器或搜索结果打开文件<div className="dvw-start-tools"><button onClick={()=>{if(snapshot.bottomPanel!=='terminal')service.toggleBottomPanel('terminal');queueMicrotask(()=>service.runCommand('terminal.new'))}} disabled={!terminalAvailable}><Icon name="terminal"/>新建终端</button>{browser!==undefined&&<button onClick={()=>void newBrowser()} disabled={!browserSnapshot.available}><Icon name="globe"/>浏览器</button>}</div></div></div>:activeTab.diff?diffMarkdown&&activeTab.preview?<MarkdownPreview source={activeTab.diff.modified} sessionId={sessionId} path={activeTab.diffSourcePath??''}/>:<MonacoDiffEditor uri={`${workspace?.cwd??''}/${activeTab.path}`} original={activeTab.diff.original} modified={activeTab.diff.modified} mode={diffMode} style={gitDiffStyle} viewControls={diffControls} versions={diffVersions} sourcePath={activeTab.diffSourcePath} blame={activeTab.diff.blame} blameSessionId={gitLineBlame?sessionId:undefined} theme={colorScheme} fontSize={fontSize}/>:activeTab.imageUrl?<div className="dvw-image-preview" key={activeTab.path}><img src={activeTab.imageUrl} alt={activeTab.diffSourcePath??activeTab.path}/><span>{activeTab.diffSourcePath??activeTab.path}</span></div>:activeTab.documentPreview&&activeTab.documentUrl?<DocumentPreview key={activeTab.path} kind={activeTab.documentPreview} src={activeTab.documentUrl} path={activeTab.path}/>:markdown&&activeTab.preview?<MarkdownPreview source={activeTab.draft} sessionId={sessionId} path={activeTab.path}/>:activeTab.binary||activeTab.tooLarge?<div className="dvw-message">{activeTab.binary?'二进制文件无法在文本编辑器或差异视图中打开':`文件超过 5 MiB：${activeTab.path}`}{activeTab.binary&&activeTab.diffSourcePath!==undefined&&!activeTab.path.startsWith('diff:commit:')&&<button onClick={()=>void openPath(activeTab.diffSourcePath!)}>打开文件</button>}</div>:activeTab.loaded===false?<div className="dvw-message">{sessionId===undefined?'未取得会话，无法读取文件；请切换会话后重试。':'正在加载文件…'}</div>:<MonacoEditor uri={`${workspace?.cwd??''}/${activeTab.path}`} breakpoints={(debugState.breakpoints[activeTab.path]??[]).map(row=>row.line)} pausedLine={debugState.frames.find(frame=>{if(frame.path===undefined)return false;const norm=(v:string)=>v.replace(/\\/g,'/');return norm(frame.path).endsWith(norm(activeTab.path))})?.line} onToggleBreakpoint={line=>{if(sessionId!==undefined)debugController.toggleBreakpoint(sessionId,activeTab.path,line)}} onAddToDsh={selection=>addToDsh(dshReference(activeTab.path,{selection}))} value={activeTab.draft} theme={colorScheme} fontSize={fontSize} line={activeTab.line} column={activeTab.column} highlight={activeTab.highlight} focusOnReveal={activeTab.focusOnReveal} blame={gitLineBlame&&sessionId?{sessionId,path:activeTab.path,revision:activeTab.revision,dirty:activeTab.dirty}:undefined} review={reviewEnabled&&inlineReviewChanges.length>0?{changes:inlineReviewChanges.map(change=>({...change,...(reviewSnapshot.conflicts[change.id]===undefined?{}:{conflict:reviewSnapshot.conflicts[change.id]})})),activeId:reviewActiveId,rejectDisabled:reviewSnapshot.busy||reviewSnapshot.working||activeTab.dirty,onFocus:setReviewActiveId,onKeep:changeId=>keepReview([changeId]),onReject:changeId=>rejectReview([changeId])}:undefined} onChange={draft=>setTabs(rows=>rows.map(tab=>tab.path===activeTab.path?{...tab,draft,dirty:draft!==tab.content}:tab))} onSave={()=>void save(activeTab)}/>}</div></div></>
  }

  // ---- editor groups -------------------------------------------------------
  const paneDragOver = (event: DragEvent) => {
    if (draggedTab === undefined && draggedEntry === undefined) return
    // The drop target is usually an open editor, and Monaco handles drag-and-drop itself: claim the
    // gesture here so its dragover/drop never sees it, and the pane logic below still runs.
    event.stopPropagation()
    // A drop is only delivered when dragover cancelled the default; do it before any early return,
    // or a valid-looking preview ends with a browser-refused drop.
    event.preventDefault()
    if (draggedTab !== undefined) {
      const pane = (event.target as HTMLElement | null)?.closest<HTMLElement>('.dvw-pane')
      if (pane === null || pane === undefined) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'
      const group = pane.dataset.group ?? ''
      const rect = pane.getBoundingClientRect()
      const hit = dropPosition(rect, event.clientX - rect.left, event.clientY - rect.top)
      if (hit !== undefined) {
        if (paneCount(layout) >= MAX_PANES) { event.dataTransfer.dropEffect = 'none'; setPaneDrop(undefined); setTabDrop(undefined); return }
        setTabDrop(undefined)
        if (paneDrop?.group !== group || paneDrop.direction !== hit.direction || paneDrop.position !== hit.position) setPaneDrop({ group, ...hit })
        return
      }
      // Inside the body: insert into this group at the position the pointer implies.
      setPaneDrop(undefined)
      const marks = [...pane.querySelectorAll<HTMLElement>('[data-tab-path]')]
      const index = marks.filter(mark => { const box = mark.getBoundingClientRect(); return event.clientX > box.left + box.width / 2 }).length
      if (tabDrop?.group !== group || tabDrop.index !== index) setTabDrop({ group, index })
      return
    }
    if (draggedEntry === undefined) return
    // A folder carries no editor content of its own: show the not-allowed cursor instead of ignoring the drag.
    if (draggedEntry.kind !== "file") { if (event.target instanceof HTMLElement && event.target.closest(".dvw-pane") !== null) event.dataTransfer.dropEffect = "none"; return }
    const pane = (event.target as HTMLElement | null)?.closest<HTMLElement>('.dvw-pane')
    if (pane === null || pane === undefined) return
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'
    const rect = pane.getBoundingClientRect()
    const hit = dropPosition(rect, event.clientX - rect.left, event.clientY - rect.top)
    // At the cap only a split is refused; opening in the pane itself stays available.
    if (hit !== undefined && paneCount(layout) >= MAX_PANES) {
      event.dataTransfer.dropEffect = 'none'
      if (paneDrop !== undefined) setPaneDrop(undefined)
      return
    }
    const group = pane.dataset.group ?? ''
    if (hit === undefined) { if (paneDrop !== undefined) setPaneDrop(undefined); return }
    if (paneDrop?.group !== group || paneDrop.direction !== hit.direction || paneDrop.position !== hit.position) setPaneDrop({ group, ...hit })
  }
  const paneDragLeave = (event: DragEvent) => {
    const host = (event.currentTarget as HTMLElement | null)
    const next = event.relatedTarget as Node | null
    if (host !== null && next !== null && host.contains(next)) return
    if (next === null) return
    setPaneDrop(undefined); setTabDrop(undefined)
  }
  const splitGroup = (groupId: string, direction: SplitDirection, position: SplitPosition, path: string) => {
    setPaneDrop(undefined)
    if (paneCount(layout) >= MAX_PANES) return
    const added = `pane-${Date.now().toString(36)}`
    setGroups(current => [...current, { id: added, tabs: [] }])
    setLayout(current => splitAt(current, groupId, direction, added, position, `split-${added}`))
    openInGroup(added, path)
  }
  const moveTabInto = (from: string, path: string, to: string, index: number | undefined, split?: { direction: SplitDirection; position: SplitPosition }) => {
    const source = groups.find(row => row.id === from)
    const tab = source?.tabs.find(row => row.path === path)
    if (source === undefined || tab === undefined) return
    if (split === undefined) {
      const moved = moveTabToGroup(groups, from, path, to, index)
      if (moved === undefined) {
        // Nothing to reorder, or the file is already open there: hand the user that pane instead.
        if (to !== from) { focusGroup(to); setActiveIn(to, path) }
        return
      }
      const emptied = moved.some(row => row.id === from && row.tabs.length === 0)
      const next = emptied && moved.length > 1 ? moved.filter(row => row.id !== from) : moved
      if (emptied && moved.length > 1) setLayout(current => removeGroup(current, from) ?? createLeaf(next[0]!.id))
      setGroups(next)
      focusGroup(to)
      return
    }
    if (paneCount(layout) >= MAX_PANES) return
    const targetId = `pane-${Date.now().toString(36)}`
    const rest = source.tabs.filter(row => row.path !== path)
    const collapses = rest.length === 0
    let next: EditorGroup[] = groups.map(row => row.id !== from ? row : { ...row, tabs: rest, active: row.active === path ? rest.at(-1)?.path : row.active })
    next = [...next, { id: targetId, tabs: [tab], active: path }]
    if (collapses) next = next.filter(row => row.id !== from)
    setLayout(current => {
      const tree = splitAt(current, from, split.direction, targetId, split.position, `split-${targetId}`)
      return collapses ? (removeGroup(tree, from) ?? createLeaf(targetId)) : tree
    })
    setGroups(next)
    focusGroup(targetId)
  }
  // Two panes, two files: dropping one on the other trades places, which is what comparing them
  // looks like. A target with no file, or one already showing this file, falls through to a move.
  const swapTabs = (from: string, path: string, to: string) => {
    const next = swapActiveTab(groups, from, path, to)
    if (next === undefined) { moveTabInto(from, path, to, undefined); return }
    setGroups(next)
    focusGroup(to)
  }

  // Where the pointer is now, not where the preview last rendered. A quick release can arrive
  // before the final dragover commits, and reading that state dropped the file one zone away.
  const dropTargetAt = (event: DragEvent) => {
    const pane = (event.target as HTMLElement | null)?.closest<HTMLElement>('.dvw-pane') ?? null
    const rect = pane?.getBoundingClientRect()
    const hit = rect === undefined ? undefined : dropPosition(rect, event.clientX - rect.left, event.clientY - rect.top)
    let index: number | undefined
    if (hit === undefined && pane !== null) {
      const marks = [...pane.querySelectorAll<HTMLElement>('[data-tab-path]')]
      index = marks.filter(mark => { const box = mark.getBoundingClientRect(); return event.clientX > box.left + box.width / 2 }).length
    }
    return { pane, hit, index }
  }

  const paneDropHandler = (event: DragEvent) => {
    if (draggedTab === undefined && draggedEntry === undefined) return
    event.stopPropagation()
    event.preventDefault()
    if (draggedTab !== undefined) {
      const tab = draggedTab
      endTabDrag()
      const { pane, hit, index } = dropTargetAt(event)
      const groupId = pane?.dataset.group ?? tab.group
      setPaneDrop(undefined); setTabDrop(undefined)
      if (hit !== undefined) moveTabInto(tab.group, tab.path, groupId, undefined, { direction: hit.direction, position: hit.position })
      else if (groupId !== tab.group) swapTabs(tab.group, tab.path, groupId)
      else moveTabInto(tab.group, tab.path, groupId, index)
      return
    }
    const entry = draggedEntry
    if (entry?.kind !== 'file') return
    endEntryDrag()
    const { pane, hit } = dropTargetAt(event)
    const groupId = pane?.dataset.group ?? focusedRef.current
    setPaneDrop(undefined); setTabDrop(undefined)
    if (hit !== undefined) splitGroup(groupId, hit.direction, hit.position, entry.path)
    else openInGroup(groupId, entry.path)
  }

  const closeInGroup = (groupId: string, tab: Tab) => {
    const group = groups.find(row => row.id === groupId)
    if (group === undefined) return
    if (tab.dirty && !confirm(`${tab.path} 有未保存更改，确定关闭？`)) return
    loadingTabs.current.delete(tabLoadKey(groupId,tab.path))
    const rest = group.tabs.filter(row => row.path !== tab.path)
    if (rest.length === 0 && groups.length > 1) {
      const remaining = groups.filter(row => row.id !== groupId)
      setGroups(remaining)
      setLayout(current => removeGroup(current, groupId) ?? createLeaf(remaining[0]!.id))
      if (focusedRef.current === groupId) focusGroup(remaining[0]!.id)
      return
    }
    setGroups(current => current.map(row => row.id !== groupId ? row : { ...row, tabs: rest, active: row.active === tab.path ? rest.at(-1)?.path : row.active }))
  }
  const dragSplitter = (event: ReactPointerEvent<HTMLElement>, id: string, direction: SplitDirection) => {
    if (event.button !== 0) return
    event.preventDefault()
    const parent = (event.currentTarget as HTMLElement).parentElement
    if (parent === null) return
    const rect = parent.getBoundingClientRect()
    const move = (moveEvent: PointerEvent) => {
      const ratio = direction === 'row'
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height
      setLayout(current => setRatio(current, id, ratio))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const renderNode = (node: PaneNode): ReactNode => {
    if (node.kind === 'leaf') return groups.some(group => group.id === node.group) ? renderPane(node.group) : null
    const splitter = <div className="dvw-splitter" data-direction={node.direction} onPointerDown={event => dragSplitter(event, node.id, node.direction)}/>
    return (
      <div className="dvw-split" data-direction={node.direction} key={node.id}>
        <div className="dvw-slot" style={{ flexGrow: node.ratio }}>{renderNode(node.first)}</div>
        {splitter}
        <div className="dvw-slot" style={{ flexGrow: 1 - node.ratio }}>{renderNode(node.second)}</div>
      </div>
    )
  }
  const renderPane = (groupId: string) => {
    const group = groups.find(row => row.id === groupId) ?? { id: groupId, tabs: [] }
    const paneTab = group.tabs.find(row => row.path === group.active)
    const focused = groupId === focusedId
    const drop = paneDrop !== undefined && paneDrop.group === groupId ? paneDrop : undefined
    const paneMarkdown = paneTab !== undefined && !paneTab.path.startsWith('diff:') && /\.md$/i.test(paneTab.path)
    const paneDiffMarkdown = paneTab?.diff !== undefined && /\.md$/i.test(paneTab.diffSourcePath ?? '')
    const panePreview = paneMarkdown || (paneDiffMarkdown && paneTab?.preview === true)
    return (
      <section className="dvw-pane" key={groupId} data-group={groupId} data-focused={focused || undefined} data-drop={drop === undefined ? undefined : `${drop.direction}-${drop.position}`} data-tab-target={tabDrop?.group === groupId || undefined} onClickCapture={() => { if (focusedRef.current !== groupId) focusGroup(groupId) }}>
        {drop !== undefined && <div className="dvw-pane-drop" data-direction={drop.direction} data-position={drop.position}/>}
        {renderPaneChrome(group, group.tabs, group.active, paneTab, focused, paneMarkdown, paneDiffMarkdown, panePreview)}
      </section>
    )
  }
  return <div ref={overlayRef} className="dvw-overlay" data-dvw-theme={colorScheme} data-dvw-theme-name={theme} data-dvw-chat={chatShown||undefined} data-dvw-primary-side={primarySideVisible||undefined} data-dvw-status={statusVisible||undefined} data-dvw-bottom-panel={snapshot.bottomPanel||undefined} data-dvw-float={floating||undefined} data-dvw-float-max={floating&&floatMax||undefined} data-dvw-float-fullscreen={floating&&floatFullscreen||undefined} style={{...(floatStyle??{}),'--dvw-side-width':`${sideWidth}px`,'--dvw-chat-width':`${chatWidth}px`} as CSSProperties} role="dialog" aria-label="VS Code 工作台" onDragEnterCapture={suppressAttachmentDrop} onDragOverCapture={suppressAttachmentDrop} onDropCapture={suppressAttachmentDrop}>
    {floating&&<>
      {!floatMax&&!floatFullscreen&&FLOAT_HANDLES.map(mode=><div key={mode} className="dvw-float-handle" data-handle={mode} onPointerDown={event=>beginFloatGesture(event,mode)}/>)}
      <FloatBar name={workspace?.name} fullscreen={floatFullscreen} onPointerDown={event=>beginFloatGesture(event,'move')} onToggleFullscreen={()=>void toggleFloatFullscreen()} onClose={()=>service.hide()}/>
    </>}
    <WorkbenchTitlebar name={workspace?.name}/>
    {dshTabId!==undefined&&<DshPanelPage panelId={dshTabId} active={showingDshPanel}/>}
    <DshConversationPanel visible={chatShown} width={chatWidth} statusHeight={statusVisible?30:6}/>
    <DshConversationTheme visible={chatShown} colorScheme={colorScheme} followDsh={false}/>
    <DshReviewActions visible={chatShown&&reviewEnabled} files={reviewFiles} count={reviewSnapshot.changes.length} disabled={reviewSnapshot.busy||reviewSnapshot.working} onOpen={path=>void openPath(path)} onAcceptAll={keepAllReview} onRejectAll={()=>void rejectAllReview()}/>
    {chatShown&&<aside className="dvw-chat"><PanelResizer className="dvw-chat-resizer" label="拖动调整 DSH 对话栏宽度" size={chatWidth} min={DSH_CHAT_MIN_WIDTH} max={DSH_CHAT_MAX_WIDTH} defaultSize={DSH_CHAT_DEFAULT_WIDTH} direction={-1} hideBelow={200} onHide={()=>setChatVisible(false)} onResize={setChatWidth}/><header className="dvw-chat-head"><span><DshMark/> DSH</span><button className="dvw-icon" title="关闭 DSH 对话栏" onClick={()=>setChatVisible(false)}><Icon name="close"/></button></header><div className="dvw-chat-body"/></aside>}
    {switcherOpen&&<WorkspaceSwitcher choices={switcherChoices} activeSessionId={sessionId} unavailable={navigation?.available===false} busy={switcherBusy} error={switcherError} theme={colorScheme} onCreate={()=>void createWorkspace()} onNewSession={newSession} onSwitch={switchSession} onOpenWorkspace={enterWorkspace} onClose={()=>setSwitcherOpen(false)}/>}
    {settingsNode!==undefined&&createPortal(settingsPage,settingsNode)}
    {unsupportedTab!==undefined&&sessionId!==undefined&&<CenteredOpenWith key={unsupportedTab.path} sessionId={sessionId} path={unsupportedTab.path} label={unsupportedTab.label}/>}
    <ActivityBar
        views={[
          {id:'explorer',label:'资源管理器',icon:<Icon name="files"/>,active:primarySideVisible&&snapshot.view==='explorer',onActivate:()=>selectView('explorer')},
          {id:'search',label:'搜索',icon:<Icon name="search"/>,active:primarySideVisible&&snapshot.view==='search',onActivate:()=>selectView('search')},
          {id:'git',label:'源代码管理',icon:<Icon name="source-control"/>,active:primarySideVisible&&snapshot.view==='git',onActivate:()=>selectView('git')},
          {id:'debug',label:snapshot.bottomPanel==='debug'?'隐藏调试面板（F5 启动调试）':'调试：断点 / 调用栈 / 变量（F5 启动）',icon:<Icon name="debug-alt"/>,active:snapshot.bottomPanel==='debug',onActivate:()=>service.toggleBottomPanel('debug')},
          {id:'terminal',label:terminalAvailable?(snapshot.bottomPanel==='terminal'?'隐藏终端':'显示终端'):'终端适配器未安装',icon:<Icon name="terminal"/>,active:snapshot.bottomPanel==='terminal',disabled:!terminalAvailable,onActivate:()=>toggleTerminal(service)},
          ...(floating?[]:[{id:'chat',label:showingDshPanel?'返回 DSH 对话 (Ctrl+Alt+B)':chatVisible?'关闭 DSH 对话栏 (Ctrl+Alt+B)':'显示 DSH 对话栏 (Ctrl+Alt+B)',icon:<DshMark size={22}/>,active:chatShown,onActivate:()=>{if(showingDshPanel)showConversation();else setChatVisible(value=>!value)}}]),
        ]}
        fixed={[{id:'workspaces',label:'打开工作区 / 切换会话',icon:<Icon name="folder-opened"/>,active:false,onActivate:openSwitcher}]}
        bottom={[
          {id:'home',label:'返回 DSH',icon:<Icon name="home"/>,active:false,onActivate:()=>service.hide()},
          {id:'settings',label:'打开 DSH 设置',icon:<Icon name="settings"/>,active:settingsOpen,onActivate:()=>openSettings?.()},
        ]}
        order={activityOrder} hidden={activityHidden}
        onOrderChange={setActivityOrder} onHiddenChange={setActivityHidden}/>
    <aside className="dvw-side" data-side-width={sideWidth}>{snapshot.view==='explorer'&&workspace!==undefined&&<ExplorerView sessionId={sessionId} cwd={workspace.cwd} selected={active} onOpen={openFromView} onAddToDsh={addEntryToDsh}/>} {workspace && <SearchView key={JSON.stringify([sessionId, workspace.cwd])} sessionId={sessionId} cwd={workspace.cwd} visible={snapshot.view==='search' && primarySideVisible} focus={searchFocus} isDirty={hasUnsavedSearchFile} onChanged={refreshChangedTabs} onOpen={openFromView}/>} {(snapshot.view==='git'||(workspace&&statusVisible))&&<GitView visible={snapshot.view==='git'} statusSlot={statusVisible?gitStatusSlot:null} sessionId={sessionId} preferences={commitPreferences} model={commitModel} key={sessionId} onOpenFile={openFromView} modelConfigured={commitModelConfigured} modelAvailable={commitModelAvailable} modelHint={commitModelHint} onDiff={(path,diff,title,source,preview)=>{leaveDshPanel();openDiff(path,diff,title,source,preview)}}/>}</aside>
    <PanelResizer className="dvw-side-resizer" label="拖动调整源码管理侧边栏宽度" size={sideWidth} min={210} max={640} defaultSize={210} direction={1} hideBelow={105} onHide={()=>setPrimarySideVisible(false)} onResize={setSideWidth}/>
    <main className="dvw-main" onDragOverCapture={paneDragOver} onDragLeaveCapture={paneDragLeave} onDropCapture={paneDropHandler}><div className="dvw-panes">{renderNode(layout)}</div>{snapshot.bottomPanel===undefined&&<div className="dvw-bottom-reveal" title="向上拖动打开终端" onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();service.toggleBottomPanel('terminal');const statusHeight=statusVisible?24:0;const heightAt=(clientY:number)=>Math.max(120,Math.min(window.innerHeight-160,window.innerHeight-clientY-statusHeight));const move=(e:PointerEvent)=>setPanelHeight(heightAt(e.clientY));const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)}}/>}</main>
    {tabMenu&&menuTab&&<div className="dvw-context-menu dvw-tab-menu" role="menu" style={{left:Math.min(tabMenu.x,window.innerWidth-240),top:Math.min(tabMenu.y,window.innerHeight-180)}} onPointerDown={event=>event.stopPropagation()}>
      <button role="menuitem" onClick={()=>{setTabMenu(undefined);close(menuTab)}}>关闭<span>Ctrl+F4</span></button>
      <button role="menuitem" disabled={tabs.length<=1} onClick={()=>removeTabs(tabs.filter(row=>row.path!==menuTab.path),'关闭其他标签页')}>关闭其他</button>
      <button role="menuitem" disabled={menuIndex<0||menuIndex>=tabs.length-1} onClick={()=>removeTabs(tabs.slice(menuIndex+1),'关闭右侧标签页')}>关闭右侧标签页</button>
      <button role="menuitem" disabled={savedTabs.length===0} onClick={()=>removeTabs(savedTabs,'关闭已保存标签页')}>关闭已保存<span>Ctrl+K U</span></button>
      <button role="menuitem" onClick={closeAll}>全部关闭<span>Ctrl+K W</span></button>
    </div>}
    {sessionId!==undefined&&browserTabs.map(tab=><DshBrowserPage key={tab.id} sessionId={sessionId} tabId={tab.id} colorScheme={colorScheme} active={browserId===tab.id&&!dshTabActive&&!switcherOpen&&snapshot.visible}/>)}
    {snapshot.bottomPanel&&<section className="dvw-bottom" style={{height:panelHeight}}><div className="dvw-bottom-resizer" onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();const startY=event.clientY,startHeight=panelHeight;const move=(e:PointerEvent)=>setPanelHeight(Math.max(120,Math.min(window.innerHeight-160,startHeight+startY-e.clientY)));const up=(e:PointerEvent)=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);if(startHeight+startY-e.clientY<80)service.toggleBottomPanel(snapshot.bottomPanel!)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)}}/><div className="dvw-bottom-head"><button className="dvw-bottom-title">{panels.find(p=>p.id===snapshot.bottomPanel)?.title??snapshot.bottomPanel}</button>{snapshot.bottomPanel==='terminal'&&<button className="dvw-icon" title="新建终端" onClick={()=>window.dispatchEvent(new Event('dvw-terminal-new'))}><Icon name="add"/></button>}<button className="dvw-icon" style={{marginLeft:'auto'}} onClick={()=>service.toggleBottomPanel(snapshot.bottomPanel!)}><Icon name="close"/></button></div><div className="dvw-bottom-body">{Panel&&workspace&&<Panel sessionId={sessionId} cwd={workspace.cwd} visible colorScheme={colorScheme}/>}</div></section>}
    <footer className="dvw-status"><div ref={setGitStatusSlot}/><span>{workspace?.cwd??cwd??''}</span>{activeTab?.external&&<span>磁盘文件已变化</span>}<button className="dvw-status-action" title={activeTab===undefined?'先在编辑器里打开一个文件':'调试当前文件（F5）'} disabled={activeTab===undefined} onClick={()=>{ if(sessionId!==undefined&&activeTab!==undefined) debugController.start(sessionId,activeTab.path,'',debugController.getSnapshot().adapterId) }}>▶ 调试</button><button className="dvw-status-action" title={activeTab===undefined?'先在编辑器里打开一个文件':'直接运行当前文件（不调试）'} disabled={activeTab===undefined} onClick={()=>{ if(sessionId!==undefined&&activeTab!==undefined) debugController.run(sessionId,activeTab.path,'') }}>▷ 运行</button><button className="dvw-icon" style={{color:'inherit',marginLeft:'auto'}} onClick={()=>service.hide()}>返回 DSH</button></footer>
  </div>
}
