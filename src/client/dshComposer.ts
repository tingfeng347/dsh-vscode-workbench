/** Selected editor text, with 1-based inclusive line numbers. */
export interface EditorSelection { text: string; startLine: number; endLine: number }

/** Explorer and editor shortcut that adds the current file or selection to the DSH chat. */
export const ADD_TO_DSH_SHORTCUT = 'Ctrl+Alt+K'

/** True for the add-to-DSH chord; Monaco binds it separately, so this covers the Explorer. */
export function isAddToDshShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code' | 'isComposing'>): boolean {
  return !event.isComposing && (event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey && event.code === 'KeyK'
}

/** Workspace-relative reference the agent can read: `path`, `dir/`, or `path:start-end` plus a fenced copy of the selection. */
export function dshReference(path: string, options: { directory?: boolean; selection?: EditorSelection } = {}): string {
  const { directory, selection } = options
  if (selection === undefined || selection.text === '') return `\`${directory ? `${path}/` : path}\``
  const lines = selection.startLine === selection.endLine ? `${selection.startLine}` : `${selection.startLine}-${selection.endLine}`
  const language = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  const fence = selection.text.includes('```') ? '````' : '```'
  return `\`${path}:${lines}\`\n${fence}${language}\n${selection.text.replace(/\n$/, '')}\n${fence}\n`
}

/** Separator that keeps an inserted reference from gluing onto the existing draft. */
export function referenceSeparator(draft: string, reference: string): string {
  if (draft === '' || /\s$/.test(draft)) return ''
  return reference.includes('\n') ? '\n' : ' '
}

// DSH Desktop renders the draft as a Lexical contenteditable (`data-composer-input`); older web builds use a textarea.
const COMPOSER = '[data-composer-input],textarea'

/** The DSH composer input, preferring the copy shown in the workbench's right column. */
export function findDshComposer(documentRoot: Document = document): HTMLElement | null {
  return documentRoot.querySelector<HTMLElement>(`[data-dvw-conversation-panel] [data-composer-card] :is(${COMPOSER})`)
    ?? documentRoot.querySelector<HTMLElement>(`[data-composer-card] :is(${COMPOSER})`)
}

function composerEditable(input: HTMLElement): boolean {
  if (input instanceof HTMLTextAreaElement) return !input.disabled && !input.readOnly
  return input.isContentEditable || input.getAttribute('contenteditable') === 'true'
}

function composerText(input: HTMLElement): string { return input instanceof HTMLTextAreaElement ? input.value : (input.textContent ?? '') }

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

/** Append `reference` to the DSH draft through native editing so DSH's input machine and undo stack see it. */
export async function insertIntoDshComposer(reference: string, documentRoot: Document = document): Promise<boolean> {
  const input = findDshComposer(documentRoot)
  if (input === null || !composerEditable(input)) return false
  const text = referenceSeparator(composerText(input), reference) + (reference.endsWith('\n') ? reference : `${reference} `)
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
  const selection = documentRoot.getSelection()
  const range = documentRoot.createRange(); range.selectNodeContents(input); range.collapse(false)
  selection?.removeAllRanges(); selection?.addRange(range)
  // Lexical adopts the DOM caret on selectionchange; paste only after it has.
  await nextFrame()
  // Lexical's paste handler keeps line breaks and records one undo step; insertText is the fallback.
  if (typeof DataTransfer === 'function' && typeof ClipboardEvent === 'function') {
    const data = new DataTransfer(); data.setData('text/plain', text)
    const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    if (!input.dispatchEvent(paste)) return true
  }
  return typeof documentRoot.execCommand === 'function' && documentRoot.execCommand('insertText', false, text)
}
