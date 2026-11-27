import type { languages } from 'monaco-editor'
import type { WorkbenchColorScheme } from '../workbench/service.ts'
import { editorLanguageForPath } from '../lsp/lspLanguage.ts'
import { colorInlineGitDiff, connectGitSplit, type GitDiffLineRange } from '../git/GitSplitDiff.ts'
import type { GitDiff } from '../../shared/types.ts'
import { clickedCodeLine, clickedDeletedLine, createGitLineBlame, lastBlameLine } from '../git/GitLineBlame.ts'
import { Icon } from '../ui/Icon.tsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { locateReviewChange, type ReviewChange } from './aiReview.ts'
import { searchHighlightRange } from '../search/searchHighlight.ts'
import type { EditorSelection } from '../dsh/dshComposer.ts'
import { isIndexedModel, projectModelPath } from './typescriptProject.ts'
import { isLspPreviewModel } from '../lsp/lspWorkspace.ts'
import { completeMonacoChineseMessages, localizeMonacoActions } from './monacoLocale.ts'
import { registerInlineCompletion, type InlineCompletionSettings } from './inlineCompletion.ts'
import { MONACO_ASSET_BASE } from '../../shared/monacoAssets.ts'

type Monaco = typeof import('monaco-editor')
declare global { interface Window { require?: { <T>(ids: string[], done: (module: T) => void, error?: (cause: unknown) => void): void; config(value: unknown): void }; monaco?: Monaco } }
let loading: Promise<Monaco> | undefined
/** Monaco chrome used by both editors so only the narrow native scrollbar remains. */
export const WORKBENCH_EDITOR_CHROME = {
  // VS Code navigation: Ctrl+hover underlines definitions, multiple results open Peek, a single one jumps.
  definitionLinkOpensInPeek: false,
  gotoLocation: { multipleDefinitions: 'gotoAndPeek', multipleReferences: 'peek', multipleImplementations: 'peek', multipleTypeDefinitions: 'gotoAndPeek', multipleDeclarations: 'peek', alternativeDefinitionCommand: 'editor.action.goToReferences' },
  parameterHints: { enabled: true, cycle: true },
  quickSuggestions: { other: true, comments: false, strings: false },
  suggestOnTriggerCharacters: true,
  minimap: { enabled: false },
  renderOverviewRuler: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  renderLineHighlightOnlyWhenFocus: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
} as const

/**
 * Monaco minimap chrome. `size: 'proportional'` keeps the thumbnail a fraction of the available
 * width and `maxColumn` caps how many columns are rendered, so the map never outgrows the text
 * column. `WORKBENCH_EDITOR_CHROME` keeps the minimap off, which leaves the diff editors narrow;
 * the code editor opts in through `minimapOptions`.
 */
export const WORKBENCH_MINIMAP_OPTIONS = {
  side: 'right',
  size: 'proportional',
  showSlider: 'mouseover',
  renderCharacters: true,
  maxColumn: 120,
  scale: 1,
} as const

/** The minimap switch defaults to on, like VS Code; both the create and the update path share it. */
export function minimapEnabled(props: { minimap?: boolean }): boolean {
  return props.minimap ?? true
}

/** Resolve the minimap options for an explicit on/off choice without mutating the constant. */
export function minimapOptions(enabled: boolean): import('monaco-editor').editor.IEditorOptions['minimap'] {
  return { ...WORKBENCH_MINIMAP_OPTIONS, enabled }
}

/** macOS reports Control-click as a secondary click, so Monaco only navigates with Cmd-click there. */
export function isMacPlatform(userAgent: string = navigator.userAgent): boolean {
  return /Macintosh|Mac OS X/.test(userAgent)
}

/**
 * Whether a mouse press should jump to the definition. On macOS, Control-click is a common
 * Windows/Linux habit but arrives as a context-menu gesture (sometimes as a right-button
 * press); treat it as Cmd-click instead.
 */
export function isMacDefinitionClick(event: { button: number; ctrlKey: boolean; metaKey: boolean }): boolean {
  return (event.button === 0 || event.button === 2) && event.ctrlKey && !event.metaKey
}

/** Monaco theme aligned with the workbench dark palette. */
export const DARK_THEME = 'dvw-dark'
const DARK_RULES = [
  { token: '', foreground: 'bfbfbf' },
  { token: 'comment', foreground: '6a9955' },
  { token: 'string', foreground: 'ce9178' },
  { token: 'keyword', foreground: '569cd6' },
  { token: 'number', foreground: 'b5cea8' },
  { token: 'regexp', foreground: 'd16969' },
  { token: 'type', foreground: '4ec9b0' },
  { token: 'function', foreground: 'dcdcaa' },
  { token: 'variable', foreground: '9cdcfe' },
  { token: 'constant', foreground: '4fc1ff' },
  { token: 'tag', foreground: '569cd6' },
  { token: 'attribute.name', foreground: '9cdcfe' },
  { token: 'attribute.value', foreground: 'ce9178' },
  { token: 'delimiter', foreground: 'cccccc' },
]
const DARK_COLORS = {
  'editor.background': '#121314',
  'editor.foreground': '#bfbfbf',
  'editorLineNumber.foreground': '#6e6e6e',
  'editorLineNumber.activeForeground': '#bfbfbf',
  'editorCursor.foreground': '#bfbfbf',
  'editor.selectionBackground': '#264f78',
  'editor.inactiveSelectionBackground': '#3a3d41',
  'editor.lineHighlightBackground': '#191a1b',
  'editorIndentGuide.background1': '#303132',
  'editorIndentGuide.activeBackground1': '#4a4b4c',
  'editorWhitespace.foreground': '#3b3b3b',
  'editorGutter.background': '#121314',
  // The minimap inherits `editor.background` on its own, but the slider keeps the scrollbar palette.
  'minimap.background': '#121314',
  'minimapSlider.background': '#79797940',
  'minimapSlider.hoverBackground': '#64646473',
  'minimapSlider.activeBackground': '#bfbfbf59',
  'minimap.selectionHighlight': '#264f78',
  'editorWidget.background': '#202122',
  'editorWidget.border': '#2a2b2c',
  'editorSuggestWidget.background': '#202122',
  'editorSuggestWidget.selectedBackground': '#2a2b2c',
  'editorHoverWidget.background': '#202122',
  'editorHoverWidget.border': '#2a2b2c',
  'editorBracketMatch.background': '#0d3a4d',
  'editorBracketMatch.border': '#307e9f',
  'diffEditor.insertedLineBackground': '#172319',
  'diffEditor.removedLineBackground': '#2d1919',
  'diffEditor.insertedTextBackground': '#2a4c2c',
  'diffEditor.removedTextBackground': '#5a2626',
  'diffEditor.border': '#2a2b2c',
  'diffEditor.diagonalFill': '#252526',
  'scrollbarSlider.background': '#79797966',
  'scrollbarSlider.hoverBackground': '#646464b3',
  'scrollbarSlider.activeBackground': '#bfbfbf66',
}
/** Eye-care palette: the editor shares the workbench's warm yellow surface. */
export const EYE_THEME = 'dvw-eyecare'
const EYE_COLORS = {
  'editor.background': '#f7ebc8',
  'editor.foreground': '#3b3324',
  'editorLineNumber.foreground': '#92856a',
  'editorLineNumber.activeForeground': '#5c4a2a',
  'editor.selectionBackground': '#e6d294',
  'editor.inactiveSelectionBackground': '#ecdcae',
  'editor.lineHighlightBackground': '#efe1b4',
  'editorCursor.foreground': '#6b5320',
  'editorWidget.background': '#f7ebc8',
  'editorWidget.border': '#e0cf9f',
  'editorSuggestWidget.background': '#f7ebc8',
  'editorSuggestWidget.border': '#e0cf9f',
  'editorSuggestWidget.selectedBackground': '#f0e0ae',
  'editorHoverWidget.background': '#f7ebc8',
  'editorHoverWidget.border': '#e0cf9f',
  'editorGutter.background': '#f7ebc8',
  'minimap.background': '#f7ebc8',
  'minimapSlider.background': '#92856a55',
  'minimapSlider.hoverBackground': '#92856a88',
  'minimapSlider.activeBackground': '#5c4a2a66',
  'minimap.selectionHighlight': '#e6d294',
  'diffEditor.insertedTextBackground': '#b7d7a8aa',
  'diffEditor.removedTextBackground': '#e8b4ad88',
  'diffEditor.border': '#e0cf9f',
  'diffEditor.diagonalFill': '#eadcb6',
  'scrollbarSlider.background': '#92856a55',
  'scrollbarSlider.hoverBackground': '#92856a88',
  'scrollbarSlider.activeBackground': '#5c4a2a66',
}

export type MonacoColorScheme = WorkbenchColorScheme

export function monacoThemeFor(theme: MonacoColorScheme): string {
  return theme === 'dark' ? DARK_THEME : theme === 'eyecare' ? EYE_THEME : 'vs'
}

function defineWorkbenchThemes(monaco: Monaco): void {
  monaco.editor.defineTheme(DARK_THEME, { base: 'vs-dark', inherit: true, rules: DARK_RULES, colors: DARK_COLORS })
  monaco.editor.defineTheme(EYE_THEME, { base: 'vs', inherit: true, rules: [], colors: EYE_COLORS })
}

/**
 * Bootstrap source for Monaco's AMD web workers. Workers resolve module paths against their own
 * blob URL, so they need an absolute `baseUrl`; without it the TypeScript language worker fails to load.
 */
export function monacoWorkerBootstrap(base: string): string {
  return `self.MonacoEnvironment={baseUrl:${JSON.stringify(base)}};importScripts(${JSON.stringify(`${base}vs/base/worker/workerMain.js`)});`
}

export function loadMonaco(): Promise<Monaco> {
  loading ??= new Promise<Monaco>((resolve, reject) => {
    const start = () => {
      const loader = window.require
      if (loader === undefined) return reject(new Error('Monaco 编辑器加载器不可用'))
      const base = new URL(MONACO_ASSET_BASE, location.href).href
      window.MonacoEnvironment = { getWorkerUrl: () => URL.createObjectURL(new Blob([monacoWorkerBootstrap(base)], { type: 'text/javascript' })) }
      loader.config({ paths: { vs: `${base}vs` }, 'vs/nls': { availableLanguages: { '*': 'zh-cn' } } })
      loader(['vs/nls.messages.zh-cn'], () => {
        completeMonacoChineseMessages()
        loader(['vs/editor/editor.main'], () => {
          if (window.monaco === undefined) return reject(new Error('Monaco 编辑器初始化失败'))
          const { languages: registry } = window.monaco
          if (!registry.getLanguages().some(language => language.id === 'vue')) {
            registry.register({ id: 'vue', extensions: ['.vue'], aliases: ['Vue'] })
            registry.onLanguage('vue', () => {
              loader(['vs/basic-languages/html/html'], (html: { language: languages.IMonarchLanguage; conf: languages.LanguageConfiguration }) => {
                registry.setLanguageConfiguration('vue', html.conf)
                registry.setMonarchTokensProvider('vue', html.language)
              })
            })
          }
          defineWorkbenchThemes(window.monaco)
          resolve(window.monaco)
        }, reject)
      }, reject)
    }
    if (window.require !== undefined) { start(); return }
    const script = document.createElement('script'); script.src = `${MONACO_ASSET_BASE}vs/loader.js`; script.onload = start; script.onerror = () => { script.remove(); reject(new Error('Monaco 编辑器加载失败')) }; document.head.append(script)
  }).catch(error => { loading = undefined; throw error })
  return loading
}

export type GitDiffStyle = 'classic' | 'ribbon'

type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor

export interface GitDiffReviewActions {
  onAsk(range: GitDiffLineRange): void
}

export function MonacoDiffEditor(props: {
  uri: string
  sourcePath?: string
  versions?: readonly [string, string]
  viewControls?: ReactNode
  reviewActions?: GitDiffReviewActions
  original: string
  modified: string
  mode: 'inline' | 'split'
  style?: GitDiffStyle
  blame?: GitDiff['blame']
  blameSessionId?: string
  theme: MonacoColorScheme
  fontSize?: number
}) {
  const root = useRef<HTMLDivElement>(null)
  const board = useRef<HTMLDivElement>(null)
  const leftPane = useRef<HTMLDivElement>(null)
  const rightPane = useRef<HTMLDivElement>(null)
  const ribbon = useRef<SVGSVGElement>(null)
  const hunkControls = useRef<HTMLDivElement>(null)
  const overview = useRef<HTMLInputElement>(null)
  const marks = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const linked = useRef<ReturnType<typeof connectGitSplit>>()
  const splitPanes = useRef<import('monaco-editor').editor.IStandaloneCodeEditor[]>([])
  const editor = useRef<DiffEditor>()
  const lineBlame = useRef<ReturnType<typeof createGitLineBlame>>()
  const ribbonStyle = props.style === 'ribbon'
  const parallax = ribbonStyle && props.mode === 'split'
  const [foldPreference, setFoldPreference] = useState<boolean>()
  const fold = foldPreference ?? ribbonStyle
  const latest = useRef({ ...props, fold })
  latest.current = { ...props, fold }
  const [error, setError] = useState<string>()
  const [summary, setSummary] = useState<{ count: number; added: number; removed: number }>()
  const [before, after] = props.versions ?? ['原版本', '对比版本']

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    setError(undefined)
    setSummary(undefined)
    void loadMonaco().then(monaco => {
      if (disposed || root.current === null) return
      const current = latest.current
      const name = (current.sourcePath ?? current.uri).replace(/\\/g, '/').replace(/^\/+/, '')
      const path = `/diff/${++diffModelSequence}/${name}`
      const original = monaco.editor.createModel(current.original, editorLanguageForPath(current.sourcePath ?? path), monaco.Uri.from({ scheme: 'dvw-diff-original', path }))
      const modified = monaco.editor.createModel(current.modified, editorLanguageForPath(current.sourcePath ?? path), monaco.Uri.from({ scheme: 'dvw-diff-modified', path }))
      const instance = monaco.editor.createDiffEditor(root.current, {
        automaticLayout: true, readOnly: true, originalEditable: false, ignoreTrimWhitespace: false,
        ...WORKBENCH_EDITOR_CHROME,
        theme: monacoThemeFor(current.theme), fontSize: current.fontSize ?? 14,
        renderSideBySide: current.mode === 'split', useInlineViewWhenSpaceIsLimited:false,
        ...diffStyleOptions(current.style === 'ribbon' && !parallax, current.fold && !parallax),
      })
      if (parallax && board.current && leftPane.current && rightPane.current && ribbon.current && hunkControls.current && overview.current && marks.current && preview.current) {
        const hosts = [leftPane.current,rightPane.current] as const
        const panes = hosts.map((host,index)=>monaco.editor.create(host,{
          ...WORKBENCH_EDITOR_CHROME,
          model:index===0?original:modified,
          theme:monacoThemeFor(current.theme), fontSize:current.fontSize??14,
          automaticLayout:true, readOnly:true, domReadOnly:true, folding:false, wordWrap:'off',
          glyphMargin:false, lineDecorationsWidth:8, lineNumbersMinChars:3,
          renderLineHighlight:'none', stickyScroll:{enabled:false},
          ariaLabel:index===0?'原版本代码':'对比版本代码',
          scrollbar:{...WORKBENCH_EDITOR_CHROME.scrollbar, vertical:'hidden', verticalScrollbarSize:0},
        })) as [import('monaco-editor').editor.IStandaloneCodeEditor,import('monaco-editor').editor.IStandaloneCodeEditor]
        splitPanes.current = panes
        panes.forEach(localizeMonacoActions)
        linked.current = connectGitSplit(
          board.current,
          panes,
          ribbon.current,
          overview.current,
          marks.current,
          preview.current,
          hunkControls.current,
          () => latest.current.reviewActions,
        )
      }
      const originalPane = instance.getOriginalEditor()
      const modifiedPane = instance.getModifiedEditor()
      const inlineColors = ribbonStyle && !parallax
        ? colorInlineGitDiff(instance.getModifiedEditor(), monaco.editor.OverviewRulerLane.Full)
        : undefined
      const subscriptions = [
        instance.onDidUpdateDiff(() => {
          const changes = instance.getLineChanges()
          if (changes !== null) {
            let added = 0, removed = 0
            for (const change of changes) {
              if (change.modifiedEndLineNumber) added += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1
              if (change.originalEndLineNumber) removed += change.originalEndLineNumber - change.originalStartLineNumber + 1
            }
            setSummary({ count: changes.length, added, removed })
            linked.current?.update(changes,latest.current.fold)
            inlineColors?.update(changes)
          }
        }),
      ]
      const attribution = createGitLineBlame()
      lineBlame.current = attribution
      const visiblePanes = parallax ? splitPanes.current : [originalPane, modifiedPane]
      visiblePanes.forEach((pane,index)=>{
        const lookup = (side: number) => {
          const {blame,blameSessionId} = latest.current
          const source = side === 0 ? blame?.original : blame?.modified
          return blameSessionId && source ? {sessionId:blameSessionId,source} : undefined
        }
        subscriptions.push(attribution.watch(pane,()=>index === 0 && !parallax && latest.current.mode === 'inline'
          ? undefined : lookup(index), (start,end)=>{
          if (parallax || index !== 1 || latest.current.mode !== 'inline') return
          const context = lookup(0)
          if (!context) return
          const change = instance.getLineChanges()?.find(item=>item.originalEndLineNumber > 0 &&
            item.modifiedStartLineNumber >= start-1 && item.modifiedStartLineNumber <= end+1)
          if (change) return {context,line:change.originalStartLineNumber,last:lastBlameLine(originalPane.getModel())}
        }))
        subscriptions.push(pane.onMouseDown(event=>{
          const { blame, blameSessionId, mode } = latest.current
          if (!blameSessionId || !blame) return
          const deleted = !parallax && mode === 'inline' && index === 1 ? clickedDeletedLine(monaco,event,instance) : undefined
          const source = index === 0 || deleted ? blame.original : blame.modified
          const line = deleted?.line ?? clickedCodeLine(monaco,event,pane)
          if (line !== undefined && source) attribution.show(pane,line,blameSessionId,source,deleted,
            deleted ? lastBlameLine(originalPane.getModel()) : undefined)
        }))
      })
      cleanup = () => {
        subscriptions.forEach(subscription => subscription.dispose())
        attribution.reset()
        lineBlame.current = undefined
        linked.current?.dispose()
        linked.current = undefined
        inlineColors?.dispose()
        splitPanes.current.forEach(pane=>pane.dispose())
        splitPanes.current = []
        instance.dispose()
        original.dispose()
        modified.dispose()
        editor.current = undefined
      }
      localizeMonacoActions(instance.getOriginalEditor())
      localizeMonacoActions(instance.getModifiedEditor())
      instance.setModel({ original, modified })
      editor.current = instance
    }).catch(cause => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { disposed = true; cleanup?.() }
  }, [props.uri, parallax, ribbonStyle])

  useEffect(() => lineBlame.current?.reset(), [props.blameSessionId, props.blame])
  useEffect(() => lineBlame.current?.clear(), [props.mode, fold])
  useEffect(() => {
    const model = editor.current?.getModel()
    if (model === null || model === undefined) return
    if (model.original.getValue() !== props.original) model.original.setValue(props.original)
    if (model.modified.getValue() !== props.modified) model.modified.setValue(props.modified)
  }, [props.original, props.modified])
  useEffect(() => {
    const value = editor.current
    if (value === undefined) return
    value.updateOptions({renderSideBySide:props.mode==='split'})
    const frame = requestAnimationFrame(()=>{
      value.layout()
    })
    return ()=>cancelAnimationFrame(frame)
  }, [props.mode, props.style])
  useEffect(() => {
    editor.current?.updateOptions(diffStyleOptions(ribbonStyle && !parallax, fold && !parallax))
    const changes = editor.current?.getLineChanges()
    if (changes) linked.current?.update(changes,fold)
  }, [ribbonStyle, fold, parallax])
  useEffect(() => {
    const fontSize = props.fontSize ?? 14
    editor.current?.updateOptions({ fontSize })
    splitPanes.current.forEach(pane=>pane.updateOptions({fontSize}))
  }, [props.fontSize])
  useEffect(() => {
    linked.current?.refreshActions()
  }, [props.reviewActions !== undefined, props.mode])
  useEffect(() => { window.monaco?.editor.setTheme(monacoThemeFor(props.theme)) }, [props.theme])

  return <div className="dvw-git-diff-view" data-jetbrains={ribbonStyle || undefined} data-theme={props.theme}>
    <div className="dvw-git-diff-bar">
      <div className="dvw-git-diff-revisions">
        <span className="dvw-git-diff-from"><Icon name="lock"/>{before}</span>
        {props.sourcePath&&<span className="dvw-git-diff-path" title={props.sourcePath}>{props.sourcePath}</span>}
      </div>
      <div className="dvw-git-diff-to">{after}</div>
      <div className="dvw-git-diff-actions" role="group" aria-label="对比操作">
        <span className="dvw-git-diff-count" role="status">
          {error !== undefined ? '加载失败' : summary === undefined ? '计算中…' : `${summary.count} 处`}
        </span>
        {summary!==undefined&&summary.count>0&&<span className="dvw-git-diff-lines" aria-label={`新增 ${summary.added} 行，删除 ${summary.removed} 行`}>
          <span>+{summary.added}</span><span>−{summary.removed}</span>
        </span>}
        <button className="dvw-icon" title="上一处改动" aria-label="上一处改动" disabled={!summary?.count} onClick={()=>{if(linked.current) linked.current.navigate('previous');else editor.current?.goToDiff('previous')}}><Icon name="chevron-up"/></button>
        <button className="dvw-icon" title="下一处改动" aria-label="下一处改动" disabled={!summary?.count} onClick={()=>{if(linked.current) linked.current.navigate('next');else editor.current?.goToDiff('next')}}><Icon name="chevron-down"/></button>
        <button className="dvw-mode-button" title="折叠未改动行" aria-label="折叠未改动行" aria-pressed={fold} onClick={()=>setFoldPreference(!fold)}><Icon name={fold?'unfold':'fold'}/><span>折叠</span></button>
        {props.viewControls}
      </div>
    </div>
    <div className="dvw-git-diff-body">
      <div className="dvw-diff dvw-monaco-diff" data-mode={props.mode} data-render-side-by-side={props.mode==='split'} data-compute-only={parallax||undefined} aria-hidden={parallax||undefined} ref={root}/>
      {parallax&&<div className="dvw-diff-parallax" ref={board}>
        <div className="dvw-diff-parallax-pane" ref={leftPane}/>
        <svg className="dvw-diff-ribbons" aria-hidden="true" ref={ribbon}/>
        <div className="dvw-diff-parallax-pane" ref={rightPane}/>
        <div className="dvw-diff-hunk-controls" ref={hunkControls}/>
        <div className="dvw-diff-overview">
          <div className="dvw-diff-overview-marks" ref={marks} aria-hidden="true"/>
          <input aria-label="差异滚动进度" type="range" min="0" defaultValue="0" step="any" ref={overview}/>
          <div className="dvw-diff-scroll-preview" ref={preview} aria-hidden="true" hidden/>
        </div>
      </div>}
      {error!==undefined&&<div className="dvw-error" role="alert">{error}</div>}
    </div>
  </div>
}

let diffModelSequence = 0

function diffStyleOptions(ribbonInline: boolean, fold: boolean): import('monaco-editor').editor.IDiffEditorOptions & import('monaco-editor').editor.IEditorOptions {
  return {
    renderOverviewRuler: false,
    overviewRulerLanes: ribbonInline ? 1 : 0,
    hideUnchangedRegions: { enabled: fold, contextLineCount: 3 },
  }
}

/** Start downloading Monaco in the background so the first opened file does not wait for it. */
export function preloadMonaco(): void {
  void loadMonaco().catch(() => { /* The editor reports the failure when it mounts. */ })
}

function modelUri(monaco: Monaco, uri: string): import('monaco-editor').Uri {
  return monaco.Uri.parse(uri.startsWith('file:') ? uri : projectModelPath('', uri))
}

/** Scroll and cursor positions per document, kept while its tab stays open. */
const viewStates = new Map<string, import('monaco-editor').editor.ICodeEditorViewState>()
/** The search hit last revealed per document, so only a new hit overrides the saved position. */
const revealedHits = new Map<string, string>()
const hitKey = (props: { line?: number; endLine?: number; column?: number; highlight?: string }) => props.line === undefined ? '' : `${props.line}:${props.endLine ?? props.line}:${props.column ?? 1}:${props.highlight ?? ''}`

/** Dispose the models of closed tabs so Monaco stops tracking their text. */
export function retainEditorModels(uris: string[]): void {
  const monaco = window.monaco
  if (monaco === undefined) return
  const keep = new Set(uris.map(uri => modelUri(monaco, uri).toString()))
  for (const model of monaco.editor.getModels()) {
    const key = model.uri.toString()
    if (model.uri.scheme !== 'file' || keep.has(key) || model.isAttachedToEditor()) continue
    // Closing a tab returns its file to the language-service index instead of dropping it.
    if (isLspPreviewModel(model)) continue
    if (isIndexedModel(key)) { viewStates.delete(key); revealedHits.delete(key); continue }
    viewStates.delete(key); revealedHits.delete(key); model.dispose()
  }
}

/** The primary selection as text plus inclusive lines; a selection ending at column 1 does not claim that line. */
function editorSelection(instance: import('monaco-editor').editor.IStandaloneCodeEditor): EditorSelection | undefined {
  const model = instance.getModel(); const range = instance.getSelection()
  if (model === null || range === null || range.isEmpty()) return undefined
  const endLine = range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber
  return { text: model.getValueInRange(range), startLine: range.startLineNumber, endLine }
}

export interface EditorReviewChange extends ReviewChange { conflict?: string }

export interface ReviewLinePresentation {
  readonly addedLines: number[]
  readonly deletedGroups: Array<{ afterLineNumber: number; lines: string[] }>
  readonly controlAfterLine: number
}

type LineOperation =
  | { kind: 'same' | 'insert'; text: string }
  | { kind: 'delete'; text: string }

function lineOperations(before: string | null, after: string): LineOperation[] {
  if (before === null || before === '') {
    return after === '' ? [] : after.split('\n').map(text => ({ kind: 'insert', text }))
  }
  const left = before.split('\n')
  const right = after.split('\n')
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++
  let suffix = 0
  while (
    suffix < left.length - prefix
    && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix++
  const leftMiddle = left.slice(prefix, left.length - suffix)
  const rightMiddle = right.slice(prefix, right.length - suffix)
  const operations: LineOperation[] = left.slice(0, prefix).map(text => ({ kind: 'same', text }))

  if (leftMiddle.length * rightMiddle.length > 1_000_000) {
    operations.push(...leftMiddle.map(text => ({ kind: 'delete' as const, text })))
    operations.push(...rightMiddle.map(text => ({ kind: 'insert' as const, text })))
  } else {
    const rows = leftMiddle.length + 1
    const columns = rightMiddle.length + 1
    const lcs = new Uint32Array(rows * columns)
    for (let i = leftMiddle.length - 1; i >= 0; i--) {
      for (let j = rightMiddle.length - 1; j >= 0; j--) {
        const at = i * columns + j
        lcs[at] = leftMiddle[i] === rightMiddle[j]
          ? 1 + lcs[(i + 1) * columns + j + 1]!
          : Math.max(lcs[(i + 1) * columns + j]!, lcs[i * columns + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < leftMiddle.length || j < rightMiddle.length) {
      if (i < leftMiddle.length && j < rightMiddle.length && leftMiddle[i] === rightMiddle[j]) {
        operations.push({ kind: 'same', text: leftMiddle[i]! })
        i++
        j++
      } else if (j >= rightMiddle.length || (i < leftMiddle.length && lcs[(i + 1) * columns + j]! >= lcs[i * columns + j + 1]!)) {
        operations.push({ kind: 'delete', text: leftMiddle[i++]! })
      } else {
        operations.push({ kind: 'insert', text: rightMiddle[j++]! })
      }
    }
  }
  operations.push(...left.slice(left.length - suffix).map(text => ({ kind: 'same' as const, text })))
  return operations
}

/** Present only the changed lines inside a tool hunk, anchored to the current file. */
export function reviewLinePresentation(
  content: string,
  change: Pick<ReviewChange, 'before' | 'after'>,
): ReviewLinePresentation | undefined {
  const location = locateReviewChange(content, change)
  if (location === undefined) return undefined
  const addedLines: number[] = []
  const deletedGroups: Array<{ afterLineNumber: number; lines: string[] }> = []
  let afterOffset = 0
  let deleted: string[] = []
  const flushDeleted = () => {
    if (deleted.length === 0) return
    deletedGroups.push({ afterLineNumber: Math.max(0, location.startLine + afterOffset - 1), lines: deleted })
    deleted = []
  }
  for (const operation of lineOperations(change.before, change.after)) {
    if (operation.kind === 'delete') {
      deleted.push(operation.text)
      continue
    }
    flushDeleted()
    if (operation.kind === 'insert') addedLines.push(location.startLine + afterOffset)
    afterOffset++
  }
  flushDeleted()
  const controlAfterLine = addedLines.at(-1)
    ?? deletedGroups.at(-1)?.afterLineNumber
    ?? location.startLine
  return { addedLines, deletedGroups, controlAfterLine }
}

export interface MonacoReviewProps {
  changes: EditorReviewChange[]
  activeId?: string
  busy?: boolean
  rejectDisabled?: boolean
  onFocus(id: string): void
  onKeep(id: string): void
  onReject(id: string): void
  onAsk?(change: EditorReviewChange): void
}

export function MonacoEditor(props: { uri: string; value: string; readOnly?: boolean; theme: MonacoColorScheme; line?: number; endLine?: number; column?: number; fontSize?: number; minimap?: boolean; highlight?: string; focusOnReveal?: boolean; review?: MonacoReviewProps; blame?: { sessionId: string; path: string; revision: string; dirty: boolean }; breakpoints?: number[]; pausedLine?: number; onToggleBreakpoint?(line: number): void; aiCompletion?: InlineCompletionSettings; onCompletionError?(message: string): void; onChange(value: string): void; onSave(): void; onAddToDsh?(selection?: EditorSelection): void }) {
  const inlineCompletion = useRef<{ dispose(): void }>()
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<import('monaco-editor').editor.IStandaloneCodeEditor>()
  const lineBlame = useRef<ReturnType<typeof createGitLineBlame>>()
  const decorations = useRef<import('monaco-editor').editor.IEditorDecorationsCollection>()
  const reviewDecorations = useRef<import('monaco-editor').editor.IEditorDecorationsCollection>()
  const reviewZoneIds = useRef<string[]>([])
  const reviewWidgets = useRef<Array<import('monaco-editor').editor.IContentWidget>>([])
  const reviewLineIds = useRef(new Map<number, string>())
  const cleanupListeners = useRef<(() => void) | undefined>(undefined)
  const latest = useRef(props)
  latest.current = props
  const [error, setError] = useState<string>()
  /** Select the requested search hit in the current model. */
  const reveal = (monaco: Monaco, instance: import('monaco-editor').editor.IStandaloneCodeEditor) => {
    const { line: target, endLine, column, highlight } = latest.current
    const model = instance.getModel()
    decorations.current?.clear(); decorations.current = undefined
    if (model === null) return
    revealedHits.set(model.uri.toString(), hitKey(latest.current))
    if (target === undefined) return
    const firstLine = Math.max(1, Math.min(Math.round(target), model.getLineCount()))
    const lastLine = endLine === undefined
      ? firstLine
      : Math.max(firstLine, Math.min(Math.round(endLine), model.getLineCount()))
    const text = model.getLineContent(firstLine)
    const needle = highlight ?? ''
    const { startColumn, endColumn } = searchHighlightRange(text, needle, column ?? 1)
    const range = new monaco.Range(firstLine, startColumn, lastLine, lastLine === firstLine ? endColumn : model.getLineMaxColumn(lastLine))
    instance.setSelection(range)
    instance.revealLineInCenter(firstLine)
    if (latest.current.focusOnReveal !== false) instance.focus()
    decorations.current = needle === '' ? undefined : instance.createDecorationsCollection([{ range, options: { inlineClassName: 'dvw-search-hit' } }])
  }
  /** Paint current-file review hunks and their per-block controls without changing the model. */
  const paintReview = (monaco: Monaco, instance: import('monaco-editor').editor.IStandaloneCodeEditor) => {
    reviewDecorations.current?.clear()
    reviewDecorations.current = undefined
    for (const widget of reviewWidgets.current) instance.removeContentWidget(widget)
    reviewWidgets.current = []
    reviewLineIds.current.clear()
    const model = instance.getModel()
    if (model === null) return
    const review = latest.current.review
    const changes = review?.changes ?? []
    const decorations: import('monaco-editor').editor.IModelDeltaDecoration[] = []
    const editorFont = (() => {
      const line = typeof instance.getDomNode === 'function'
        ? instance.getDomNode()?.querySelector<HTMLElement>('.view-line') ?? null
        : null
      if (line === null) return undefined
      const style = getComputedStyle(line)
      return { family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, spacing: style.letterSpacing }
    })()
    const applyEditorFont = (node: HTMLElement) => {
      if (editorFont === undefined) return
      node.style.fontFamily = editorFont.family
      node.style.fontSize = editorFont.size
      node.style.lineHeight = editorFont.lineHeight
      node.style.letterSpacing = editorFont.spacing
    }
    const markState = (node: HTMLElement, change: EditorReviewChange, active: boolean) => {
      if (change.conflict !== undefined) node.dataset.conflict = ''
      if (active) node.dataset.active = ''
    }
    const zones: Array<{
      afterLineNumber: number
      heightInLines: number
      domNode: HTMLElement
      suppressMouseDown?: boolean
    }> = []
    const contentWidgets: import('monaco-editor').editor.IContentWidget[] = []
    const actionsFor = (change: EditorReviewChange): HTMLElement => {
      const actions = document.createElement('div')
      actions.className = 'dvw-review-zone-actions'
      const label = document.createElement('span')
      label.className = 'dvw-review-zone-label'
      label.textContent = change.conflict ?? ''
      const keep = document.createElement('button')
      keep.type = 'button'
      keep.dataset.action = 'accept'
      keep.textContent = '允许'
      keep.disabled = review?.busy === true
      keep.title = '允许这一处 AI 修改 (Alt+Y)'
      keep.addEventListener('click', () => latest.current.review?.onKeep(change.id))
      const reject = document.createElement('button')
      reject.type = 'button'
      reject.dataset.action = 'reject'
      reject.textContent = '拒绝'
      reject.disabled = review?.busy === true || change.conflict !== undefined || review?.rejectDisabled === true
      reject.title = reject.disabled ? (change.conflict ?? '当前无法撤销') : '拒绝这一处 AI 修改 (Alt+N)'
      reject.addEventListener('click', () => latest.current.review?.onReject(change.id))
      const ask = document.createElement('button')
      ask.type = 'button'
      ask.dataset.action = 'ask'
      ask.disabled = review?.busy === true
      ask.title = '让 DSH 修复或优化此文件'
      ask.innerHTML = '<span class="codicon codicon-sparkle"></span>询问 AI'
      ask.addEventListener('click', () => latest.current.review?.onAsk?.(change))
      actions.append(label, keep, reject, ask)
      return actions
    }
    const addActionWidget = (change: EditorReviewChange, afterLineNumber: number) => {
      const node = document.createElement('div')
      node.className = 'dvw-review-widget'
      node.dataset.reviewId = change.id
      markState(node, change, change.id === review?.activeId)
      // Monaco starts mouse tracking from pointerdown. Keep the gesture inside the
      // review controls so its pointerup cannot be captured by the editor before
      // the button receives click.
      node.addEventListener('pointerdown', event => {
        event.stopPropagation()
        review?.onFocus(change.id)
      })
      node.addEventListener('mousedown', event => event.stopPropagation())
      node.append(actionsFor(change))
      const line = Math.max(1, Math.min(afterLineNumber, model.getLineCount()))
      contentWidgets.push({
        getId: () => `dvw-review-${change.id}`,
        getDomNode: () => node,
        getPosition: () => ({
          position: { lineNumber: line, column: model.getLineMaxColumn(line) },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW],
        }),
        allowEditorOverflow: true,
        suppressMouseDown: true,
      })
    }
    for (const change of changes) {
      const presentation = reviewLinePresentation(model.getValue(), change)
      const active = review?.activeId === change.id
      if (presentation === undefined) {
        if (active || change.conflict !== undefined) addActionWidget(change, 1)
        continue
      }

      for (let index = 0; index < presentation.addedLines.length;) {
        const startLine = presentation.addedLines[index]!
        let endLine = startLine
        reviewLineIds.current.set(startLine, change.id)
        index++
        while (index < presentation.addedLines.length && presentation.addedLines[index] === endLine + 1) {
          endLine = presentation.addedLines[index]!
          reviewLineIds.current.set(endLine, change.id)
          index++
        }
        decorations.push({
          range: new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
          options: {
            isWholeLine: true,
            className: change.conflict !== undefined ? 'dvw-review-line-conflict' : active ? 'dvw-review-line-added dvw-review-line-active' : 'dvw-review-line-added',
            linesDecorationsClassName: change.conflict !== undefined ? 'dvw-review-gutter-conflict' : 'dvw-review-gutter-added',
          },
        })
      }

      for (const group of presentation.deletedGroups) {
        const Zone = document.createElement('div')
        Zone.className = 'dvw-review-zone'
        Zone.dataset.reviewId = change.id
        markState(Zone, change, active)
        Zone.addEventListener('pointerdown', () => review?.onFocus(change.id))
        const removed = document.createElement('pre')
        removed.className = 'dvw-review-removed'
        removed.textContent = group.lines.join('\n')
        applyEditorFont(removed)
        Zone.append(removed)
        zones.push({
          afterLineNumber: group.afterLineNumber,
          heightInLines: group.lines.length,
          domNode: Zone,
        })
      }
      addActionWidget(change, presentation.controlAfterLine)
    }
    if (decorations.length > 0) reviewDecorations.current = instance.createDecorationsCollection(decorations)
    instance.changeViewZones?.(accessor => {
      for (const id of reviewZoneIds.current) accessor.removeZone(id)
      reviewZoneIds.current = zones.map(zone => accessor.addZone(zone))
    })
    reviewWidgets.current = contentWidgets
    for (const widget of contentWidgets) instance.addContentWidget(widget)
  }
  /** Show the current tab's model in the shared editor, restoring where the user left it. */
  const attach = (monaco: Monaco, instance: import('monaco-editor').editor.IStandaloneCodeEditor) => {
    const { uri, value } = latest.current
    const next = modelUri(monaco, uri)
    const previous = instance.getModel()
    if (previous?.uri.toString() === next.toString()) return
    const state = instance.saveViewState()
    if (previous !== null && state !== null) viewStates.set(previous.uri.toString(), state)
    const model = monaco.editor.getModel(next) ?? monaco.editor.createModel(value, editorLanguageForPath(next.path ?? uri), next)
    if (model.getValue() !== value) model.setValue(value)
    instance.setModel(model)
    const saved = viewStates.get(next.toString())
    if (saved !== undefined) instance.restoreViewState(saved)
    if (saved === undefined || revealedHits.get(next.toString()) !== hitKey(latest.current)) reveal(monaco, instance)
    else { decorations.current?.clear(); decorations.current = undefined }
    paintReview(monaco, instance)
  }
  // One editor instance serves every text tab: switching tabs swaps its model
  // instead of rebuilding Monaco's DOM, workers and services.
  // Breakpoint dots and the paused line are decorations on the existing model, so no rebuild.
  useEffect(() => {
    const instance = editor.current
    const model = instance?.getModel()
    if (instance === undefined || model === null || model === undefined) return
    const collections = (instance as unknown as { __dvwDebug?: import('monaco-editor').editor.IEditorDecorationsCollection }).__dvwDebug
      ?? instance.createDecorationsCollection([])
    ;(instance as unknown as { __dvwDebug?: unknown }).__dvwDebug = collections
    const decorations = (props.breakpoints ?? []).map(line => ({
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { isWholeLine: false, linesDecorationsClassName: 'dvw-debug-breakpoint' },
    }))
    if (props.pausedLine !== undefined) {
      decorations.push({
        range: { startLineNumber: props.pausedLine, startColumn: 1, endLineNumber: props.pausedLine, endColumn: 1 },
        options: { isWholeLine: true, className: 'dvw-debug-paused-line', linesDecorationsClassName: 'dvw-debug-paused-arrow' },
      } as never)
    }
    collections.set(decorations as never)
  }, [props.breakpoints, props.pausedLine])
  useEffect(() => {
    let disposed = false
    void loadMonaco().then((monaco) => {
      if (disposed || root.current === null) return
      const props = latest.current
      const instance = monaco.editor.create(root.current, { model: null, automaticLayout: true, readOnly: props.readOnly, 'semanticHighlighting.enabled': true, theme: monacoThemeFor(props.theme), fontSize: props.fontSize ?? 14, ...WORKBENCH_EDITOR_CHROME, inlineSuggest: { enabled: false }, wordWrap: 'off', minimap: minimapOptions(minimapEnabled(props)) })
      // Breakpoints live in the line-decorations strip so the layout does not shift, and a click
      // there toggles one exactly like VS Code's gutter.
      instance.onMouseDown(event => {
        const type = event.target.type
        if (type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS && type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return
        const line = event.target.position?.lineNumber
        if (line !== undefined) latest.current.onToggleBreakpoint?.(line)
      })
      localizeMonacoActions(instance)
      editor.current = instance
      const attribution = createGitLineBlame()
      lineBlame.current = attribution
      const blameWatch = attribution.watch(instance,()=>{
        const blame = latest.current.blame
        if (blame && !blame.dirty) return {
          sessionId:blame.sessionId,source:{kind:'document',path:blame.path,revision:blame.revision},
        }
      })
      instance.onDidChangeModelContent(() => { if (!latest.current.readOnly) latest.current.onChange(instance.getValue()) })
      instance.onMouseDown(event => {
        const id = reviewLineIds.current.get(event.target.position?.lineNumber ?? 0)
        if (id !== undefined) latest.current.review?.onFocus(id)
        const blame = latest.current.blame
        if (!blame) return
        const line = clickedCodeLine(monaco,event,instance)
        if (line === undefined) return
        attribution.show(instance,line,blame.sessionId,blame.dirty ? undefined : {kind:'document',path:blame.path,revision:blame.revision})
      })
      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.onSave())
      instance.addAction({ id: 'dvw.addToDsh', label: '添加到 DSH 对话', contextMenuGroupId: 'navigation', contextMenuOrder: 0, keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyK], run: () => latest.current.onAddToDsh?.(editorSelection(instance)) })
      // Monaco maps go-to-definition to Cmd-click on macOS; also honor the usual Ctrl-click.
      const mac = isMacPlatform()
      let jumpedAt = -Infinity
      const jumpToDefinition = (clientX: number, clientY: number): boolean => {
        const position = instance.getTargetAtClientPoint(clientX, clientY)?.position
        if (position === null || position === undefined) return false
        jumpedAt = performance.now()
        instance.setPosition(position); instance.focus()
        // Definition navigation is registered as a command (Action2); getAction() cannot reach it.
        instance.trigger('dvw.definitionClick', 'editor.action.revealDefinition', null)
        return true
      }
      const onMouseDown = (event: MouseEvent) => {
        if (!mac || !isMacDefinitionClick(event)) return
        event.preventDefault(); event.stopPropagation()
        jumpToDefinition(event.clientX, event.clientY)
      }
      // Chrome turns Control-click on macOS into a context menu; suppress it so the jump stands.
      const onContextMenu = (event: MouseEvent) => {
        if (!mac || !event.ctrlKey || event.metaKey) return
        event.preventDefault(); event.stopPropagation()
        // macOS may swallow the Control state in mousedown but keep it here; jump as a fallback.
        if (performance.now() - jumpedAt > 500) jumpToDefinition(event.clientX, event.clientY)
      }
      root.current.addEventListener('mousedown', onMouseDown, true)
      root.current.addEventListener('contextmenu', onContextMenu, true)
      cleanupListeners.current = () => {
        blameWatch.dispose()
        root.current?.removeEventListener('mousedown', onMouseDown, true)
        root.current?.removeEventListener('contextmenu', onContextMenu, true)
      }
      attach(monaco, instance)
    }).catch(error => setError(error instanceof Error ? error.message : String(error)))
    return () => {
      disposed = true
      inlineCompletion.current?.dispose(); inlineCompletion.current = undefined
      cleanupListeners.current?.(); cleanupListeners.current = undefined
      lineBlame.current?.reset(); lineBlame.current = undefined
      const instance = editor.current
      const model = instance?.getModel(); const state = instance?.saveViewState()
      if (model && state) viewStates.set(model.uri.toString(), state)
      reviewDecorations.current?.clear(); reviewDecorations.current = undefined
      for (const widget of reviewWidgets.current) instance?.removeContentWidget(widget)
      reviewWidgets.current = []
      instance?.changeViewZones?.(accessor => { for (const id of reviewZoneIds.current) accessor.removeZone(id) })
      reviewZoneIds.current = []
      reviewLineIds.current.clear()
      instance?.dispose(); editor.current = undefined
    }
  }, [])
  useEffect(() => {
    const settings = props.aiCompletion
    if (settings === undefined || props.readOnly) return
    let active = true
    void loadMonaco().then(monaco => {
      if (!active || editor.current === undefined) return
      inlineCompletion.current = registerInlineCompletion(monaco, editor.current, settings, message => latest.current.onCompletionError?.(message))
    }).catch(() => { if (active && editor.current !== undefined) latest.current.onCompletionError?.('无法初始化 AI 代码补全。') })
    return () => {
      active = false
      inlineCompletion.current?.dispose()
      inlineCompletion.current = undefined
    }
  }, [props.aiCompletion, props.readOnly])
  useEffect(() => lineBlame.current?.reset(), [props.uri, props.blame?.sessionId, props.blame?.revision, props.blame?.dirty, props.value])
  useEffect(() => {
    const instance = editor.current; const monaco = window.monaco
    if (instance !== undefined && monaco !== undefined) attach(monaco, instance)
  }, [props.uri])
  useEffect(() => {
    const model = editor.current?.getModel(); if (model !== null && model !== undefined && model.getValue() !== props.value) model.setValue(props.value)
  }, [props.value])
  useEffect(() => {
    const instance = editor.current; const monaco = window.monaco
    if (instance !== undefined && monaco !== undefined) paintReview(monaco, instance)
  }, [props.uri, props.value, props.fontSize, props.review, props.review?.activeId, props.review?.changes])
  useEffect(() => { if (window.monaco !== undefined) window.monaco.editor.setTheme(monacoThemeFor(props.theme)) }, [props.theme])
  useEffect(() => { editor.current?.updateOptions({ fontSize: props.fontSize ?? 14, readOnly: props.readOnly ?? false }) }, [props.fontSize, props.readOnly])
  useEffect(() => { editor.current?.updateOptions({ minimap: minimapOptions(minimapEnabled(props)) }) }, [props.minimap])
  useEffect(() => {
    const instance = editor.current; const monaco = window.monaco; const model = instance?.getModel()
    if (instance === undefined || monaco === undefined || model === null || model === undefined) return
    if (revealedHits.get(model.uri.toString()) !== hitKey(props)) reveal(monaco, instance)
  }, [props.uri, props.line, props.endLine, props.column, props.highlight])
  return error === undefined ? <div ref={root} style={{ position: 'absolute', inset: 0 }} /> : <div className="dvw-error">{error}</div>
}
