import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/client/api.ts'
import { workspaceRetryDelay } from '../src/client/Workbench.tsx'

describe('workspace startup retry', () => {
  it('backs off while DSH publishes the current session', () => {
    const error = new ApiError('session-not-found', 'session not found')
    expect(workspaceRetryDelay(error, 0)).toBe(250)
    expect(workspaceRetryDelay(error, 4)).toBe(1000)
    expect(workspaceRetryDelay(error, 10)).toBeUndefined()
  })

  it('does not retry unrelated workspace failures', () => {
    expect(workspaceRetryDelay(new ApiError('internal', 'failed'), 0)).toBeUndefined()
    expect(workspaceRetryDelay(new Error('network failed'), 0)).toBeUndefined()
  })
})
