import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, sessionRetryDelay } from '../src/client/api.ts'

afterEach(() => vi.unstubAllGlobals())

function answer(ok: boolean, value?: unknown, error?: { code: string; message: string }) {
  return { ok, json: async () => (ok ? { ok: true, value } : { ok: false, error }) } as unknown as Response
}

describe('shared API session retry', () => {
  it('waits for the host to publish a session instead of surfacing an error', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return calls === 1 ? answer(false, undefined, { code: 'session-not-found', message: 'session not found' }) : answer(true, { cwd: '/workspace' })
    })
    await expect(api('workspace', { sessionId: 's1' })).resolves.toEqual({ cwd: '/workspace' })
    expect(calls).toBe(2)
  })

  it('surfaces other failures immediately', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return answer(false, undefined, { code: 'internal', message: 'boom' }) })
    await expect(api('git.status', { sessionId: 's1' })).rejects.toMatchObject({ code: 'internal' })
    expect(calls).toBe(1)
  })

  it('backs off a bounded number of times', () => {
    expect(sessionRetryDelay(new ApiError('session-not-found', 'session not found'), 0)).toBe(250)
    expect(sessionRetryDelay(new ApiError('session-not-found', 'session not found'), 10)).toBeUndefined()
    expect(sessionRetryDelay(new Error('other'), 0)).toBeUndefined()
  })

  it('gives up after the retry budget', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return answer(false, undefined, { code: 'session-not-found', message: 'session not found' }) })
    await expect(api('git.status', { sessionId: 's1' })).rejects.toMatchObject({ code: 'session-not-found' })
    expect(calls).toBe(11)
  }, 20_000)
})
