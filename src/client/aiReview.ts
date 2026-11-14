import type { FileDocument } from '../types.ts'
import { api } from './api.ts'

export interface ReviewChange {
  id: string
  seq: number
  turn?: number
  path: string
  before: string | null
  after: string
  created: boolean
}

export interface ReviewFeed {
  cursor: number
  changes: ReviewChange[]
  busy: boolean
}

export interface ReviewInspection {
  path: string
  revision: string
  content: string
  changes: Array<{ id: string; conflict?: string }>
}

export interface ReviewRejection {
  path: string
  deleted: boolean
  rejectedIds: string[]
  document?: FileDocument
}

export interface ReviewHunkLocation {
  startLine: number
  endLine: number
}

export interface AiReviewSnapshot {
  changes: ReviewChange[]
  conflicts: Readonly<Record<string, string>>
  busy: boolean
  loading: boolean
  working: boolean
  error?: string
}

interface ReviewStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): unknown
}

export interface AiReviewOptions {
  sessionId: string
  mode?: ReviewMode
  storage?: ReviewStorage
  request?: typeof api
}

export type ReviewMode = 'all' | 'latest' | 'none'

const EMPTY_SNAPSHOT: AiReviewSnapshot = {
  changes: [],
  conflicts: {},
  busy: false,
  loading: false,
  working: false,
}

export const AI_REVIEW_STORAGE_PREFIX = 'dvw:review:'

export function reviewStorageKey(sessionId: string): string {
  return `${AI_REVIEW_STORAGE_PREFIX}${sessionId}`
}

/** Pick a newly arrived block, or the latest pending block when follow is enabled after it arrived. */
export function latestReviewFollowChange(
  changes: readonly ReviewChange[],
  seen: ReadonlySet<string>,
): ReviewChange | undefined {
  return changes.filter(change => !seen.has(change.id)).at(-1) ?? changes.at(-1)
}

function defaultStorage(): ReviewStorage | undefined {
  try { return globalThis.localStorage } catch { return undefined }
}

function storedReviewState(sessionId: string, storage: ReviewStorage | undefined): { from?: number; done: Set<string> } {
  try {
    const value = JSON.parse(storage?.getItem(reviewStorageKey(sessionId)) ?? 'null') as { from?: unknown; done?: unknown } | null
    const from = typeof value?.from === 'number' && Number.isSafeInteger(value.from) && value.from >= 0 ? value.from : undefined
    const done = new Set(Array.isArray(value?.done) ? value.done.filter((id): id is string => typeof id === 'string') : [])
    return { ...(from === undefined ? {} : { from }), done }
  } catch {
    return { done: new Set() }
  }
}

/** Find the only whole-line occurrence of a replacement in the current file. */
export function locateReviewChange(content: string, change: Pick<ReviewChange, 'before' | 'after'>): ReviewHunkLocation | undefined {
  if (change.after === '' || content.includes('\r') || change.after.includes('\r')) return undefined
  const positions: number[] = []
  let start = 0
  while (start <= content.length) {
    const at = content.indexOf(change.after, start)
    if (at < 0) break
    const end = at + change.after.length
    if ((at === 0 || content[at - 1] === '\n') && (end === content.length || content[end] === '\n')) positions.push(at)
    start = at + 1
  }
  if (positions.length !== 1) return undefined
  const at = positions[0]!
  const startLine = content.slice(0, at).split('\n').length
  const endLine = startLine + change.after.split('\n').length - 1
  return { startLine, endLine }
}

/** Keep polling and durable keep decisions outside the workbench render tree. */
export class AiReviewController {
  private readonly sessionId: string
  private readonly storage: ReviewStorage | undefined
  private readonly mode: ReviewMode
  private readonly request: typeof api
  private readonly listeners = new Set<() => void>()
  private snapshot: AiReviewSnapshot = EMPTY_SNAPSHOT
  private done = new Set<string>()
  private base: number | undefined
  private cursor: number | undefined
  private started = false
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private abort: AbortController | undefined
  private inspecting = new Map<string, Promise<ReviewInspection>>()

  constructor(options: AiReviewOptions) {
    this.sessionId = options.sessionId
    this.mode = options.mode ?? 'all'
    this.storage = options.storage ?? defaultStorage()
    this.request = options.request ?? api
  }

  getSnapshot = (): AiReviewSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.generation++
    const saved = storedReviewState(this.sessionId, this.storage)
    this.base = saved.from
    this.done = saved.done
    this.cursor = saved.from
    this.update({ loading: true, error: undefined, changes: this.snapshot.changes.filter(change => !this.done.has(change.id)) })
    void this.poll()
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.generation++
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.abort?.abort()
    this.abort = undefined
    this.update({ loading: false, working: false })
  }

  dispose(): void {
    this.stop()
    this.listeners.clear()
  }

  async keep(ids: readonly string[]): Promise<void> {
    const accepted = [...new Set(ids)].filter(id => this.snapshot.changes.some(change => change.id === id))
    if (accepted.length === 0) return
    for (const id of accepted) this.done.add(id)
    this.persist()
    const acceptedSet = new Set(accepted)
    const conflicts = Object.fromEntries(Object.entries(this.snapshot.conflicts).filter(([id]) => !acceptedSet.has(id)))
    this.update({ changes: this.snapshot.changes.filter(change => !acceptedSet.has(change.id)), conflicts })
  }

  async inspect(path: string, ids?: readonly string[]): Promise<ReviewInspection> {
    const pending = ids ?? this.snapshot.changes.filter(change => change.path === path).map(change => change.id)
    const unique = [...new Set(pending)]
    if (unique.length === 0) throw new Error('没有待审阅的改动')
    const key = `${path}\0${unique.join(',')}`
    const existing = this.inspecting.get(key)
    if (existing !== undefined) return existing
    const operation = this.request<ReviewInspection>('review.inspect', { sessionId: this.sessionId, path, ids: unique })
    this.inspecting.set(key, operation)
    try {
      const result = await operation
      const current = new Set(this.snapshot.changes.map(change => change.id))
      const conflicts = { ...this.snapshot.conflicts }
      for (const id of unique) delete conflicts[id]
      for (const change of result.changes) {
        if (current.has(change.id) && change.conflict !== undefined && change.conflict !== '') conflicts[change.id] = change.conflict
      }
      this.update({ conflicts })
      return result
    } finally {
      this.inspecting.delete(key)
    }
  }

  async reject(path: string, ids?: readonly string[]): Promise<ReviewRejection> {
    const pending = ids?.length
      ? [...new Set(ids)]
      : this.snapshot.changes.filter(change => change.path === path).map(change => change.id)
    if (pending.length === 0) throw new Error('没有可撤销的改动')
    if (this.snapshot.busy) throw new Error('AI 正在运行，结束后可撤销')
    if (pending.some(id => this.snapshot.changes.find(change => change.id === id)?.path !== path)) throw new Error('一次只能撤销同一文件的改动')
    this.update({ working: true, error: undefined })
    try {
      const inspected = await this.inspect(path, pending)
      const conflicted = inspected.changes.find(change => pending.includes(change.id) && change.conflict !== undefined)
      if (conflicted?.conflict !== undefined) throw new Error(conflicted.conflict)
      const result = await this.request<ReviewRejection>('review.reject', {
        sessionId: this.sessionId,
        path,
        ids: pending,
        revision: inspected.revision,
      })
      await this.keep(result.rejectedIds)
      return result
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      this.update({ working: false })
    }
  }

  private async poll(): Promise<void> {
    if (!this.started) return
    const generation = this.generation
    const controller = new AbortController()
    this.abort = controller
    try {
      const body: Record<string, unknown> = { sessionId: this.sessionId }
      const from = this.base === undefined ? undefined : this.cursor ?? this.base
      if (from !== undefined) body.from = from
      const result = await this.request<ReviewFeed>('review.feed', body, controller.signal)
      if (!this.started || controller.signal.aborted || generation !== this.generation) return
      if (this.base === undefined) {
        this.base = result.cursor
        this.cursor = result.cursor
        this.persist()
      } else {
        this.cursor = result.cursor
      }
      const known = new Set(this.snapshot.changes.map(change => change.id))
      const incoming = result.changes.filter(change => !known.has(change.id) && !this.done.has(change.id))
      let changes = incoming.length === 0 ? this.snapshot.changes : [...this.snapshot.changes, ...incoming]
      if (this.mode === 'latest' && incoming.length > 0) {
        const latestTurn = Math.max(...incoming.map(change => change.turn ?? 0))
        const older = changes.filter(change => (change.turn ?? 0) < latestTurn)
        if (older.length > 0) {
          for (const change of older) this.done.add(change.id)
          this.persist()
          const accepted = new Set(older.map(change => change.id))
          changes = changes.filter(change => !accepted.has(change.id))
        }
      }
      this.update({ changes, busy: result.busy, loading: false, error: undefined })
      const paths = [...new Set(incoming.map(change => change.path))]
      for (const path of paths) void this.inspect(path).catch(() => { /* Polling remains useful when a path moves or disappears. */ })
    } catch (error) {
      if (!controller.signal.aborted && generation === this.generation) {
        this.update({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (this.abort === controller) this.abort = undefined
      if (this.started && generation === this.generation) this.timer = setTimeout(() => { this.timer = undefined; void this.poll() }, 800)
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(reviewStorageKey(this.sessionId), JSON.stringify({
        ...(this.base === undefined ? {} : { from: this.base }),
        done: [...this.done],
      }))
    } catch {
      this.update({ error: '无法保存 AI 审阅记录' })
    }
  }

  private update(patch: Partial<AiReviewSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
}
