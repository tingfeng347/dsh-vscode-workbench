import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { readDocument } from '../src/host.ts'
import {
  inspectReview,
  rejectReview,
  reverseReviewHunk,
  reviewFeed,
  reviewPath,
} from '../src/review.ts'

function session(events: unknown[]): Session {
  return {
    seq: events.length,
    eventAt: (index: number) => ({ seq: index, ...events[index] as object }),
  } as unknown as Session
}

function toolCall(callId: string, name: string, args: unknown) {
  return {
    type: 'tool/call',
    data: { callId, name, arguments: JSON.stringify(args) },
  }
}

function toolResult(callId: string, meta?: unknown, isError = false) {
  return {
    type: 'tool/result',
    data: { message: { toolCallId: callId, isError }, ...meta === undefined ? {} : { meta } },
  }
}

function editEvents(path: string, before: string, after: string, seqCallId = 'edit') {
  return [
    toolCall(seqCallId, 'edit', { file_path: path, old_string: before, new_string: after }),
    toolResult(seqCallId, { diffs: [{ path, oldText: before, newText: after }] }),
  ]
}

describe('AI review feed', () => {
  it('tracks successful edit/write metadata, preserves the watermark, and ignores failures', () => {
    const events = [
      { type: 'turn/start', data: {} },
      toolCall('edit-1', 'edit', { file_path: '/workspace/a.ts', old_string: 'old', new_string: 'new' }),
      toolResult('edit-1', { diffs: [{ path: '/workspace/a.ts', oldText: 'old', newText: 'new' }] }),
      toolCall('write-failed', 'write', { file_path: '/workspace/b.ts', content: 'bad' }),
      toolResult('write-failed', { diffs: [{ path: '/workspace/b.ts', oldText: null, newText: 'bad' }] }, true),
      { type: 'turn/end', data: {} },
    ]
    const feed = reviewFeed(session(events), 0)
    expect(feed).toEqual({
      cursor: 6,
      busy: false,
      changes: [{
        id: '2:0',
        seq: 2,
        path: '/workspace/a.ts',
        before: 'old',
        after: 'new',
        created: false,
        turn: 1,
        kind: 'replace',
        locator: 'line',
        hunk: 0,
      }],
    })
    expect(reviewFeed(session(events), 3).changes).toEqual([])
    expect(reviewFeed(session([...events, { type: 'turn/start', data: {} }]), 0).busy).toBe(true)
    expect(reviewFeed(session([toolResult('missing')]), 0).changes).toEqual([])
  })

  it('adapts trustworthy str_replace_editor create, replace, and insert arguments', () => {
    const events = [
      toolCall('create', 'str_replace_editor', {
        command: 'create',
        path: '/workspace/new.ts',
        file_text: 'created',
      }),
      toolResult('create'),
      toolCall('replace', 'str_replace_editor', {
        command: 'str_replace',
        path: '/workspace/a.ts',
        old_str: 'before',
        new_str: 'after',
      }),
      toolResult('replace'),
      toolCall('insert', 'str_replace_editor', {
        command: 'insert',
        path: '/workspace/b.ts',
        insert_line: 2,
        new_str: 'inserted',
      }),
      toolResult('insert'),
      toolCall('view', 'str_replace_editor', { command: 'view', path: '/workspace/a.ts' }),
      toolResult('view'),
      toolCall('delete-fragment', 'str_replace_editor', {
        command: 'str_replace',
        path: '/workspace/c.ts',
        old_str: 'remove',
      }),
      toolResult('delete-fragment'),
      toolCall('empty-insert', 'str_replace_editor', {
        command: 'insert',
        path: '/workspace/d.ts',
        insert_line: 0,
        new_str: '',
      }),
      toolResult('empty-insert'),
    ]
    expect(reviewFeed(session(events), 0).changes.map(change => ({
      id: change.id,
      path: change.path,
      before: change.before,
      after: change.after,
      created: change.created,
      kind: change.kind,
      locator: change.locator,
    }))).toEqual([
      {
        id: '1:create',
        path: '/workspace/new.ts',
        before: null,
        after: 'created',
        created: true,
        kind: 'create',
        locator: 'exact',
      },
      {
        id: '3:0',
        path: '/workspace/a.ts',
        before: 'before',
        after: 'after',
        created: false,
        kind: 'replace',
        locator: 'exact',
      },
      {
        id: '5:0',
        path: '/workspace/b.ts',
        before: null,
        after: 'inserted',
        created: false,
        kind: 'insert',
        locator: 'line',
      },
    ])
  })
})

describe('AI review rejection', () => {
  it('rejects without changing a file when a contextual hunk is missing, duplicated, partial-line, or CRLF', () => {
    expect(reverseReviewHunk('user edit\nnew\nend\n', 'old', 'new')).toBe('user edit\nold\nend\n')
    expect(() => reverseReviewHunk('new\nnew\n', 'old', 'new')).toThrow()
    expect(() => reverseReviewHunk('renew\n', 'old', 'new')).toThrow()
    expect(reverseReviewHunk('new\n', null, 'new')).toBe('')
    expect(() => reverseReviewHunk('', 'old', '')).toThrow()
    expect(() => reverseReviewHunk('new\r\n', 'old', 'new')).toThrow()
  })

  it('inspects and rejects multiple same-file hunks in one revision-guarded write', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dvw-review-multi-'))
    try {
      const path = join(cwd, 'a.ts')
      const before = 'header\nold-one\nmiddle\nold-two\nfooter\n'
      const after = 'header\nnew-one\nmiddle\nnew-two\nfooter\n'
      await writeFile(path, after)
      const events = [
        toolCall('one-call', 'edit', { file_path: path, old_string: 'old', new_string: 'new' }),
        toolResult('one-call', {
          diffs: [
            { path, oldText: 'header\nold-one\nmiddle', newText: 'header\nnew-one\nmiddle' },
            { path, oldText: 'middle\nold-two\nfooter', newText: 'middle\nnew-two\nfooter' },
          ],
        }),
      ]
      const s = session(events)
      expect(await reviewPath(cwd, path)).toBe('a.ts')
      const inspection = await inspectReview(s, cwd, 'a.ts', ['1:1', '1:0', '1:0'])
      expect(inspection).toMatchObject({
        path: 'a.ts',
        content: after,
        changes: [{ id: '1:1' }, { id: '1:0' }],
      })
      expect(inspection.revision).not.toBe('')
      const result = await rejectReview(s, cwd, 'a.ts', ['1:1', '1:0'], inspection.revision)
      expect(result).toMatchObject({
        path: 'a.ts',
        deleted: false,
        rejectedIds: ['1:1', '1:0'],
        document: { path: 'a.ts', content: before },
      })
      expect(await readFile(path, 'utf8')).toBe(before)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('does not write any selected hunk when another selected hunk conflicts', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dvw-review-conflict-'))
    try {
      const path = join(cwd, 'a.ts')
      const current = 'good-new\nbad-new bad-new\n'
      await writeFile(path, current)
      const events = [
        toolCall('good', 'edit', { file_path: path, old_string: 'good-old', new_string: 'good-new' }),
        toolResult('good', { diffs: [{ path, oldText: 'good-old', newText: 'good-new' }] }),
        toolCall('bad', 'edit', { file_path: path, old_string: 'bad-old', new_string: 'bad-new' }),
        toolResult('bad', { diffs: [{ path, oldText: 'bad-old', newText: 'bad-new' }] }),
      ]
      const s = session(events)
      const inspection = await inspectReview(s, cwd, path, ['1:0', '3:0'])
      expect(inspection.changes).toEqual([
        { id: '1:0' },
        { id: '3:0', conflict: '代码已变化，未找到可安全撤销的位置' },
      ])
      await expect(rejectReview(s, cwd, 'a.ts', ['1:0', '3:0'], inspection.revision))
        .rejects.toMatchObject({ code: 'review-conflict', status: 409 })
      expect(await readFile(path, 'utf8')).toBe(current)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('inspects and reverses sequential changes as one group', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dvw-review-sequential-'))
    try {
      const path = join(cwd, 'a.ts')
      await writeFile(path, 'final\n')
      const events = [
        toolCall('first', 'edit', { file_path: path, old_string: 'old', new_string: 'middle' }),
        toolResult('first', { diffs: [{ path, oldText: 'old', newText: 'middle' }] }),
        toolCall('second', 'edit', { file_path: path, old_string: 'middle', new_string: 'final' }),
        toolResult('second', { diffs: [{ path, oldText: 'middle', newText: 'final' }] }),
      ]
      const s = session(events)
      const inspection = await inspectReview(s, cwd, 'a.ts', ['1:0', '3:0'])
      expect(inspection.changes).toEqual([{ id: '1:0' }, { id: '3:0' }])
      expect((await rejectReview(s, cwd, 'a.ts', ['1:0', '3:0'], inspection.revision)).document?.content)
        .toBe('old\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('reverses str_replace_editor literal replacements and whole-line insertions', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dvw-review-editor-'))
    try {
      const replacePath = join(cwd, 'replace.ts')
      await writeFile(replacePath, 'const value = "after"\n')
      const replaceEvents = [
        toolCall('replace', 'str_replace_editor', {
          command: 'str_replace',
          path: replacePath,
          old_str: 'before',
          new_str: 'after',
        }),
        toolResult('replace'),
      ]
      const replaceSession = session(replaceEvents)
      const replaceInspection = await inspectReview(replaceSession, cwd, 'replace.ts', ['1:0'])
      await rejectReview(replaceSession, cwd, 'replace.ts', ['1:0'], replaceInspection.revision)
      expect(await readFile(replacePath, 'utf8')).toBe('const value = "before"\n')

      const insertPath = join(cwd, 'insert.ts')
      await writeFile(insertPath, 'pre\ninserted\npost\n')
      const insertEvents = [
        toolCall('insert', 'str_replace_editor', {
          command: 'insert',
          path: insertPath,
          insert_line: 1,
          new_str: 'inserted',
        }),
        toolResult('insert'),
      ]
      const insertSession = session(insertEvents)
      const insertInspection = await inspectReview(insertSession, cwd, 'insert.ts', ['1:0'])
      await rejectReview(insertSession, cwd, 'insert.ts', ['1:0'], insertInspection.revision)
      expect(await readFile(insertPath, 'utf8')).toBe('pre\npost\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('rejects a created file after later AI edits as one accumulated file change', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dvw-review-create-'))
    try {
      const cleanPath = join(cwd, 'new.ts')
      await writeFile(cleanPath, 'created\n')
      const cleanEvents = [
        toolCall('write-clean', 'write', { file_path: cleanPath, content: 'created\n' }),
        toolResult('write-clean', { operation: 'create', path: cleanPath, diffs: [] }),
      ]
      const cleanSession = session(cleanEvents)
      const cleanInspection = await inspectReview(cleanSession, cwd, 'new.ts', ['1:create'])
      expect(cleanInspection.changes).toEqual([{ id: '1:create' }])
      expect(await rejectReview(cleanSession, cwd, 'new.ts', ['1:create'], cleanInspection.revision)).toEqual({
        path: 'new.ts',
        deleted: true,
        rejectedIds: ['1:create'],
      })
      await expect(stat(cleanPath)).rejects.toMatchObject({ code: 'ENOENT' })

      const modifiedPath = join(cwd, 'modified.ts')
      await writeFile(modifiedPath, 'created\nAI follow-up\n')
      const modifiedEvents = [
        toolCall('write-modified', 'write', { file_path: modifiedPath, content: 'created\n' }),
        toolResult('write-modified', { operation: 'create', path: modifiedPath, diffs: [] }),
        toolCall('edit-modified', 'edit', {
          file_path: modifiedPath,
          old_string: 'created\n',
          new_string: 'created\nAI follow-up\n',
        }),
        toolResult('edit-modified', {
          diffs: [{ path: modifiedPath, oldText: 'created\n', newText: 'created\nAI follow-up\n' }],
        }),
      ]
      const modifiedSession = session(modifiedEvents)
      const modified = await inspectReview(modifiedSession, cwd, 'modified.ts', ['1:create', '3:0'])
      expect(modified.changes).toEqual([{ id: '1:create' }, { id: '3:0' }])
      expect(await rejectReview(modifiedSession, cwd, 'modified.ts', ['1:create', '3:0'], modified.revision))
        .toEqual({
          path: 'modified.ts',
          deleted: true,
          rejectedIds: ['1:create', '3:0'],
        })
      await expect(stat(modifiedPath)).rejects.toMatchObject({ code: 'ENOENT' })

      const partialPath = join(cwd, 'partial.ts')
      await writeFile(partialPath, 'created\nAI follow-up\n')
      const partialEvents = [
        toolCall('write-partial', 'write', { file_path: partialPath, content: 'created\n' }),
        toolResult('write-partial', { operation: 'create', path: partialPath, diffs: [] }),
        toolCall('edit-partial', 'edit', {
          file_path: partialPath,
          old_string: 'created\n',
          new_string: 'created\nAI follow-up\n',
        }),
        toolResult('edit-partial', {
          diffs: [{ path: partialPath, oldText: 'created\n', newText: 'created\nAI follow-up\n' }],
        }),
      ]
      const partialSession = session(partialEvents)
      const partial = await inspectReview(partialSession, cwd, 'partial.ts', ['3:0'])
      expect(partial.changes).toEqual([{ id: '3:0' }])
      expect(await rejectReview(partialSession, cwd, 'partial.ts', ['3:0'], partial.revision))
        .toMatchObject({ path: 'partial.ts', deleted: false, rejectedIds: ['3:0'] })
      expect(await readFile(partialPath, 'utf8')).toBe('created\n')

      const externalPath = join(cwd, 'external.ts')
      await writeFile(externalPath, 'created\nuser edit\n')
      const externalEvents = [
        toolCall('write-external', 'write', { file_path: externalPath, content: 'created\n' }),
        toolResult('write-external', { operation: 'create', path: externalPath, diffs: [] }),
      ]
      const externalSession = session(externalEvents)
      const external = await inspectReview(externalSession, cwd, 'external.ts', ['1:create'])
      expect(external.changes[0]?.conflict).toContain('无法归因')
      await expect(rejectReview(externalSession, cwd, 'external.ts', ['1:create'], external.revision))
        .rejects.toMatchObject({ code: 'review-conflict' })
      expect(await readFile(externalPath, 'utf8')).toBe('created\nuser edit\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('rejects stale revisions, busy AI turns, outside paths, and directory paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dvw-review-guard-'))
    try {
      await writeFile(join(cwd, 'a.ts'), 'new\n')
      await mkdir(join(cwd, 'folder'))
      const events = editEvents('a.ts', 'old', 'new')
      const s = session(events)
      const revision = (await readDocument(cwd, 'a.ts')).revision
      await expect(rejectReview(s, cwd, 'a.ts', ['1:0'], 'stale'))
        .rejects.toMatchObject({ code: 'review-conflict' })
      await expect(rejectReview(
        session([...events, { type: 'turn/start', data: {} }]),
        cwd,
        'a.ts',
        ['1:0'],
        revision,
      )).rejects.toMatchObject({ code: 'review-busy' })
      await expect(inspectReview(session(editEvents('../outside.ts', 'old', 'new')), cwd, 'a.ts', ['1:0']))
        .rejects.toMatchObject({ code: 'path-outside', status: 403 })
      await expect(inspectReview(s, cwd, 'folder', ['1:0']))
        .rejects.toMatchObject({ code: 'review-conflict' })
      expect(await readFile(join(cwd, 'a.ts'), 'utf8')).toBe('new\n')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
