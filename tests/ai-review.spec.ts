import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiReviewController,
  latestReviewFollowChange,
  locateReviewChange,
  reviewStorageKey,
  type AiReviewOptions,
  type ReviewChange,
  type ReviewFeed,
  type ReviewInspection,
  type ReviewRejection,
} from '../src/client/aiReview.ts'

const controllers: AiReviewController[] = []

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.restoreAllMocks()
})

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(reviewStorageKey('session-1'), initial)
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

function change(id = '8:0', after = 'const added = true\n'): ReviewChange {
  return {
    id,
    seq: 8,
    turn: 1,
    path: 'src/a.ts',
    before: 'const added = false\n',
    after,
    created: false,
  }
}

async function waitFor(check: () => void): Promise<void> {
  await vi.waitFor(check, { timeout: 1000, interval: 5 })
}

describe('AI review locations', () => {
  it('locates one whole-line occurrence and rejects ambiguous, partial, empty, and CRLF content', () => {
    expect(locateReviewChange('head\nnew value\ntail\n', { before: 'old', after: 'new value' }))
      .toEqual({ startLine: 2, endLine: 2 })
    expect(locateReviewChange('new value\nnew value\n', { before: 'old', after: 'new value' }))
      .toBeUndefined()
    expect(locateReviewChange('prefix new value\n', { before: 'old', after: 'new value' }))
      .toBeUndefined()
    expect(locateReviewChange('head\nnew\n', { before: 'old', after: '' }))
      .toBeUndefined()
    expect(locateReviewChange('head\r\nnew\r\n', { before: 'old', after: 'new' }))
      .toBeUndefined()
  })

  it('follows a new block, or the latest pending block when follow is turned on later', () => {
    const first = change('8:0')
    const latest = { ...change('9:0', 'next\n'), path: 'src/b.ts' }
    expect(latestReviewFollowChange([first, latest], new Set())).toBe(latest)
    expect(latestReviewFollowChange([first, latest], new Set(['8:0']))).toBe(latest)
    expect(latestReviewFollowChange([first, latest], new Set(['8:0', '9:0']))).toBe(latest)
  })
})

describe('AI review controller', () => {
  it('resumes from the saved watermark, removes kept blocks, and persists the decision', async () => {
    const storage = memoryStorage(JSON.stringify({ from: 7, done: ['8:1'] }))
    const feed: ReviewFeed = { cursor: 9, busy: false, changes: [change(), change('8:1', 'next\n')] }
    const request = vi.fn(async (method: string) => {
      if (method === 'review.feed') return feed
      if (method === 'review.inspect') return {
        path: 'src/a.ts',
        revision: 'r1',
        content: 'head\nconst added = true\nnext\n',
        changes: [{ id: '8:0' }, { id: '8:1' }],
      } satisfies ReviewInspection
      throw new Error(`unexpected ${method}`)
    })
    const controller = new AiReviewController({ sessionId: 'session-1', storage, request: request as unknown as AiReviewOptions['request'] })
    controllers.push(controller)

    controller.start()
    await waitFor(() => expect(controller.getSnapshot().changes).toHaveLength(1))

    expect(request).toHaveBeenCalledWith(
      'review.feed',
      { sessionId: 'session-1', from: 7 },
      expect.any(AbortSignal),
    )
    await controller.keep(['8:0'])

    expect(controller.getSnapshot().changes).toEqual([])
    expect(JSON.parse(storage.values.get(reviewStorageKey('session-1'))!)).toEqual({
      from: 7,
      done: ['8:1', '8:0'],
    })
  })

  it('surfaces inspection conflicts and refuses a batch when one block cannot be reversed', async () => {
    const storage = memoryStorage()
    const request = vi.fn(async (method: string) => {
      if (method === 'review.feed') return {
        cursor: 9,
        busy: false,
        changes: [change()],
      } satisfies ReviewFeed
      if (method === 'review.inspect') return {
        path: 'src/a.ts',
        revision: 'r1',
        content: 'const added = true\n',
        changes: [{ id: '8:0', conflict: '代码中存在重复内容，无法唯一确定撤销位置' }],
      } satisfies ReviewInspection
      throw new Error(`unexpected ${method}`)
    })
    const controller = new AiReviewController({ sessionId: 'session-1', storage, request: request as unknown as AiReviewOptions['request'] })
    controllers.push(controller)

    controller.start()
    await waitFor(() => expect(controller.getSnapshot().conflicts['8:0']).toBeDefined())
    await expect(controller.reject('src/a.ts')).rejects.toThrow('无法唯一确定撤销位置')

    expect(request.mock.calls.some(([method]) => method === 'review.reject')).toBe(false)
    expect(controller.getSnapshot().working).toBe(false)
  })

  it('uses one inspected revision to reject all pending blocks in a file', async () => {
    const storage = memoryStorage()
    const changes = [change(), change('8:1', 'next\n')]
    const request = vi.fn(async (method: string, body: Record<string, unknown>) => {
      if (method === 'review.feed') return { cursor: 9, busy: false, changes } satisfies ReviewFeed
      if (method === 'review.inspect') return {
        path: 'src/a.ts',
        revision: 'r1',
        content: 'head\nconst added = true\nnext\n',
        changes: [{ id: '8:0' }, { id: '8:1' }],
      } satisfies ReviewInspection
      if (method === 'review.reject') {
        expect(body).toEqual({
          sessionId: 'session-1',
          path: 'src/a.ts',
          ids: ['8:0', '8:1'],
          revision: 'r1',
        })
        return {
          path: 'src/a.ts',
          deleted: false,
          rejectedIds: ['8:0', '8:1'],
          document: {
            path: 'src/a.ts',
            content: 'head\n',
            revision: 'r2',
            size: 5,
            binary: false,
            tooLarge: false,
          },
        } satisfies ReviewRejection
      }
      throw new Error(`unexpected ${method}`)
    })
    const controller = new AiReviewController({ sessionId: 'session-1', storage, request: request as unknown as AiReviewOptions['request'] })
    controllers.push(controller)

    controller.start()
    await waitFor(() => expect(controller.getSnapshot().changes).toHaveLength(2))
    await expect(controller.reject('src/a.ts')).resolves.toMatchObject({
      rejectedIds: ['8:0', '8:1'],
      deleted: false,
    })
    expect(controller.getSnapshot().changes).toEqual([])
  })

  it('automatically keeps changes from an older task in latest-change review mode', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    let feedCall = 0
    const request = vi.fn(async (method: string) => {
      if (method !== 'review.feed') throw new Error(`unexpected ${method}`)
      feedCall++
      return {
        cursor: feedCall === 1 ? 8 : 10,
        busy: false,
        changes: feedCall === 1
          ? [change()]
          : [{ ...change('10:0', 'latest\n'), seq: 10, turn: 2 }],
      } satisfies ReviewFeed
    })
    const controller = new AiReviewController({
      sessionId: 'session-1',
      storage,
      mode: 'latest',
      request: request as unknown as AiReviewOptions['request'],
    })
    controllers.push(controller)

    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.getSnapshot().changes.map(item => item.id)).toEqual(['8:0'])
    await vi.advanceTimersByTimeAsync(800)

    expect(controller.getSnapshot().changes.map(item => item.id)).toEqual(['10:0'])
    expect(JSON.parse(storage.values.get(reviewStorageKey('session-1'))!).done).toEqual(
      expect.arrayContaining(['8:0']),
    )
  })
})
