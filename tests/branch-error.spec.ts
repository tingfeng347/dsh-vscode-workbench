import { describe, expect, it } from 'vitest'
import { branchErrorMessage, gitActionErrorNotice, noStagedCommitNotice } from '../src/client/gitError.ts'

describe('branchErrorMessage', () => {
  it('strips API and git error prefixes', () => {
    expect(branchErrorMessage(new Error('error: Your local changes would be overwritten'))).toBe('Your local changes would be overwritten')
    expect(branchErrorMessage('Error: error: fatal: branch is used by worktree')).toBe('fatal: branch is used by worktree')
  })

  it('falls back when the error has no text', () => {
    expect(branchErrorMessage('')).toBe('无法切换分支。')
  })

  it('turns an empty commit into actionable staging guidance', () => {
    expect(noStagedCommitNotice(true)).toEqual({
      title: '没有已暂存的更改',
      message: '提交只会包含已暂存的文件。你可以先暂存要提交的文件，或者暂存全部改动后一并提交。',
      canStageAll: true,
    })
    expect(gitActionErrorNotice('commit', 'Error: On branch master\nnothing added to commit but untracked files present')).toMatchObject({
      title: '没有已暂存的更改',
      canStageAll: true,
    })
    const empty = Object.assign(new Error('没有已暂存的更改。'), { code: 'no-staged-changes' })
    const notice = gitActionErrorNotice('commit', empty, false)
    expect(notice.title).toBe('没有可提交的更改')
    expect(notice).not.toHaveProperty('canStageAll')
  })

  it('explains common Git configuration failures without exposing them as the primary message', () => {
    expect(gitActionErrorNotice('commit', 'Author identity unknown\nPlease tell me who you are')).toMatchObject({
      title: 'Git 用户信息未配置',
      message: '请先配置 Git 用户名和邮箱，然后再提交。',
    })
    expect(gitActionErrorNotice('push', 'fatal: Authentication failed')).toMatchObject({
      title: 'Git 身份验证失败',
      message: '请检查远程仓库的登录凭据或 SSH 密钥，然后重试。',
    })
  })
})
