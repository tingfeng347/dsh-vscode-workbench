import type { editor, Position } from 'monaco-editor'
import type { CommitModelSelection } from '../../shared/commit-message.ts'
import { INLINE_PREFIX_LIMIT, INLINE_SUFFIX_LIMIT, INLINE_TIMEOUT_MS, isInlineCompletionPath, type InlineCompletionMode } from '../../shared/inline-completion.ts'
import { ApiError, api, waitForDelay } from '../transport/api.ts'
import { workspacePathFromModel } from './typescriptProject.ts'

export interface InlineCompletionSettings {
  mode: Exclude<InlineCompletionMode, 'off'>
  sessionId: string
  cwd: string
  model?: CommitModelSelection
}

const DEBOUNCE_MS = 250 // Monaco 0.52 already debounces automatic requests by 50 ms.
const TRIGGER = 'editor.action.inlineSuggest.trigger'
const HIDE = 'editor.action.inlineSuggest.hide'

function contextAt(model: editor.ITextModel, position: Position) {
  const offset = model.getOffsetAt(position)
  const start = model.getPositionAt(Math.max(0, offset - INLINE_PREFIX_LIMIT))
  const end = model.getPositionAt(Math.min(model.getValueLength(), offset + INLINE_SUFFIX_LIMIT))
  const read = (from: Position, to: Position) => model.getValueInRange({
    startLineNumber: from.lineNumber, startColumn: from.column,
    endLineNumber: to.lineNumber, endColumn: to.column,
  })
  return { prefix: read(start, position).slice(-INLINE_PREFIX_LIMIT), suffix: read(position, end).slice(0, INLINE_SUFFIX_LIMIT) }
}

export function registerInlineCompletion(
  monaco: typeof import('monaco-editor'),
  instance: editor.IStandaloneCodeEditor,
  settings: InlineCompletionSettings,
  onError?: (message: string) => void,
) {
  let pending: AbortController | undefined
  let composing = false
  const cancel = () => pending?.abort()
  const snippetActive = () => instance.getContribution<editor.IEditorContribution & { isInSnippet(): boolean }>('snippetController2')?.isInSnippet() === true
  const visible = () => document.visibilityState !== 'hidden' && instance.hasTextFocus()
  const hide = () => {
    cancel()
    instance.trigger('dvw.inlineCompletion', HIDE, null)
  }
  const provider = monaco.languages.registerInlineCompletionsProvider({ scheme: 'file' }, {
    async provideInlineCompletions(model, position, context, token) {
      const manual = context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit
      if ((!manual && settings.mode !== 'auto') || !visible() || composing || instance.getModel() !== model ||
          context.selectedSuggestionInfo !== undefined || token.isCancellationRequested || snippetActive()) return
      const selections = instance.getSelections()
      if (selections?.length !== 1 || !selections[0]?.isEmpty()) return
      const path = workspacePathFromModel(settings.cwd, model.uri.toString())
      if (path === undefined || !isInlineCompletionPath(path)) return
      const version = model.getVersionId()
      const current = () => {
        const cursor = instance.getPosition()
        return visible() && !composing && !model.isDisposed() && instance.getModel() === model &&
          model.getVersionId() === version && cursor?.lineNumber === position.lineNumber && cursor.column === position.column
      }
      cancel()
      const controller = pending = new AbortController()
      const subscription = token.onCancellationRequested(() => controller.abort())
      let timeout: AbortSignal | undefined
      try {
        if (!manual) await waitForDelay(DEBOUNCE_MS, controller.signal)
        if (controller.signal.aborted || !current() || snippetActive()) return
        const { prefix, suffix } = contextAt(model, position)
        if (!manual && prefix.trim() === '' && suffix.trim() === '') return
        timeout = AbortSignal.timeout(INLINE_TIMEOUT_MS)
        const signal = AbortSignal.any([controller.signal, timeout])
        const { text } = await api<{ text: string }>('editor.inlineCompletion', {
          sessionId: settings.sessionId, path, language: model.getLanguageId(), prefix, suffix, ...settings.model,
        }, signal, { retry: false })
        if (signal.aborted || !current() || snippetActive() || typeof text !== 'string' || text === '') return
        return { items: [{ range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), insertText: text }] }
      } catch (error) {
        if (!manual || controller.signal.aborted || !current()) return
        const message = timeout?.aborted ? 'AI 代码补全超时。'
          : error instanceof ApiError && error.code !== 'network' ? error.message : '无法请求 AI 代码补全。'
        onError?.(message)
      } finally {
        subscription.dispose()
        if (pending === controller) pending = undefined
      }
    },
    freeInlineCompletions() {},
  })
  const action = instance.addAction({
    id: 'dvw.inlineCompletion.trigger',
    label: '触发 AI 代码补全',
    precondition: '!editorReadonly && !inSnippetMode && !suggestWidgetVisible',
    keybindingContext: 'editorTextFocus',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Backslash],
    contextMenuGroupId: '1_modification',
    run: () => { instance.focus(); instance.trigger('dvw.inlineCompletion', TRIGGER, null) },
  })
  const subscriptions = [
    instance.onDidChangeModel(cancel),
    instance.onDidChangeModelContent(cancel),
    instance.onDidChangeCursorSelection(cancel),
    instance.onDidBlurEditorWidget(cancel),
    instance.onDidCompositionStart(() => { composing = true; hide() }),
    instance.onDidCompositionEnd(() => { composing = false }),
    instance.onKeyDown(event => { if (event.keyCode === monaco.KeyCode.Escape) cancel() }),
  ]
  const onVisibilityChange = () => { if (document.visibilityState === 'hidden') hide() }
  document.addEventListener('visibilitychange', onVisibilityChange)
  instance.updateOptions({ inlineSuggest: { enabled: true, suppressSuggestions: false, keepOnBlur: false } })
  return {
    dispose() {
      hide()
      instance.updateOptions({ inlineSuggest: { enabled: false } })
      document.removeEventListener('visibilitychange', onVisibilityChange)
      subscriptions.forEach(subscription => subscription.dispose())
      action.dispose()
      provider.dispose()
    },
  }
}
