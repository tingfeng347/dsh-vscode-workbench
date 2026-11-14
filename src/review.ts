import { lstat, rm } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import { readDocument, saveDocument, workspacePath } from './host.ts'
import { WorkbenchError } from './wire.ts'

type ReviewKind = 'replace' | 'insert' | 'create'

/**
 * One applied hunk from a trusted filesystem tool result.
 *
 * `created`, `path`, `before`, `after` and `id` remain the original public
 * fields used by the first review feed. The additional fields are persisted in
 * API responses to let the host reverse a hunk safely; older clients can
 * ignore them.
 */
export interface ReviewChange {
  id: string
  seq: number
  /** One-based conversation turn that produced this change. */
  turn: number
  path: string
  before: string | null
  after: string
  created: boolean
  kind: ReviewKind
  locator: 'line' | 'exact'
  hunk: number
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
  document?: Awaited<ReturnType<typeof readDocument>>
}

interface ToolCall {
  name: string
  arguments: unknown
}

function parseArguments(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    try {
      const value: unknown = JSON.parse(raw)
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
    } catch {
      return undefined
    }
  }
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined
}

function resultChanges(call: ToolCall, meta: unknown, seq: number, turn: number): ReviewChange[] {
  const args = parseArguments(call.arguments)
  const record = meta !== null && typeof meta === 'object' && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : undefined

  // edit/write results carry the applied before/after hunks. Prefer this
  // evidence over tool arguments because it reflects what reached disk.
  if ((call.name === 'edit' || call.name === 'write') && record !== undefined && Array.isArray(record.diffs)) {
    const diffs: ReviewChange[] = []
    for (const [hunk, raw] of record.diffs.entries()) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const diff = raw as Record<string, unknown>
      if (
        typeof diff.path !== 'string'
        || (diff.oldText !== null && typeof diff.oldText !== 'string')
        || typeof diff.newText !== 'string'
      ) continue
      diffs.push({
        id: `${seq}:${hunk}`,
        seq,
        turn,
        path: diff.path,
        before: diff.oldText,
        after: diff.newText,
        created: false,
        kind: diff.oldText === null ? 'insert' : 'replace',
        locator: 'line',
        hunk,
      })
    }
    if (diffs.length > 0) return diffs

    // A create has no diff hunk. The successful write result's operation and
    // exact call content are sufficient to reconstruct the new empty file.
    if (
      call.name === 'write'
      && record.operation === 'create'
      && typeof record.path === 'string'
      && typeof args?.content === 'string'
    ) {
      return [{
        id: `${seq}:create`,
        seq,
        turn,
        path: record.path,
        before: null,
        after: args.content,
        created: true,
        kind: 'create',
        locator: 'exact',
        hunk: 0,
      }]
    }
  }

  // str_replace_editor does not publish applied-diff metadata. Only turn a
  // successful command into a review hunk when its arguments are sufficient
  // to locate and reverse that exact mutation later.
  if (call.name !== 'str_replace_editor' || args === undefined || typeof args.path !== 'string') return []
  switch (args.command) {
    case 'create':
      if (typeof args.file_text !== 'string') return []
      return [{
        id: `${seq}:create`,
        seq,
        turn,
        path: args.path,
        before: null,
        after: args.file_text,
        created: true,
        kind: 'create',
        locator: 'exact',
        hunk: 0,
      }]
    case 'str_replace':
      if (
        typeof args.old_str !== 'string'
        || args.old_str.length === 0
        || typeof args.new_str !== 'string'
        || args.new_str.length === 0
        || args.old_str === args.new_str
      ) return []
      return [{
        id: `${seq}:0`,
        seq,
        turn,
        path: args.path,
        before: args.old_str,
        after: args.new_str,
        created: false,
        kind: 'replace',
        locator: 'exact',
        hunk: 0,
      }]
    case 'insert':
      if (
        typeof args.new_str !== 'string'
        || args.new_str.length === 0
        || args.new_str.startsWith('\n')
        || args.new_str.endsWith('\n')
        || !Number.isSafeInteger(args.insert_line)
        || (args.insert_line as number) < 0
      ) return []
      return [{
        id: `${seq}:0`,
        seq,
        turn,
        path: args.path,
        before: null,
        after: args.new_str,
        created: false,
        kind: 'insert',
        locator: 'line',
        hunk: 0,
      }]
    default:
      return []
  }
}

/**
 * Return successful filesystem mutations at or after `from`.
 *
 * Calls are indexed from the whole log so a result that crosses the activation
 * watermark can still be associated with its call. An outside-workspace path
 * remains in this pure result and is filtered at the HTTP boundary.
 */
export function reviewFeed(session: Session, from: number): ReviewFeed {
  const calls = new Map<string, ToolCall>()
  const changes: ReviewChange[] = []
  let busy = false
  let turn = 0
  for (let index = 0; index < session.seq; index++) {
    const event = session.eventAt(index as Parameters<Session['eventAt']>[0])
    if (event === undefined) continue
    if (event.type === 'turn/start') {
      turn++
      busy = true
    }
    else if (event.type === 'turn/end') busy = false
    if (event.type === 'tool/call') {
      calls.set(event.data.callId, {
        name: event.data.name,
        arguments: event.data.arguments,
      })
      continue
    }
    if (
      event.type !== 'tool/result'
      || event.seq < from
      || event.data.message.isError === true
    ) continue
    const call = calls.get(event.data.message.toolCallId)
    if (call === undefined || !['edit', 'write', 'str_replace_editor'].includes(call.name)) continue
    changes.push(...resultChanges(call, event.data.meta, event.seq, Math.max(1, turn)))
  }
  return { cursor: session.seq, changes, busy }
}

function conflict(message: string): WorkbenchError {
  return new WorkbenchError('review-conflict', message, 409)
}

function positions(content: string, needle: string, locator: ReviewChange['locator']): number[] {
  const found: number[] = []
  let start = 0
  while (start <= content.length) {
    const at = content.indexOf(needle, start)
    if (at < 0) break
    const end = at + needle.length
    if (
      locator === 'exact'
      || ((at === 0 || content[at - 1] === '\n') && (end === content.length || content[end] === '\n'))
    ) found.push(at)
    start = at + 1
  }
  return found
}

function locateChange(content: string, change: ReviewChange): { at: number; end: number } {
  if (content.includes('\r')) throw conflict('文件包含 CRLF 或其他回车符，无法安全撤销')
  if (change.created) {
    if (content !== change.after) throw conflict('新文件创建后已被修改，无法安全删除')
    return { at: 0, end: content.length }
  }
  if (change.after.length === 0) throw conflict('该差异缺少可定位内容，请手动编辑文件')
  const found = positions(content, change.after, change.locator)
  if (found.length === 0) throw conflict('代码已变化，未找到可安全撤销的位置')
  if (found.length > 1) throw conflict('代码中存在重复内容，无法唯一确定撤销位置')
  const at = found[0]!
  return { at, end: at + change.after.length }
}

function reverseLocated(content: string, change: ReviewChange, at: number, end: number): string {
  if (change.kind === 'insert') {
    if (at === 0 && content[end] === '\n') end += 1
    else if (end === content.length && at > 0 && content[at - 1] === '\n') at -= 1
    else if (content[end] === '\n') end += 1
    return content.slice(0, at) + content.slice(end)
  }
  const replacement = change.before ?? ''
  return content.slice(0, at) + replacement + content.slice(end)
}

function applicationOrder(changes: ReviewChange[]): ReviewChange[] {
  return [...changes].sort((left, right) => right.seq - left.seq || right.hunk - left.hunk)
}

/**
 * Reverse one unique whole-line contextual hunk.
 *
 * Kept as a small exported primitive for hosts and tests. Review rejection uses
 * the richer locator metadata above so str_replace_editor can safely reverse a
 * uniquely located literal fragment.
 */
export function reverseReviewHunk(content: string, before: string | null, after: string): string {
  const change: ReviewChange = {
    id: '0:0',
    seq: 0,
    turn: 0,
    path: '',
    before,
    after,
    created: false,
    kind: before === null ? 'insert' : 'replace',
    locator: 'line',
    hunk: 0,
  }
  const { at, end } = locateChange(content, change)
  return reverseLocated(content, change, at, end)
}

/**
 * Convert a tool path to a normalized workspace-relative path.
 *
 * Absolute paths are accepted only when they resolve inside `cwd`. Both input
 * and tool metadata are checked so callers cannot use `..`, absolute paths or
 * symlinks to expose or mutate files outside the active workspace.
 */
export async function reviewPath(cwd: string, path: string): Promise<string> {
  const candidate = isAbsolute(path) ? relative(cwd, path) : path
  const resolved = await workspacePath(cwd, candidate).catch(async error => {
    if (error instanceof WorkbenchError && error.code === 'not-found') {
      return workspacePath(cwd, candidate, true)
    }
    throw error
  })
  const { root, absolute } = resolved
  return relative(root, absolute).split(sep).join('/')
}

function uniqueIds(ids: string[]): string[] {
  if (ids.length === 0 || ids.some(id => id.length === 0)) {
    throw new WorkbenchError('bad-request', 'ids must contain at least one non-empty id')
  }
  return [...new Set(ids)]
}

async function selectChanges(
  session: Session,
  cwd: string,
  path: string,
  ids: string[],
): Promise<{
  feed: ReviewFeed
  path: string
  ids: string[]
  changes: ReviewChange[]
  fileChanges: ReviewChange[]
}> {
  const selectedIds = uniqueIds(ids)
  const resolvedPath = await reviewPath(cwd, path)
  const feed = reviewFeed(session, 0)
  const byId = new Map(feed.changes.map(change => [change.id, change]))
  const fileChanges: ReviewChange[] = []
  for (const change of feed.changes) {
    try {
      if (await reviewPath(cwd, change.path) === resolvedPath) {
        fileChanges.push({ ...change, path: resolvedPath })
      }
    } catch {
      // Outside-workspace paths are filtered by the same boundary as review.feed.
    }
  }
  const changes: ReviewChange[] = []
  for (const id of selectedIds) {
    const change = byId.get(id)
    if (change === undefined) throw conflict(`审阅项 ${id} 已不存在`)
    if (await reviewPath(cwd, change.path) !== resolvedPath) {
      throw conflict(`审阅项 ${id} 不属于 ${resolvedPath}`)
    }
    changes.push({ ...change, path: resolvedPath })
  }
  return { feed, path: resolvedPath, ids: selectedIds, changes, fileChanges }
}

async function currentDocument(cwd: string, path: string) {
  try {
    const document = await readDocument(cwd, path)
    if (document.binary || document.tooLarge) throw conflict('二进制文件或超过 5 MiB 的文件不支持自动撤销')
    return document
  } catch (error) {
    if (error instanceof WorkbenchError && ['not-file', 'not-found'].includes(error.code)) {
      throw conflict('审阅路径不是当前可读取的文本文件')
    }
    throw error
  }
}

function inspectChanges(
  document: Awaited<ReturnType<typeof readDocument>>,
  changes: ReviewChange[],
): ReviewInspection['changes'] {
  const created = changes.filter(change => change.created)
  if (created.length > 0) {
    const creation = created.at(0)!
    const planned = applyRejectChanges(document.content, changes.filter(change => !change.created))
    if ('conflict' in planned) {
      return changes.map(change => (
        change.id === planned.id
          ? { id: change.id, conflict: planned.conflict }
          : { id: change.id }
      ))
    }
    if (planned.content !== creation.after) {
      return changes.map(change => change.id === creation.id
        ? { id: change.id, conflict: '文件创建后包含无法归因的外部修改，不能整体拒绝' }
        : { id: change.id })
    }
    return changes.map(change => ({ id: change.id }))
  }
  const planned = applyRejectChanges(document.content, changes)
  return changes.map(change => (
    'conflict' in planned && planned.id === change.id
      ? { id: change.id, conflict: planned.conflict }
      : { id: change.id }
  ))
}

/**
 * Return the current disk view and per-hunk reversibility without writing.
 */
export async function inspectReview(
  session: Session,
  cwd: string,
  path: string,
  ids: string[],
): Promise<ReviewInspection> {
  const selected = await selectChanges(session, cwd, path, ids)
  const document = await currentDocument(cwd, selected.path)
  return {
    path: selected.path,
    revision: document.revision,
    content: document.content,
    changes: inspectChanges(document, selected.changes),
  }
}

function applyRejectChanges(
  content: string,
  changes: ReviewChange[],
): { content: string } | { id: string; conflict: string } {
  let next = content
  for (const change of applicationOrder(changes)) {
    try {
      const { at, end } = locateChange(next, change)
      next = reverseLocated(next, change, at, end)
    } catch (error) {
      return {
        id: change.id,
        conflict: error instanceof WorkbenchError ? error.message : '无法安全撤销',
      }
    }
  }
  return { content: next }
}

function assertIdle(feed: ReviewFeed): void {
  if (feed.busy) throw new WorkbenchError('review-busy', 'AI 正在运行，结束后可撤销', 409)
}

async function deleteCreatedFile(
  cwd: string,
  path: string,
  revision: string,
): Promise<void> {
  const document = await currentDocument(cwd, path)
  if (document.revision !== revision) throw conflict('文件在查看后已变化，请重新检查审阅项')
  try {
    const resolved = await workspacePath(cwd, path)
    const info = await lstat(resolved.absolute)
    if (!info.isFile() || info.isSymbolicLink()) throw conflict('新文件路径已不再是普通文件，无法安全删除')
    await rm(resolved.absolute, { force: false })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw conflict('文件在撤销期间已被删除或移动，请重新检查审阅项')
    }
    throw error
  }
}

/**
 * Atomically reject one file's selected AI hunks.
 *
 * The requested revision is checked against one disk read. All hunks are then
 * located and reversed in memory in reverse event/hunk order. No write occurs
 * when any hunk conflicts; an ordinary file is saved through the existing
 * revision-guarded atomic writer exactly once.
 */
export async function rejectReview(
  session: Session,
  cwd: string,
  path: string,
  ids: string[],
  revision: string,
): Promise<ReviewRejection> {
  const selected = await selectChanges(session, cwd, path, ids)
  assertIdle(selected.feed)
  const document = await currentDocument(cwd, selected.path)
  if (document.revision !== revision) throw conflict('文件在查看后已变化，请重新检查审阅项')

  const created = selected.changes.filter(change => change.created)
  if (created.length > 0) {
    if (created.length !== 1) throw conflict('新文件包含多条创建记录，无法确定安全删除范围')
    const creation = created[0]!
    const planned = applyRejectChanges(document.content, selected.changes.filter(change => !change.created))
    if ('conflict' in planned) throw conflict(`审阅项 ${planned.id}: ${planned.conflict}`)
    if (planned.content !== creation.after) {
      throw conflict('文件创建后包含无法归因的外部修改，不能整体拒绝')
    }
    assertIdle(reviewFeed(session, 0))
    await deleteCreatedFile(cwd, selected.path, revision)
    return { path: selected.path, deleted: true, rejectedIds: selected.ids }
  }

  const planned = applyRejectChanges(document.content, selected.changes)
  if ('conflict' in planned) throw conflict(`审阅项 ${planned.id}: ${planned.conflict}`)
  assertIdle(reviewFeed(session, 0))
  try {
    const saved = await saveDocument(cwd, selected.path, planned.content, revision)
    return { path: selected.path, deleted: false, rejectedIds: selected.ids, document: saved }
  } catch (error) {
    if (error instanceof WorkbenchError && error.code === 'revision-conflict') {
      throw conflict('文件在撤销期间发生变化，整次撤销已取消')
    }
    throw error
  }
}
