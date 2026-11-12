import type { ClientTerminals, TerminalView, TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const STORAGE_PREFIX = 'dvw:native-terminal-tab:v1:'
export interface TerminalEntry { id: string; title: string }
export interface TerminalWorkspaceSnapshot { terminals: readonly TerminalEntry[]; loading: boolean; error?: string }

/** Own workbench membership without overwriting the official sidebar's terminal inventory. */
export class TerminalWorkspaces {
  private readonly workspaces = new Map<string, TerminalWorkspaceController>()
  private saved: Record<string, string[]> = Object.create(null)

  constructor(readonly models: ClientTerminals) {
    try {
      this.saved = this.readSaved()
    } catch { /* Invalid or unavailable storage must not prevent opening the terminal. */ }
    this.retain()
    window.addEventListener('storage', this.onStorage)
  }

  get(sessionId: string): TerminalWorkspaceController {
    let workspace = this.workspaces.get(sessionId)
    if (workspace === undefined) {
      workspace = new TerminalWorkspaceController(this, sessionId, this.saved[sessionId] ?? [])
      this.workspaces.set(sessionId, workspace)
    }
    return workspace
  }

  save(sessionId: string, ids: string[]): void {
    const previous = this.saved[sessionId] ?? []
    try {
      // Independent records preserve concurrent additions from other windows and Sessions.
      for (const id of ids) if (!previous.includes(id)) localStorage.setItem(STORAGE_PREFIX + JSON.stringify([sessionId, id]), 'open')
      for (const id of previous) if (!ids.includes(id)) localStorage.removeItem(STORAGE_PREFIX + JSON.stringify([sessionId, id]))
      this.sync(this.readSaved())
    } catch { this.saved[sessionId] = ids; this.retain() }
  }

  private readSaved(): Record<string, string[]> {
    const saved: Record<string, string[]> = Object.create(null)
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key?.startsWith(STORAGE_PREFIX)) continue
      try {
        const value: unknown = JSON.parse(key.slice(STORAGE_PREFIX.length))
        if (!Array.isArray(value) || value.length !== 2) continue
        const [sessionId, id] = value
        if (typeof sessionId !== 'string' || typeof id !== 'string' || !id.startsWith('dvw-terminal:')) continue
        ;(saved[sessionId] ??= []).push(id)
      } catch { /* Ignore only malformed external layout entries. */ }
    }
    return saved
  }

  private sync(saved: Record<string, string[]>): void {
    this.saved = saved
    for (const [sessionId, workspace] of this.workspaces) workspace.reconcile(saved[sessionId] ?? [])
    this.retain()
  }

  private onStorage = (event: StorageEvent): void => {
    if (event.storageArea !== localStorage || (event.key !== null && !event.key.startsWith(STORAGE_PREFIX))) return
    this.sync(this.readSaved())
  }

  private retain(): void {
    this.models.retainTabs(Object.entries(this.saved).flatMap(([sessionId, ids]) => ids.map(id => ({ sessionId: sessionId as SessionId, tabId: id, contentId: id }))))
  }

  dispose(): void { window.removeEventListener('storage', this.onStorage); for (const workspace of this.workspaces.values()) workspace.dispose(); this.models.retainTabs([]) }
}

/** Layout only; the official model owns processes, stream ordering, recovery and input control. */
export class TerminalWorkspaceController {
  readonly closeFailures: ClientTerminals['closeFailures']
  private snapshot: TerminalWorkspaceSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly views = new Map<string, { model: TerminalView; unsubscribe: () => void }>()

  constructor(private readonly owner: TerminalWorkspaces, readonly sessionId: string, ids: readonly string[]) {
    this.closeFailures = owner.models.closeFailures
    this.snapshot = { terminals: ids.map(id => ({ id, title: '终端' })), loading: false }
  }

  view(id: string): TerminalView {
    const existing = this.views.get(id)
    if (existing !== undefined) return existing.model
    const model = this.owner.models.view(this.sessionId as SessionId, id, id)
    const unsubscribe = model.state.subscribe(() => this.updateTitles())
    this.views.set(id, { model, unsubscribe })
    this.updateTitles()
    return model
  }

  async refresh(): Promise<boolean> {
    this.set({ ...this.snapshot, loading: true, error: undefined })
    try {
      const entries = this.snapshot.terminals
      await Promise.all(entries.map(entry => this.view(entry.id).refresh()))
      // A saved tab can outlive its Host process after a DSH restart. It can never reconnect,
      // so forget it instead of leaving a dead terminal that asks the user to close it manually.
      const missing = new Set(entries.filter(entry => this.view(entry.id).state.getSnapshot().issue === 'missingTerminal').map(entry => entry.id))
      if (missing.size === 0) { this.set({ ...this.snapshot, loading: false }); return true }
      for (const id of missing) { this.views.get(id)?.unsubscribe(); this.views.delete(id) }
      this.set({ ...this.snapshot, terminals: this.snapshot.terminals.filter(entry => !missing.has(entry.id)), loading: false })
      this.save()
      return true
    } catch (error) { this.fail(error); return false }
  }

  async create(): Promise<TerminalEntry> {
    const entry = { id: `dvw-terminal:${crypto.randomUUID()}`, title: '终端' }
    this.set({ terminals: [...this.snapshot.terminals, entry], loading: false })
    this.save()
    const model = this.view(entry.id)
    await model.refresh()
    return this.snapshot.terminals.find(row => row.id === entry.id) ?? entry
  }

  close(id: string): void {
    this.owner.models.close(this.sessionId as SessionId, id, id)
    this.views.get(id)?.unsubscribe()
    this.views.delete(id)
    this.set({ ...this.snapshot, terminals: this.snapshot.terminals.filter(entry => entry.id !== id) })
    this.save()
  }

  async rename(id: string, title: string): Promise<void> {
    try { await this.view(id).rename(title) } catch (error) { this.fail(error) }
  }
  retryClose(id: Parameters<ClientTerminals['retryClose']>[0]): void { this.owner.models.retryClose(id) }

  reconcile(ids: readonly string[]): void {
    const entries = new Map(this.snapshot.terminals.map(entry => [entry.id, entry]))
    for (const [id, view] of this.views) if (!ids.includes(id)) { view.unsubscribe(); this.views.delete(id) }
    this.set({ ...this.snapshot, terminals: ids.map(id => entries.get(id) ?? { id, title: '终端' }) })
  }

  getSnapshot = (): TerminalWorkspaceSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  dispose(): void { for (const view of this.views.values()) view.unsubscribe(); this.views.clear() }
  private save(): void { this.owner.save(this.sessionId, this.snapshot.terminals.map(entry => entry.id)) }
  private updateTitles(): void {
    this.set({ ...this.snapshot, terminals: this.snapshot.terminals.map(entry => ({ ...entry, title: this.views.get(entry.id)?.model.state.getSnapshot().title ?? entry.title })) })
  }
  private fail(error: unknown): void { this.set({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : String(error) }) }
  private set(snapshot: TerminalWorkspaceSnapshot): void { this.snapshot = snapshot; for (const listener of this.listeners) listener() }
}

export function terminalIssue(state: TerminalViewState): string | undefined {
  const messages = { missingTerminal: '此终端已不存在，请关闭后新建终端。', inputFull: '终端输入缓冲已满，请重新连接。', attachmentEnded: '终端连接已结束，请重新连接。', invalidOutput: '终端输出无法解析，请重新连接。', terminalLimit: '终端数量已达上限，请关闭不用的终端。' }
  return state.issue === undefined ? state.error ?? state.info?.error : messages[state.issue]
}
