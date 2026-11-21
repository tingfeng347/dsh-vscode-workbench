import type { editor, IMarkdownString, IRange, languages, Position } from 'monaco-editor'

type Monaco = typeof import('monaco-editor')
export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface LspTextEdit { range: LspRange; newText: string }
interface InsertReplaceRange { insert: LspRange; replace: LspRange }
export interface LspCompletion {
  label: string
  labelDetails?: { detail?: string; description?: string }
  kind?: number
  detail?: string
  documentation?: unknown
  insertText?: string
  textEdit?: LspTextEdit | (InsertReplaceRange & { newText: string })
  textEditText?: string
  insertTextFormat?: number
  insertTextMode?: number
  additionalTextEdits?: LspTextEdit[]
  sortText?: string
  filterText?: string
  preselect?: boolean
  commitCharacters?: string[]
  deprecated?: boolean
  tags?: number[]
  data?: unknown
  command?: LspCommand
}
export interface CompletionDefaults {
  editRange?: LspRange | InsertReplaceRange
  insertTextFormat?: number
  insertTextMode?: number
  commitCharacters?: string[]
  data?: unknown
}
export interface LspDiagnostic {
  range: LspRange
  severity?: number
  message: string
  source?: string
  code?: string | number
  codeDescription?: { href: string }
  tags?: number[]
  relatedInformation?: { location: { uri: string; range: LspRange }; message: string }[]
}
export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: Array<{ textDocument: { uri: string; version: number | null }; edits: LspTextEdit[] } | { kind: string }>
}
export interface LspCommand { title: string; command: string; arguments?: unknown[] }
export interface LspInlayHint {
  label: string | { value: string; tooltip?: unknown; command?: LspCommand; location?: { uri: string; range: LspRange } }[]
  position: LspPosition
  kind?: 1 | 2
  tooltip?: unknown
  textEdits?: LspTextEdit[]
  paddingLeft?: boolean
  paddingRight?: boolean
}
export interface LspCodeAction {
  title: string
  kind?: string
  edit?: LspWorkspaceEdit
  command?: LspCommand
  isPreferred?: boolean
  disabled?: { reason: string }
}
export interface ServerCapabilities {
  textDocumentSync?: number | { openClose?: boolean; change?: number; save?: boolean | { includeText?: boolean } }
  completionProvider?: { triggerCharacters?: string[]; resolveProvider?: boolean }
  signatureHelpProvider?: { triggerCharacters?: string[]; retriggerCharacters?: string[] }
  hoverProvider?: boolean | object
  definitionProvider?: boolean | object
  declarationProvider?: boolean | object
  implementationProvider?: boolean | object
  typeDefinitionProvider?: boolean | object
  referencesProvider?: boolean | object
  renameProvider?: boolean | { prepareProvider?: boolean }
  codeActionProvider?: boolean | { codeActionKinds?: string[]; resolveProvider?: boolean }
  documentFormattingProvider?: boolean | object
  documentRangeFormattingProvider?: boolean | object
  documentSymbolProvider?: boolean | object
  inlayHintProvider?: boolean | { resolveProvider?: boolean }
  semanticTokensProvider?: { legend: languages.SemanticTokensLegend; full?: boolean | object; range?: boolean | object }
  executeCommandProvider?: { commands: string[] }
}

export const toLspPosition = (value: Pick<Position, 'lineNumber' | 'column'>): LspPosition =>
  ({ line: value.lineNumber - 1, character: value.column - 1 })

export function toLspRange(value: IRange): LspRange {
  return {
    start: { line: value.startLineNumber - 1, character: value.startColumn - 1 },
    end: { line: value.endLineNumber - 1, character: value.endColumn - 1 },
  }
}

export function editorRange(monaco: Monaco, value: LspRange) {
  return new monaco.Range(value.start.line + 1, value.start.character + 1, value.end.line + 1, value.end.character + 1)
}

export function markup(value: unknown): IMarkdownString | undefined {
  if (typeof value === 'string') return { value }
  if (value === null || typeof value !== 'object') return undefined
  const item = value as { value?: unknown; language?: string; kind?: string }
  if (typeof item.value !== 'string') return undefined
  if (item.language !== undefined) {
    const fence = '`'.repeat(Math.max(3, ...Array.from(item.value.matchAll(/`+/g), match => match[0].length + 1)))
    return { value: fence + item.language + '\n' + item.value + '\n' + fence }
  }
  return { value: item.kind === 'plaintext' ? item.value.replace(/[\\`*_{}\[\]<>()#+.!|~-]/g, '\\$&') : item.value }
}

export function completionItem(monaco: Monaco, entry: LspCompletion, fallback: languages.CompletionItem['range'], defaults?: CompletionDefaults): languages.CompletionItem {
  const kind = monaco.languages.CompletionItemKind
  const kinds = [kind.Text, kind.Method, kind.Function, kind.Constructor, kind.Field, kind.Variable,
    kind.Class, kind.Interface, kind.Module, kind.Property, kind.Unit, kind.Value, kind.Enum,
    kind.Keyword, kind.Snippet, kind.Color, kind.File, kind.Reference, kind.Folder, kind.EnumMember,
    kind.Constant, kind.Struct, kind.Event, kind.Operator, kind.TypeParameter]
  const edit = entry.textEdit
  const editRange = edit === undefined ? defaults?.editRange : 'range' in edit ? edit.range : edit
  const rules = monaco.languages.CompletionItemInsertTextRule
  const insertTextRules = ((entry.insertTextFormat ?? defaults?.insertTextFormat) === 2 ? rules.InsertAsSnippet : 0)
    | ((entry.insertTextMode ?? defaults?.insertTextMode) === 1 ? rules.KeepWhitespace : 0)
  return {
    label: entry.labelDetails === undefined ? entry.label : { label: entry.label, ...entry.labelDetails },
    kind: kinds[(entry.kind ?? 1) - 1] ?? kind.Text,
    detail: entry.detail,
    documentation: markup(entry.documentation),
    insertText: edit?.newText ?? entry.textEditText ?? entry.insertText ?? entry.label,
    insertTextRules,
    range: editRange === undefined ? fallback : 'insert' in editRange
      ? { insert: editorRange(monaco, editRange.insert), replace: editorRange(monaco, editRange.replace) } : editorRange(monaco, editRange),
    additionalTextEdits: entry.additionalTextEdits?.map(edit => ({ range: editorRange(monaco, edit.range), text: edit.newText })),
    sortText: entry.sortText,
    filterText: entry.filterText,
    preselect: entry.preselect,
    commitCharacters: entry.commitCharacters ?? defaults?.commitCharacters,
    tags: entry.deprecated || entry.tags?.includes(1) ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
  }
}

export function diagnosticMarkers(monaco: Monaco, diagnostics: LspDiagnostic[]): editor.IMarkerData[] {
  return diagnostics.map(diagnostic => ({
    ...editorRange(monaco, diagnostic.range),
    message: diagnostic.message,
    severity: ([monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint])[Math.max(0, (diagnostic.severity ?? 1) - 1)] ?? monaco.MarkerSeverity.Error,
    source: diagnostic.source,
    code: diagnostic.code === undefined ? undefined : diagnostic.codeDescription === undefined
      ? String(diagnostic.code)
      : { value: String(diagnostic.code), target: monaco.Uri.parse(diagnostic.codeDescription.href) },
    tags: diagnostic.tags?.filter(tag => tag === 1 || tag === 2),
    relatedInformation: diagnostic.relatedInformation?.map(info => ({
      ...editorRange(monaco, info.location.range), resource: monaco.Uri.parse(info.location.uri), message: info.message,
    })),
  }))
}

export function documentChanges(model: editor.ITextModel, event: editor.IModelContentChangedEvent, kind: number) {
  if (kind === 1 || event.isFlush) return [{ text: model.getValue() }]
  // Monaco ranges all refer to the previous version. Apply from the end so offsets stay valid.
  return [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)
    .map(change => ({ range: toLspRange(change.range), text: change.text }))
}
