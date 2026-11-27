import { editorLanguageForPath } from './lspLanguage.ts'
import type { editor, Uri } from 'monaco-editor'
import type { FileDocument } from '../../shared/types.ts'
import { api } from '../transport/api.ts'
import { workspacePathFromModel } from '../editor/typescriptProject.ts'

type Monaco = typeof import('monaco-editor')

const previewModels = new WeakSet<editor.ITextModel>()
export const isLspPreviewModel = (model: editor.ITextModel): boolean => previewModels.has(model)

export class LspWorkspaceDocuments {
  private readonly previews = new Map<string, { model: editor.ITextModel; timer: ReturnType<typeof setTimeout> }>()
  private readonly retained = new Map<string, number>()
  private readonly reads = new Map<string, Promise<editor.ITextModel | undefined>>()
  private readonly documents = new WeakMap<editor.ITextModel, FileDocument>()
  private readonly listeners = new Map<editor.ITextModel, { dispose(): void }>()
  private disposed = false

  constructor(
    private readonly monaco: Monaco,
    private readonly cwd: string,
    private readonly session: () => string | undefined,
    private readonly draft: (path: string) => (FileDocument & { draft: string }) | undefined,
    private readonly change: (document: FileDocument, value: string) => void,
    private readonly isOpen: (uri: string) => boolean,
  ) {}

  private async read(path: string): Promise<FileDocument | undefined> {
    const sessionId = this.session()
    if (sessionId === undefined) return undefined
    const doc = await api<FileDocument>('fs.read', { sessionId, path })
    return doc.binary || doc.tooLarge ? undefined : doc
  }

  async load(uri: Uri, readExternal: () => Promise<string>): Promise<editor.ITextModel | undefined> {
    if (this.disposed) return undefined
    const existing = this.monaco.editor.getModel(uri)
    if (existing !== null) return existing
    const key = uri.toString()
    const pending = this.reads.get(key)
    if (pending !== undefined) return pending
    const read = this.readModel(uri, readExternal)
    this.reads.set(key, read)
    try { return await read } finally { this.reads.delete(key) }
  }

  private async readModel(uri: Uri, readExternal: () => Promise<string>): Promise<editor.ITextModel | undefined> {
    const path = workspacePathFromModel(this.cwd, uri.toString())
    const draft = path === undefined ? undefined : this.draft(path)
    const doc = path === undefined ? undefined : draft ?? await this.read(path)
    const value = path === undefined ? await readExternal() : draft?.draft ?? doc?.content
    if (this.disposed || value === undefined) return undefined
    const existing = this.monaco.editor.getModel(uri)
    if (existing !== null) return existing
    const model = this.monaco.editor.createModel(value, editorLanguageForPath(uri.path), uri)
    if (doc !== undefined) this.documents.set(model, doc)
    const key = uri.toString()
    previewModels.add(model)
    this.previews.set(key, { model, timer: setTimeout(() => this.release(key), 60_000) })
    if (this.previews.size > 48) {
      const oldest = [...this.previews.keys()].find(uri => !this.retained.has(uri) && uri !== key)
      if (oldest !== undefined) this.release(oldest)
    }
    return model
  }

  private release(uri: string): void {
    const preview = this.previews.get(uri)
    if (preview === undefined) return
    clearTimeout(preview.timer)
    if (this.retained.has(uri)) {
      preview.timer = setTimeout(() => this.release(uri), 60_000)
      return
    }
    this.previews.delete(uri)
    previewModels.delete(preview.model)
    if (!preview.model.isDisposed() && !preview.model.isAttachedToEditor() && !this.isOpen(uri) && !this.listeners.has(preview.model)) preview.model.dispose()
  }

  retainEditModels(uris: Uri[]): { dispose(): void } {
    const keys = new Set(uris.map(uri => uri.toString()))
    for (const key of keys) this.retained.set(key, (this.retained.get(key) ?? 0) + 1)
    return { dispose: () => {
      for (const key of keys) {
        const count = this.retained.get(key)
        if (count === undefined) continue
        if (count === 1) this.retained.delete(key)
        else this.retained.set(key, count - 1)
      }
    } }
  }

  async trackEdits(files: { uri: Uri; model: editor.ITextModel }[]): Promise<void> {
    const documents = await Promise.all(files.map(async ({ uri, model }) => {
      const path = workspacePathFromModel(this.cwd, uri.toString())
      if (path === undefined) throw new Error('无法修改工作区以外的文件')
      const draft = this.draft(path)
      const doc = draft ?? await this.read(path)
      if (doc === undefined || (draft?.draft ?? doc.content) !== model.getValue() || model.isDisposed()) {
        throw new Error(`文件 ${path} 已经变化，请重新执行操作`)
      }
      return { doc, model }
    }))
    if (this.disposed) throw new Error('工作区已经关闭')
    for (const { doc, model } of documents) {
      this.documents.set(model, doc)
      if (this.listeners.has(model)) continue
      const content = model.onDidChangeContent(() => this.change(this.documents.get(model)!, model.getValue()))
      const disposing = model.onWillDispose(() => {
        content.dispose()
        disposing.dispose()
        this.listeners.delete(model)
      })
      this.listeners.set(model, { dispose: () => { content.dispose(); disposing.dispose() } })
    }
  }

  dispose(): void {
    this.disposed = true
    for (const disposable of this.listeners.values()) disposable.dispose()
    this.listeners.clear()
    this.retained.clear()
    for (const key of this.previews.keys()) this.release(key)
  }
}
