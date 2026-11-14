/** Remove the transport and Git labels users do not need in a recovery prompt. */
function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^(?:Error:\s*)?(?:error:\s*)?/i, '').trim()
}

/** Normalize a Git/API error into the sentence shown in the branch-switch dialog. */
export function branchErrorMessage(error: unknown): string {
  return errorText(error) || '无法切换分支。'
}

export interface GitActionNotice {
  title: string
  message: string
  detail?: string
  canStageAll?: boolean
}

const ACTION_TITLES: Record<string, string> = {
  refresh: '读取 Git 状态失败',
  commit: '提交未完成',
  'commit.amend': '修改提交未完成',
  push: '推送未完成',
  sync: '同步未完成',
  stage: '暂存未完成',
  'stage.all': '暂存全部更改失败',
  unstage: '取消暂存失败',
  'unstage.all': '取消全部暂存失败',
  discard: '放弃更改失败',
  'discard.all': '放弃全部更改失败',
  'branch.create': '创建分支失败',
  'branch.switch': '切换分支失败',
  'branch.list': '读取分支失败',
  'commit.files': '读取提交文件失败',
  'commit.file.diff': '打开提交文件失败',
  commitMessage: '生成提交信息失败',
  diff: '读取文件差异失败',
}

export function noStagedCommitNotice(hasUnstagedChanges: boolean): GitActionNotice {
  if (!hasUnstagedChanges) return {
    title: '没有可提交的更改',
    message: '工作区当前没有可提交的改动。',
  }
  return {
    title: '没有已暂存的更改',
    message: '提交只会包含已暂存的文件。你可以先暂存要提交的文件，或者暂存全部改动后一并提交。',
    canStageAll: true,
  }
}

/** Turn raw Git output into a concise recovery dialog while retaining diagnostics on demand. */
export function gitActionErrorNotice(action: string, error: unknown, hasUnstagedChanges = true): GitActionNotice {
  const raw = errorText(error)
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === 'model-unavailable' || code === 'llm-unavailable') {
    return {
      title: '无法生成提交信息',
      message: raw || '请到 Workbench 设置的“提交信息”中选择一个可用的 DeepSeek 聊天模型。',
    }
  }
  if (action === 'commit' && (code === 'no-staged-changes' || /nothing added to commit|no changes added to commit|nothing to commit/iu.test(raw))) {
    return noStagedCommitNotice(hasUnstagedChanges)
  }
  if (/please tell me who you are|author identity unknown|unable to auto-detect email address/iu.test(raw)) {
    return {
      title: 'Git 用户信息未配置',
      message: '请先配置 Git 用户名和邮箱，然后再提交。',
      detail: raw || undefined,
    }
  }
  if (/authentication failed|could not read username|permission denied \(publickey\)/iu.test(raw)) {
    return {
      title: 'Git 身份验证失败',
      message: '请检查远程仓库的登录凭据或 SSH 密钥，然后重试。',
      detail: raw || undefined,
    }
  }
  if (/automatic merge failed|fix conflicts|unmerged files/iu.test(raw)) {
    return {
      title: '当前操作遇到冲突',
      message: '请先解决文件冲突并完成提交，然后再继续。',
      detail: raw || undefined,
    }
  }
  if (/no configured push destination|does not appear to be a git repository/iu.test(raw)) {
    return {
      title: '没有可用的远程仓库',
      message: '请先添加远程仓库，或者确认当前分支已设置上游分支。',
      detail: raw || undefined,
    }
  }
  return {
    title: ACTION_TITLES[action] ?? 'Git 操作未完成',
    message: '这次 Git 操作没有完成。请根据技术详情检查后重试。',
    detail: raw || undefined,
  }
}
