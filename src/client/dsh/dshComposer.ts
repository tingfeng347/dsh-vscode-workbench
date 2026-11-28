/** Selected editor text, with 1-based inclusive line numbers. */
export interface EditorSelection { text: string; startLine: number; endLine: number }
/** A 1-based inclusive line range without embedding the source text. */
export interface DshLineRange { startLine: number; endLine: number }
export interface DshReferenceOptions { directory?: boolean; selection?: EditorSelection; lines?: DshLineRange }
/** One atomic DSH composer reference; `fallback` keeps older textarea builds usable. */
export interface DshReferenceInsert {
  source: 'reference'
  ref: string
  label: string
  appearance: 'file' | 'folder'
  clipboardText: string
  fallback: string
}

/** Explorer and editor shortcut that adds the current file or selection to the DSH chat. */
export const ADD_TO_DSH_SHORTCUT = 'Ctrl+Alt+K'

/** True for the add-to-DSH chord; Monaco binds it separately, so this covers the Explorer. */
export function isAddToDshShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code' | 'isComposing'>): boolean {
  return !event.isComposing && (event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey && event.code === 'KeyK'
}

function referenceLines(options: DshReferenceOptions): DshLineRange | undefined {
  const value = options.selection ?? options.lines
  if (value === undefined || !Number.isSafeInteger(value.startLine) || !Number.isSafeInteger(value.endLine)) return undefined
  if (value.startLine < 1 || value.endLine < value.startLine) return undefined
  return value
}

function lineRangeText(range: DshLineRange): string {
  return range.startLine === range.endLine ? `${range.startLine}` : `${range.startLine}-${range.endLine}`
}

/** Workspace-relative reference the agent can read: `path`, `dir/`, or `path:start-end` plus a fenced copy of a selection. */
export function dshReference(path: string, options: DshReferenceOptions = {}): string {
  const { directory, selection } = options
  const range = referenceLines(options)
  if (directory) return `\`${path}/\``
  if (range === undefined) return `\`${path}\``
  const lines = lineRangeText(range)
  if (selection === undefined || selection.text === '') return `\`${path}:${lines}\``
  const language = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  const fence = selection.text.includes('```') ? '````' : '```'
  return `\`${path}:${lines}\`\n${fence}${language}\n${selection.text.replace(/\n$/, '')}\n${fence}\n`
}

/** Atomic file/folder reference rendered as a DSH composer chip. */
export function dshReferenceInsert(path: string, options: DshReferenceOptions = {}): DshReferenceInsert {
  const fallback = dshReference(path, options)
  const name = path.replace(/\\/g, '/').split('/').at(-1) ?? path
  const lines = referenceLines(options)
  const range = lines === undefined ? undefined : lineRangeText(lines)
  const target = options.directory
    ? `${path}/`
    : range === undefined ? path : `${path}:${range}`
  const mention = /[\s"]/u.test(target) ? `@"${target}"` : `@${target}`
  return {
    source: 'reference',
    ref: mention,
    label: options.directory ? `${name}/` : range === undefined ? name : `${name}:${range}`,
    appearance: options.directory ? 'folder' : 'file',
    clipboardText: mention,
    fallback,
  }
}

/** Separator that keeps an inserted reference from gluing onto the existing draft. */
export function referenceSeparator(draft: string, reference: string): string {
  if (draft === '' || /\s$/.test(draft)) return ''
  return reference.includes('\n') ? '\n' : ' '
}

// DSH Desktop renders the draft as a Lexical contenteditable (`data-composer-input`); older web builds use a textarea.
const COMPOSER = '[data-composer-input],textarea'

/** The DSH composer input, preferring the copy shown in the workbench's right column. */
export function findDshComposer(root: Document | HTMLElement = document): HTMLElement | null {
  const selector = `[data-composer-card] :is(${COMPOSER})`
  return root.querySelector<HTMLElement>(`[data-dvw-conversation-panel] ${selector}`)
    ?? root.querySelector<HTMLElement>(`[data-dvw-native-conversation="visible"] ${selector}`)
    ?? Array.from(root.querySelectorAll<HTMLElement>(selector)).find(input =>
      input.closest('[hidden], [inert], [data-dvw-native-conversation="hidden"]') === null) ?? null
}

function composerEditable(input: HTMLElement): boolean {
  if (input instanceof HTMLTextAreaElement) return !input.disabled && !input.readOnly
  return input.isContentEditable || input.getAttribute('contenteditable') === 'true'
}

function composerText(input: HTMLElement): string { return input instanceof HTMLTextAreaElement ? input.value : (input.textContent ?? '') }

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

type SerializedNode = Record<string, unknown> & { type?: string; text?: string; children?: SerializedNode[] }
type LexicalComposerElement = HTMLElement & {
  __lexicalEditor?: {
    getEditorState(): { toJSON(): { root?: SerializedNode } }
    parseEditorState(value: string): unknown
    setEditorState(state: unknown): void
    getRootElement(): HTMLElement | null
    focus(callback?: () => void): void
  }
}

function serializedHasContent(node: SerializedNode): boolean {
  if (node.type === 'reference-chip') return true
  if (typeof node.text === 'string' && node.text.trim() !== '') return true
  return node.children?.some(serializedHasContent) ?? false
}

function textNode(text: string): SerializedNode {
  return { detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 }
}

/** Insert one real Lexical reference-chip node without replacing the user's existing draft. */
function insertLexicalReference(input: LexicalComposerElement, reference: DshReferenceInsert): boolean {
  const editor = input.__lexicalEditor
  if (editor === undefined) return false
  const state = editor.getEditorState().toJSON()
  const root = state.root
  if (root?.children === undefined) return false
  let paragraph = [...root.children].reverse().find(node => node.type === 'paragraph')
  if (paragraph === undefined) {
    paragraph = { children: [], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 }
    root.children.push(paragraph)
  }
  // Lexical can leave invisible whitespace or empty paragraphs after the draft
  // is cleared. Reuse the editor state for an empty draft so the first chip
  // starts at the native content edge.
  if (!root.children.some(serializedHasContent)) {
    root.children = [paragraph]
    paragraph.children = []
  }
  paragraph.children ??= []
  const children = paragraph.children
  const tail = [...children].reverse().find(node => node.type === 'text')?.text ?? ''
  if (tail !== '' && !/\s$/u.test(tail)) children.push(textNode(' '))
  children.push({
    appearance: reference.appearance,
    clipboardText: reference.clipboardText,
    invalid: false,
    label: reference.label,
    ref: reference.ref,
    source: reference.source,
    type: 'reference-chip',
    version: 1,
  }, textNode(' '))
  editor.setEditorState(editor.parseEditorState(JSON.stringify(state)))
  editor.focus(() => {
    const selection = input.ownerDocument.getSelection()
    if (selection === null) return
    const range = input.ownerDocument.createRange()
    range.selectNodeContents(input)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  })
  return true
}

/** Append plain text or one native DSH file chip so the official input machine owns the edit. */
export async function insertIntoDshComposer(reference: string | DshReferenceInsert, root: Document | HTMLElement = document): Promise<boolean> {
  const input = findDshComposer(root)
  if (input === null || !composerEditable(input)) return false
  const documentRoot = input.ownerDocument
  const fallback = typeof reference === 'string' ? reference : reference.fallback
  const text = referenceSeparator(composerText(input), fallback) + (fallback.endsWith('\n') ? fallback : `${fallback} `)
  input.focus()
  if (input instanceof HTMLTextAreaElement) {
    input.setSelectionRange(input.value.length, input.value.length)
    if (typeof documentRoot.execCommand === 'function' && documentRoot.execCommand('insertText', false, text)) return true
    // execCommand is unavailable: set the value through the native setter so React's onChange still fires.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(input, input.value + text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  if (typeof reference !== 'string' && insertLexicalReference(input as LexicalComposerElement, reference)) return true
  const selection = documentRoot.getSelection()
  const range = documentRoot.createRange(); range.selectNodeContents(input); range.collapse(false)
  selection?.removeAllRanges(); selection?.addRange(range)
  // Lexical adopts the DOM caret on selectionchange; paste only after it has.
  await nextFrame()
  if (!input.isConnected || documentRoot.activeElement !== input) return false
  // Lexical's paste handler keeps line breaks and records one undo step; insertText is the fallback.
  if (typeof DataTransfer === 'function' && typeof ClipboardEvent === 'function') {
    const data = new DataTransfer(); data.setData('text/plain', text)
    const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    if (!input.dispatchEvent(paste)) return true
  }
  return typeof documentRoot.execCommand === 'function' && documentRoot.execCommand('insertText', false, text)
}
