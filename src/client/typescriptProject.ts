import { api } from './api.ts'

type Monaco = typeof import('monaco-editor')

/** Settings key for the TS/JS language support; nothing is indexed until the user installs it in settings. */
export const TS_INTELLISENSE_KEY = 'dvw:lsp:typescript'

export function tsIntellisenseEnabled(): boolean { try { return localStorage.getItem(TS_INTELLISENSE_KEY) === 'on' } catch { return false } }

/** Model URI for a workspace file; must match MonacoEditor's `file:///<cwd>/<path>` tab URIs. */
export function projectModelPath(cwd: string, path: string): string { return `file:///${`${cwd}/${path}`.replace(/\\/g, '/').replace(/^\/+/, '')}` }

/** Workspace-relative path for a project model URI, or undefined when it lives outside `cwd`. */
export function workspacePathFromModel(cwd: string, uri: string): string | undefined {
  const prefix = projectModelPath(cwd, '')
  const decoded = decodeURIComponent(uri)
  const lower = (value: string) => value.toLowerCase()
  if (!lower(decoded).startsWith(lower(prefix))) return undefined
  const path = decoded.slice(prefix.length)
  return path === '' ? undefined : path
}

const COMPILER = (monaco: Monaco) => ({
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
  allowJs: true, checkJs: false, allowNonTsExtensions: true, allowImportingTsExtensions: true,
  esModuleInterop: true, resolveJsonModule: true, noEmit: true, skipLibCheck: true, strict: true,
})

let indexed: { cwd: string; uris: string[] } | undefined
let request = 0

/** Configure Monaco's TypeScript worker and load the workspace's TS/JS files so definitions, references, Peek and signature help resolve across files. */
export async function indexTypeScriptProject(monaco: Monaco, sessionId: string, cwd: string): Promise<{ files: number; truncated: boolean }> {
  const ts = monaco.languages.typescript
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setCompilerOptions(COMPILER(monaco))
    defaults.setEagerModelSync(true)
    // Unresolved package imports are expected without node_modules typings; keep only syntax errors.
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
  }
  const id = ++request
  const { files, truncated } = await api<{ files: { path: string; content: string }[]; truncated: boolean }>('project.sources', { sessionId })
  if (id !== request) return { files: 0, truncated }
  disposeTypeScriptProject(monaco)
  const uris: string[] = []
  for (const file of files) {
    const uri = monaco.Uri.parse(projectModelPath(cwd, file.path))
    // Open tabs own their model and draft; never overwrite them with the disk copy.
    if (monaco.editor.getModel(uri) !== null) continue
    monaco.editor.createModel(file.content, undefined, uri)
    uris.push(uri.toString())
  }
  indexed = { cwd, uris }
  return { files: files.length, truncated }
}

/** Drop the index models that no editor or tab is using. */
export function disposeTypeScriptProject(monaco: Monaco): void {
  if (indexed === undefined) return
  for (const uri of indexed.uris) { const model = monaco.editor.getModel(monaco.Uri.parse(uri)); if (model !== null && !model.isAttachedToEditor()) model.dispose() }
  indexed = undefined
}

/** True for models the project index created, which tab cleanup must keep. */
export function isIndexedModel(uri: string): boolean { return indexed?.uris.includes(uri) ?? false }

/** Refresh index models for files changed on disk, unless an editor is showing them. */
export async function refreshIndexedFiles(monaco: Monaco, sessionId: string, cwd: string, paths: string[]): Promise<void> {
  if (indexed === undefined || indexed.cwd !== cwd) return
  for (const path of paths) {
    const uri = monaco.Uri.parse(projectModelPath(cwd, path))
    const model = monaco.editor.getModel(uri)
    if (model === null || model.isAttachedToEditor() || !isIndexedModel(uri.toString())) continue
    const document = await api<{ content: string }>('fs.read', { sessionId, path }).catch(() => undefined)
    if (document === undefined) { model.dispose(); indexed.uris = indexed.uris.filter(value => value !== uri.toString()); continue }
    if (model.getValue() !== document.content) model.setValue(document.content)
  }
}
