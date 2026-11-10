import { describe, expect, it } from 'vitest'
import { branchErrorMessage } from '../src/client/gitError.ts'

describe('branchErrorMessage', () => {
  it('strips API and git error prefixes', () => {
    expect(branchErrorMessage(new Error('error: Your local changes would be overwritten'))).toBe('Your local changes would be overwritten')
    expect(branchErrorMessage('Error: error: fatal: branch is used by worktree')).toBe('fatal: branch is used by worktree')
  })

  it('falls back when the error has no text', () => {
    expect(branchErrorMessage('')).toBe('无法切换分支。')
  })
})
