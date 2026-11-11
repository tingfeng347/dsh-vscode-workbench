/** Exclusion rules for the recursive workspace file watcher. */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Directory names skipped by default; large dependency and build trees exhaust inotify watches. */
export const DEFAULT_WATCH_IGNORES = [
  '.git', '.hg', '.svn',
  'node_modules', 'bower_components', '.pnpm-store', '.yarn',
  '.next', '.nuxt', '.turbo', '.vite', '.cache', 'coverage',
  'vendor', 'third_party', 'third-party', 'third_part', 'third-part',
  'build', 'dist', 'out', 'target',
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.gradle', '.idea', '.vs', 'Pods',
] as const

function normalize(entry: string): string {
  return entry.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function segmentsOf(entry: string): string[] {
  return normalize(entry).split('/').filter(part => part !== '' && part !== '.')
}

/** Parse a newline- or comma-separated exclusion list, dropping blanks, comments and unsafe paths. */
export function parseWatchIgnores(value: string | null | undefined): string[] {
  if (value === null || value === undefined) return []
  const entries = new Set<string>()
  for (const raw of value.split(/[\n,]+/)) {
    const entry = normalize(raw)
    const parts = segmentsOf(entry)
    if (parts.length === 0 || parts.includes('..') || entry.startsWith('#')) continue
    entries.add(parts.slice(0, 8).join('/').slice(0, 200))
    if (entries.size >= 200) break
  }
  return [...entries]
}

/** Return true when a workspace-relative path contains one of the excluded segment sequences. */
export function isIgnoredPath(relativePath: string, patterns: readonly string[]): boolean {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean).map(segment => segment.toLowerCase())
  if (segments.length === 0) return false
  for (const pattern of patterns) {
    const parts = segmentsOf(pattern).map(part => part.toLowerCase())
    if (parts.length === 0 || parts.includes('..')) continue
    if (parts.length === 1) {
      if (segments.includes(parts[0]!)) return true
      continue
    }
    for (let index = 0; index + parts.length <= segments.length; index++) {
      if (parts.every((part, offset) => segments[index + offset] === part)) return true
    }
  }
  return false
}

/** Literal directory/path rules from a .gitignore; glob and negation rules are left to git itself. */
export function parseGitIgnore(text: string): string[] {
  const entries = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('!') || /[*?[\]{}]/.test(line)) continue
    const parts = segmentsOf(normalize(line).replace(/^\//, ''))
    if (parts.length === 0 || parts.includes('..')) continue
    entries.add(parts.slice(0, 8).join('/').slice(0, 200))
    if (entries.size >= 200) break
  }
  return [...entries]
}

/** Ignore patterns derived from the workspace's root .gitignore, without asking the user to type exclusions. */
export async function workspaceWatchIgnores(workspace: string): Promise<string[]> {
  const text = await readFile(join(workspace, '.gitignore'), 'utf8').catch(() => '')
  return parseGitIgnore(text)
}

/** Build a chokidar `ignored` predicate for one workspace and the user's extra exclusions. */
export function watchIgnore(workspace: string, extra: readonly string[]): (path: string) => boolean {
  const patterns = [...DEFAULT_WATCH_IGNORES, ...extra]
  return (path: string) => {
    const path_ = relative(workspace, path)
    if (path_ === '' || path_.startsWith('..') || isAbsolute(path_)) return false
    return isIgnoredPath(path_.split(sep).join('/'), patterns)
  }
}
