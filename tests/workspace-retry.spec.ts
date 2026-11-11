import { describe, expect, it } from 'vitest'
import { ApiError, sessionRetryDelay } from '../src/client/api.ts'


describe('workspace startup retry', () => {
  it('backs off while DSH publishes the current session', () => {
    const error = new ApiError('session-not-found', 'session not found')
    expect(sessionRetryDelay(error, 0)).toBe(250)
    expect(sessionRetryDelay(error, 4)).toBe(1000)
    expect(sessionRetryDelay(error, 10)).toBeUndefined()
  })

  it('does not retry unrelated workspace failures', () => {
    expect(sessionRetryDelay(new ApiError('internal', 'failed'), 0)).toBeUndefined()
    expect(sessionRetryDelay(new Error('network failed'), 0)).toBeUndefined()
  })
})
