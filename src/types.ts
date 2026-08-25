/** One directory entry returned by the workbench host. */
export interface FileEntry { name: string; path: string; kind: 'file' | 'directory'; size?: number; mtimeMs?: number }
/** A text file together with its optimistic-concurrency revision. */
export interface FileDocument { path: string; content: string; revision: string; size: number; binary: boolean; tooLarge: boolean }
/** One ripgrep match. */
export interface SearchMatch { path: string; line: number; column: number; preview: string; match: string }
/** Search request flags. */
export interface SearchRequest { query: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; include?: string; exclude?: string }
/** One working tree change. */
export interface GitChange { path: string; originalPath?: string; index: string; worktree: string; staged: boolean; untracked: boolean }
/** Local repository state. */
export interface GitStatus { repository: string; branch: string; ahead: number; behind: number; changes: GitChange[] }
/** One commit displayed by the source-control graph. */
export interface GitCommit { hash: string; parents: string[]; author: string; date: string; subject: string; refs: string[] }
/** One path changed by a local commit. */
export interface GitCommitFile { path: string; previousPath?: string; status: string }
/** Unified patch and full texts used by the Monaco diff editor. */
export interface GitDiff { diff: string; original: string; modified: string }
