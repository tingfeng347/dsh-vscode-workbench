import { useEffect, useRef, useState } from 'react'

type Monaco = typeof import('monaco-editor')
declare global { interface Window { require?: { (ids: string[], done: () => void): void; config(value: unknown): void }; monaco?: Monaco } }
let loading: Promise<Monaco> | undefined
/** Monaco chrome used by both editors so only the narrow native scrollbar remains. */
export const WORKBENCH_EDITOR_CHROME = {
  minimap: { enabled: false },
  renderOverviewRuler: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
} as const

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
function defineWorkbenchThemes(monaco: Monaco): void {
  monaco.editor.defineTheme(DARK_THEME, { base: 'vs-dark', inherit: true, rules: DARK_RULES, colors: DARK_COLORS })
}

export function loadMonaco(): Promise<Monaco> {
  loading ??= new Promise((resolve, reject) => {
    const start = () => {
      const loader = window.require
      if (loader === undefined) return reject(new Error('Monaco AMD loader unavailable'))
      loader.config({ paths: { vs: '/dsh-vscode/monaco/vs' } })
      loader(['vs/editor/editor.main'], () => {
        if (window.monaco === undefined) return reject(new Error('Monaco failed to initialize'))
        defineWorkbenchThemes(window.monaco)
        resolve(window.monaco)
      })
    }
    if (window.require !== undefined) { start(); return }
    const script = document.createElement('script'); script.src = '/dsh-vscode/monaco/vs/loader.js'; script.onload = start; script.onerror = () => reject(new Error('failed to load Monaco')); document.head.append(script)
  })
  return loading
}

export function MonacoDiffEditor(props: { uri: string; original: string; modified: string; mode: 'inline' | 'split'; theme: 'dark' | 'light' }) {
  const root=useRef<HTMLDivElement>(null);const editor=useRef<import('monaco-editor').editor.IStandaloneDiffEditor>();const models=useRef<{original:import('monaco-editor').editor.ITextModel;modified:import('monaco-editor').editor.ITextModel}>();const [error,setError]=useState<string>()
  useEffect(()=>{let disposed=false;void loadMonaco().then(monaco=>{if(disposed||root.current===null)return;const safe=props.uri.replace(/^\/+/, '');const original=monaco.editor.createModel(props.original,undefined,monaco.Uri.parse(`dvw-diff-original:///${safe}`));const modified=monaco.editor.createModel(props.modified,undefined,monaco.Uri.parse(`dvw-diff-modified:///${safe}`));models.current={original,modified};const instance=monaco.editor.createDiffEditor(root.current,{automaticLayout:true,readOnly:true,renderSideBySide:props.mode==='split',theme:props.theme==='dark'?DARK_THEME:'vs',fontSize:14,...WORKBENCH_EDITOR_CHROME,originalEditable:false,ignoreTrimWhitespace:false});instance.setModel({original,modified});editor.current=instance}).catch(error=>setError(error instanceof Error?error.message:String(error)));return()=>{disposed=true;editor.current?.dispose();editor.current=undefined;models.current?.original.dispose();models.current?.modified.dispose();models.current=undefined}},[props.uri])
  useEffect(()=>{const value=models.current;if(value===undefined)return;if(value.original.getValue()!==props.original)value.original.setValue(props.original);if(value.modified.getValue()!==props.modified)value.modified.setValue(props.modified)},[props.original,props.modified])
  useEffect(()=>{editor.current?.updateOptions({renderSideBySide:props.mode==='split'})},[props.mode])
  useEffect(()=>{if(window.monaco!==undefined)window.monaco.editor.setTheme(props.theme==='dark'?DARK_THEME:'vs')},[props.theme])
  return error===undefined?<div className="dvw-diff dvw-monaco-diff" data-mode={props.mode} data-render-side-by-side={props.mode==='split'} ref={root}/>:<div className="dvw-error">{error}</div>
}

export function MonacoEditor(props: { uri: string; value: string; theme: 'dark' | 'light'; line?: number; column?: number; onChange(value: string): void; onSave(): void }) {
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<import('monaco-editor').editor.IStandaloneCodeEditor>()
  const callbacks = useRef({ onChange: props.onChange, onSave: props.onSave })
  callbacks.current = { onChange: props.onChange, onSave: props.onSave }
  const [error, setError] = useState<string>()
  useEffect(() => {
    let disposed = false; let model: import('monaco-editor').editor.ITextModel | undefined
    void loadMonaco().then((monaco) => {
      if (disposed || root.current === null) return
      const uri = monaco.Uri.parse(`file:///${props.uri.replace(/^\/+/, '')}`)
      model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(props.value, undefined, uri)
      if (model.getValue() !== props.value) model.setValue(props.value)
      const instance = monaco.editor.create(root.current, { model, automaticLayout: true, theme: props.theme === 'dark' ? DARK_THEME : 'vs', fontSize: 14, ...WORKBENCH_EDITOR_CHROME, wordWrap: 'off' })
      editor.current = instance
      const change = instance.onDidChangeModelContent(() => callbacks.current.onChange(instance.getValue()))
      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave())
      if (props.line !== undefined) { instance.setPosition({ lineNumber: props.line, column: props.column ?? 1 }); instance.revealLineInCenter(props.line); instance.focus() }
      return () => { change.dispose() }
    }).catch(error => setError(error instanceof Error ? error.message : String(error)))
    return () => { disposed = true; editor.current?.dispose(); editor.current = undefined }
  }, [props.uri])
  useEffect(() => {
    const model = editor.current?.getModel(); if (model !== null && model !== undefined && model.getValue() !== props.value) model.setValue(props.value)
  }, [props.value])
  useEffect(() => { if (window.monaco !== undefined) window.monaco.editor.setTheme(props.theme === 'dark' ? DARK_THEME : 'vs') }, [props.theme])
  return error === undefined ? <div ref={root} style={{ position: 'absolute', inset: 0 }} /> : <div className="dvw-error">{error}</div>
}
