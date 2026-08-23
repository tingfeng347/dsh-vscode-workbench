import { useEffect, useRef, useState } from 'react'

type Monaco = typeof import('monaco-editor')
declare global { interface Window { require?: { (ids: string[], done: () => void): void; config(value: unknown): void }; monaco?: Monaco } }
let loading: Promise<Monaco> | undefined
export function loadMonaco(): Promise<Monaco> {
  loading ??= new Promise((resolve, reject) => {
    const start = () => {
      const loader = window.require
      if (loader === undefined) return reject(new Error('Monaco AMD loader unavailable'))
      loader.config({ paths: { vs: '/dsh-vscode/monaco/vs' } })
      loader(['vs/editor/editor.main'], () => window.monaco === undefined ? reject(new Error('Monaco failed to initialize')) : resolve(window.monaco))
    }
    if (window.require !== undefined) { start(); return }
    const script = document.createElement('script'); script.src = '/dsh-vscode/monaco/vs/loader.js'; script.onload = start; script.onerror = () => reject(new Error('failed to load Monaco')); document.head.append(script)
  })
  return loading
}

export function MonacoDiffEditor(props: { uri: string; original: string; modified: string; mode: 'inline' | 'split'; theme: 'dark' | 'light' }) {
  const root=useRef<HTMLDivElement>(null);const editor=useRef<import('monaco-editor').editor.IStandaloneDiffEditor>();const models=useRef<{original:import('monaco-editor').editor.ITextModel;modified:import('monaco-editor').editor.ITextModel}>();const [error,setError]=useState<string>()
  useEffect(()=>{let disposed=false;void loadMonaco().then(monaco=>{if(disposed||root.current===null)return;const safe=props.uri.replace(/^\/+/, '');const original=monaco.editor.createModel(props.original,undefined,monaco.Uri.parse(`dvw-diff-original:///${safe}`));const modified=monaco.editor.createModel(props.modified,undefined,monaco.Uri.parse(`dvw-diff-modified:///${safe}`));models.current={original,modified};const instance=monaco.editor.createDiffEditor(root.current,{automaticLayout:true,readOnly:true,renderSideBySide:props.mode==='split',theme:props.theme==='dark'?'vs-dark':'vs',fontSize:14,minimap:{enabled:false},originalEditable:false,renderOverviewRuler:true,ignoreTrimWhitespace:false});instance.setModel({original,modified});editor.current=instance}).catch(error=>setError(error instanceof Error?error.message:String(error)));return()=>{disposed=true;editor.current?.dispose();editor.current=undefined;models.current?.original.dispose();models.current?.modified.dispose();models.current=undefined}},[props.uri])
  useEffect(()=>{const value=models.current;if(value===undefined)return;if(value.original.getValue()!==props.original)value.original.setValue(props.original);if(value.modified.getValue()!==props.modified)value.modified.setValue(props.modified)},[props.original,props.modified])
  useEffect(()=>{editor.current?.updateOptions({renderSideBySide:props.mode==='split'})},[props.mode])
  useEffect(()=>{if(window.monaco!==undefined)window.monaco.editor.setTheme(props.theme==='dark'?'vs-dark':'vs')},[props.theme])
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
      const instance = monaco.editor.create(root.current, { model, automaticLayout: true, theme: props.theme === 'dark' ? 'vs-dark' : 'vs', fontSize: 14, minimap: { enabled: true }, wordWrap: 'off' })
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
  useEffect(() => { if (window.monaco !== undefined) window.monaco.editor.setTheme(props.theme === 'dark' ? 'vs-dark' : 'vs') }, [props.theme])
  return error === undefined ? <div ref={root} style={{ position: 'absolute', inset: 0 }} /> : <div className="dvw-error">{error}</div>
}
