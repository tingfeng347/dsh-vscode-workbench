import { describe, expect, it } from 'vitest'
import { resetWorkspaceDocuments, WorkspaceRequestScope } from '../src/client/workspaceState.ts'

describe('workspace editor isolation', () => {
  it('drops tabs, selection, and errors when a different workspace begins loading', () => {
    expect(resetWorkspaceDocuments()).toEqual({ tabs: [], active: undefined, error: undefined })
  })

  it('rejects responses issued for an earlier workspace', () => {
    const scope = new WorkspaceRequestScope()
    const first = scope.begin()
    expect(scope.isCurrent(first)).toBe(true)
    const second = scope.begin()
    expect(scope.isCurrent(first)).toBe(false)
    expect(scope.isCurrent(second)).toBe(true)
    scope.invalidate(second)
    expect(scope.isCurrent(second)).toBe(false)
  })
})
