/** One directory entry returned by the workbench host. */
export interface FileEntry { name: string; path: string; kind: 'file' | 'directory'; size?: number; mtimeMs?: number }
/** A text file together with its optimistic-concurrency revision. */
export interface FileDocument { path: string; content: string; revision: string; size: number; binary: boolean; tooLarge: boolean }
/** One ripgrep match. */
export interface SearchMatch { path: string; line: number; column: number; preview: string; match: string; lineHash: string; captures?: string[] }
export interface SearchEdit { line: number; column: number; length: number; lineHash: string; text: string }
export interface SearchFileEdits { path: string; edits: SearchEdit[] }
export interface SearchReplaceResult { changed: string[]; failures: { path: string; message: string }[] }
/** Search request flags. */
export interface SearchRequest { query: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; captureGroups?: number[]; include?: string; exclude?: string }
/** One working tree change. */
export interface GitChange { path: string; originalPath?: string; index: string; worktree: string; staged: boolean; untracked: boolean; conflicted?: boolean }
/** One local branch and the linked worktree that has it checked out. */
export interface GitBranch { name: string; worktree?: string }
/** Local repository state. */
export interface GitStatus { repository: string; branch: string; ahead: number; behind: number; changes: GitChange[]; operation?: 'merge' | 'rebase' | 'cherry-pick' | 'revert' }
export interface GitConflictVersions { path: string; revision: string; base?: string; ours?: string; theirs?: string; document?: FileDocument }
export interface GitStash { ref: string; hash: string; subject: string }
/** One commit displayed by the source-control graph. */
export interface GitCommit { hash: string; parents: string[]; author: string; date: string; subject: string; refs: string[] }
/** One path changed by a local commit. */
export interface GitCommitSummary { files: number; added: number; removed: number; url?: string }
export interface GitCommitFile { path: string; previousPath?: string; status: string }
export type GitBlameSource =
  | { kind: 'commit'; path: string; revision: string }
  | { kind: 'index' | 'worktree'; path: string; revision?: string; historyPath?: string; digest: string }
  | { kind: 'document'; path: string; revision: string }
  | { kind: 'untracked' }
export type GitLineBlame =
  | { kind: 'commit'; hash: string; author: string; timestamp: number; subject: string }
  | { kind: 'uncommitted' }
  | { kind: 'unavailable' }
export interface GitBlameRange { startLine: number; lines: GitLineBlame[] }
/** Unified patch and full texts used by the Monaco diff editor. */
export interface GitDiff {
  diff: string
  original: string
  modified: string
  blame?: { original?: GitBlameSource; modified?: GitBlameSource }
  staging?: { mode: 'staged' | 'worktree'; revision: string; hunks: { label: string; line: number }[] }
}
