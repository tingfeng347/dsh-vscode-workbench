/** Normalize a Git/API error into the sentence shown in the branch-switch dialog. */
export function branchErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^(?:Error:\s*)?(?:error:\s*)?/i, '').trim() || '无法切换分支。'
}
