import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { HostContext } from './context.ts'
import type { FileDocument, FileEntry, GitChange, GitCommit, GitCommitFile, GitDiff, GitStatus, SearchMatch, SearchRequest } from './types.ts'
import { WorkbenchError } from './wire.ts'

const require = createRequire(import.meta.url)
const TEXT_LIMIT = 5 * 1024 * 1024
const PROCESS_TIMEOUT = 30_000

export function cwdFor(ctx: HostContext, sessionId: string): string {
  const cwd = ctx.sessions.get(sessionId)?.header.cwd
  if (cwd === undefined || cwd === '') return process.cwd()
  if (!isAbsolute(cwd)) throw new WorkbenchError('cwd-invalid', 'session working directory is not absolute')
  return normalize(cwd)
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function canonicalRoot(cwd: string): Promise<string> {
  return realpath(cwd).catch(() => { throw new WorkbenchError('cwd-missing', 'session working directory does not exist', 404) })
}

/** Resolve a caller-relative path and reject traversal and symlink escape. */
export async function workspacePath(cwd: string, raw: string, create = false): Promise<{ root: string; absolute: string }> {
  if (isAbsolute(raw)) throw new WorkbenchError('path-invalid', 'absolute paths are not accepted')
  const root = await canonicalRoot(cwd)
  const absolute = resolve(root, raw === '' ? '.' : raw)
  if (!inside(root, absolute)) throw new WorkbenchError('path-outside', 'path is outside the workspace', 403)
  if (create) {
    const parent = await realpath(dirname(absolute)).catch(() => { throw new WorkbenchError('parent-missing', 'parent directory does not exist', 404) })
    if (!inside(root, parent)) throw new WorkbenchError('path-outside', 'path follows a symlink outside the workspace', 403)
  } else {
    const actual = await realpath(absolute).catch(() => { throw new WorkbenchError('not-found', 'path does not exist', 404) })
    if (!inside(root, actual)) throw new WorkbenchError('path-outside', 'path follows a symlink outside the workspace', 403)
  }
  return { root, absolute }
}

function relativePath(root: string, absolute: string): string { return relative(root, absolute).split(sep).join('/') }
function revision(content: Buffer, mtimeMs: number): string {
  return createHash('sha256').update(content).update(String(mtimeMs)).digest('hex')
}

export async function listFiles(cwd: string, path: string): Promise<FileEntry[]> {
  const { root, absolute } = await workspacePath(cwd, path)
  const values = await readdir(absolute, { withFileTypes: true })
  const rows = await Promise.all(values.filter(item => item.name !== '.git').map(async item => {
    const full = join(absolute, item.name)
    const info = await lstat(full)
    const kind = item.isDirectory() ? 'directory' as const : 'file' as const
    return { name: item.name, path: relativePath(root, full), kind, size: info.size, mtimeMs: info.mtimeMs }
  }))
  return rows.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
}

export async function readDocument(cwd: string, path: string): Promise<FileDocument> {
  const { root, absolute } = await workspacePath(cwd, path)
  const info = await stat(absolute)
  if (!info.isFile()) throw new WorkbenchError('not-file', 'path is not a file')
  const tooLarge = info.size > TEXT_LIMIT
  const handle = await open(absolute, 'r')
  try {
    const head = Buffer.alloc(Math.min(info.size, tooLarge ? 4096 : TEXT_LIMIT))
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    const bytes = head.subarray(0, bytesRead)
    const binary = bytes.includes(0)
    return {
      path: relativePath(root, absolute), content: binary || tooLarge ? '' : bytes.toString('utf8'),
      revision: revision(bytes, info.mtimeMs), size: info.size, binary, tooLarge,
    }
  } finally { await handle.close() }
}

export async function saveDocument(cwd: string, path: string, content: string, expected: string): Promise<FileDocument> {
  const { absolute } = await workspacePath(cwd, path)
  const current = await readDocument(cwd, path)
  if (current.revision !== expected) throw new WorkbenchError('revision-conflict', 'file changed on disk; reload before saving', 409)
  const temp = join(dirname(absolute), `.${randomUUID()}.dsh-vscode.tmp`)
  await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
  try { await rename(temp, absolute) } catch (error) { await rm(temp, { force: true }); throw error }
  return readDocument(cwd, path)
}

export async function createEntry(cwd: string, path: string, kind: 'file' | 'directory'): Promise<void> {
  const { absolute } = await workspacePath(cwd, path, true)
  if (kind === 'directory') await mkdir(absolute)
  else { const handle = await open(absolute, 'wx'); await handle.close() }
}

export async function renameEntry(cwd: string, path: string, nextPath: string): Promise<void> {
  const source = await workspacePath(cwd, path)
  const target = await workspacePath(cwd, nextPath, true)
  await access(target.absolute, constants.F_OK).then(
    () => { throw new WorkbenchError('target-exists', 'destination already exists', 409) }, () => undefined,
  )
  await rename(source.absolute, target.absolute)
}

export async function deleteEntry(cwd: string, path: string): Promise<void> {
  if (path === '') throw new WorkbenchError('root-delete', 'cannot delete workspace root', 403)
  const { absolute } = await workspacePath(cwd, path)
  await rm(absolute, { recursive: true, force: false })
}

const IMAGE_TYPES:Record<string,string>={'.avif':'image/avif','.bmp':'image/bmp','.gif':'image/gif','.ico':'image/x-icon','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'}
/** Resolve an image inside the workspace for protected browser preview. */
export async function workspaceImage(cwd:string,path:string):Promise<{path:string;type:string}>{const resolved=await workspacePath(cwd,path);const type=IMAGE_TYPES[extname(resolved.absolute).toLowerCase()];if(type===undefined)throw new WorkbenchError('unsupported-media','file is not a supported image',415);return {path:resolved.absolute,type}}

interface ProcessResult { stdout: string; stderr: string; code: number }
export function run(command: string, args: string[], cwd: string, timeout = PROCESS_TIMEOUT, signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true })
    let stdout = ''; let stderr = ''; let settled = false
    const timer = setTimeout(() => { child.kill(); if (!settled) reject(new WorkbenchError('timeout', `${command} timed out`, 504)) }, timeout)
    const abort = () => { child.kill(); if (!settled) { settled = true; clearTimeout(timer); reject(new WorkbenchError('cancelled', `${command} cancelled`, 499)) } }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (!settled) { settled = true; reject(error) } })
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (!settled) { settled = true; resolvePromise({ stdout, stderr, code: code ?? 1 }) } })
  })
}

export async function searchWorkspace(cwd: string, request: SearchRequest, signal?: AbortSignal): Promise<{ matches: SearchMatch[]; limited: boolean }> {
  if (request.query === '') return { matches: [], limited: false }
  const root = await canonicalRoot(cwd)
  const rg = require('@vscode/ripgrep').rgPath as string
  const args = ['--json', '--line-number', '--column', '--hidden', '--glob', '!.git/**', '--max-count', '2000']
  if (!request.regex) args.push('--fixed-strings')
  if (!request.caseSensitive) args.push('--ignore-case')
  if (request.wholeWord) args.push('--word-regexp')
  if (request.include) args.push('--glob', request.include)
  if (request.exclude) args.push('--glob', `!${request.exclude}`)
  args.push('--', request.query, '.')
  const result = await run(rg, args, root, PROCESS_TIMEOUT, signal)
  if (result.code > 1) throw new WorkbenchError('search-failed', result.stderr || 'ripgrep failed', 500)
  const matches: SearchMatch[] = []
  for (const line of result.stdout.split('\n')) {
    if (line === '') continue
    const event = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number; submatches?: Array<{ start: number; end: number; match?: { text?: string } }> } }
    if (event.type !== 'match' || event.data?.path?.text === undefined || event.data.lines?.text === undefined) continue
    for (const hit of event.data.submatches ?? []) {
      matches.push({ path: event.data.path.text.replace(/^\.\//, ''), line: event.data.line_number ?? 1, column: hit.start + 1, preview: event.data.lines.text.trimEnd(), match: hit.match?.text ?? '' })
      if (matches.length >= 2000) return { matches, limited: true }
    }
  }
  return { matches, limited: false }
}

async function gitRoot(cwd: string): Promise<string> {
  const result = await run('git', ['rev-parse', '--show-toplevel'], cwd)
  if (result.code !== 0) throw new WorkbenchError('not-repository', 'current workspace is not inside a Git repository', 404)
  return result.stdout.trim()
}

function validateCommitHash(value?: string): string {
  if (!/^[0-9a-f]{7,64}$/i.test(value ?? '')) throw new WorkbenchError('bad-request', 'commit hash is invalid')
  return value!
}

function validateGitPath(repository: string, path?: string): string {
  if (path === undefined || path === '' || isAbsolute(path) || !inside(repository, resolve(repository, path))) throw new WorkbenchError('bad-request', 'repository-relative path is required')
  return path
}

async function gitObject(repository: string, spec: string): Promise<string> {
  const result = await run('git', ['show', '--no-textconv', spec], repository)
  return result.code === 0 ? result.stdout : ''
}

async function commitFiles(repository: string, hash: string): Promise<GitCommitFile[]> {
  const parent=await run('git',['rev-parse','--verify',`${hash}^1`],repository)
  const result = parent.code===0
    ? await run('git',['diff','--name-status','-z','-M',parent.stdout.trim(),hash,'--'],repository)
    : await run('git', ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '-M', hash], repository)
  if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 409)
  const tokens = result.stdout.split('\0').filter(Boolean); const files: GitCommitFile[] = []
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++] ?? ''; const code = status[0] ?? ''
    if (code === 'R' || code === 'C') { const previousPath=tokens[index++]??'';const path=tokens[index++]??'';files.push({path,previousPath,status:code}) }
    else { const path=tokens[index++]??'';files.push({path,status:code}) }
  }
  return files
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const repository = await gitRoot(cwd)
  const result = await run('git', ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], repository)
  if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr, 500)
  let branch = 'HEAD'; let ahead = 0; let behind = 0
  const changes: GitChange[] = []
  for (const record of result.stdout.split('\0')) {
    if (record.startsWith('# branch.head ')) branch = record.slice(14)
    else if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record); ahead = Number(match?.[1] ?? 0); behind = Number(match?.[2] ?? 0)
    } else if (record.startsWith('? ')) changes.push({ path: record.slice(2), index: '?', worktree: '?', staged: false, untracked: true })
    else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const parts = record.split(' '); const xy = parts[1] ?? '..'; const path = parts.slice(record.startsWith('2 ') ? 9 : 8).join(' ')
      changes.push({ path, index: xy[0] ?? '.', worktree: xy[1] ?? '.', staged: xy[0] !== '.', untracked: false })
    }
  }
  return { repository, branch, ahead, behind, changes }
}

export async function gitAction(cwd: string, action: string, path?: string, value?: string): Promise<unknown> {
  const repository = await gitRoot(cwd)
  let args: string[]
  switch (action) {
    case 'stage': args = ['add', '--', path ?? '']; break
    case 'stage.all': args = ['add', '-A']; break
    case 'unstage': args = ['restore', '--staged', '--', path ?? '']; break
    case 'unstage.all': args = ['restore', '--staged', '--', '.']; break
    case 'discard': {
      args = value === 'untracked' ? ['clean', '-f', '--', path ?? ''] : ['restore', '--worktree', '--', path ?? '']
      break
    }
    case 'discard.all': {
      const head = await run('git', ['rev-parse', '--verify', 'HEAD'], repository)
      if (head.code === 0) {
        const restore = await run('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', '.'], repository)
        if (restore.code !== 0) throw new WorkbenchError('git-failed', restore.stderr || restore.stdout, 409)
      }
      const clean = await run('git', ['clean', '-fd'], repository)
      if (clean.code !== 0) throw new WorkbenchError('git-failed', clean.stderr || clean.stdout, 409)
      return gitStatus(cwd)
    }
    case 'commit': args = ['commit', '-m', value ?? '']; break
    case 'branch.create': args = ['switch', '-c', value ?? '']; break
    case 'branch.switch': args = ['switch', value ?? '']; break
    case 'branches': {
      const result = await run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repository)
      if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr, 500)
      return result.stdout.split('\n').filter(Boolean)
    }
    case 'log': {
      const head = await run('git', ['rev-parse', '--verify', 'HEAD'], repository)
      if (head.code !== 0) return []
      const result = await run('git', ['log', '--topo-order', '--date=iso-strict', '--decorate=short', '--pretty=format:%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x00', '-n', '100'], repository)
      if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 500)
      return result.stdout.split('\0').filter(Boolean).map((record): GitCommit => {
        const [rawHash = '', parents = '', author = '', date = '', subject = '', refs = ''] = record.split('\x1f');const hash=rawHash.trim()
        return { hash, parents: parents.split(' ').filter(Boolean), author, date, subject, refs: refs.split(',').map(item => item.trim()).filter(Boolean) }
      })
    }
    case 'commit.show': {
      const hash = validateCommitHash(value)
      const result = await run('git', ['show', '--no-ext-diff', '--find-renames', '--format=fuller', '--stat', '--patch', '--no-color', hash], repository)
      if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 409)
      return { diff: result.stdout, original: '', modified: result.stdout } satisfies GitDiff
    }
    case 'commit.files': return commitFiles(repository, validateCommitHash(value))
    case 'commit.file.diff': {
      const hash=validateCommitHash(value);const target=validateGitPath(repository,path);const files=await commitFiles(repository,hash);const file=files.find(item=>item.path===target)
      if (file===undefined) throw new WorkbenchError('not-found','file is not part of the commit',404)
      const parent=await run('git',['rev-parse','--verify',`${hash}^1`],repository)
      const shown=parent.code===0
        ? await run('git',['diff','--no-ext-diff','--find-renames','--patch','--no-color',parent.stdout.trim(),hash,'--',file.previousPath??target,target],repository)
        : await run('git',['show','--no-ext-diff','--find-renames','--format=','--patch','--no-color',hash,'--',file.previousPath??target,target],repository)
      if(shown.code!==0)throw new WorkbenchError('git-failed',shown.stderr||shown.stdout,409)
      const original=file.status==='A'||parent.code!==0?'':await gitObject(repository,`${parent.stdout.trim()}:${file.previousPath??target}`)
      const modified=file.status==='D'?'':await gitObject(repository,`${hash}:${target}`)
      return {diff:shown.stdout,original,modified} satisfies GitDiff
    }
    case 'diff': {
      const untracked = value === 'untracked'
      const staged = value === 'staged'
      args = untracked
        ? ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', path ?? '']
        : ['diff', ...(staged ? ['--cached'] : []), '--', path ?? '']
      break
    }
    default: throw new WorkbenchError('bad-action', `unknown Git action ${action}`)
  }
  if (args.some(arg => arg === '') && action !== 'commit') throw new WorkbenchError('bad-request', 'path or value is required')
  const result = await run('git', args, repository)
  const expectedUntrackedDifference = action === 'diff' && value === 'untracked' && result.code === 1
  if (result.code !== 0 && !expectedUntrackedDifference) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 409)
  if(action!=='diff')return gitStatus(cwd)
  const target=validateGitPath(repository,path)
  const original=value==='untracked'?'':await gitObject(repository,`${value==='staged'?'HEAD:':':'}${target}`)
  const modified=value==='staged'?await gitObject(repository,`:${target}`):await readFile(resolve(repository,target),'utf8').catch(()=> '')
  return {diff:result.stdout,original,modified} satisfies GitDiff
}

/** Resolve the official VS Code Codicon font shipped by @vscode/codicons. */
export function codiconAsset(): { path: string; type: string } {
  const packageRoot = dirname(require.resolve('@vscode/codicons/package.json'))
  return { path: resolve(packageRoot, 'dist', 'codicon.ttf'), type: 'font/ttf' }
}

export function monacoAsset(raw: string): { path: string; type: string } {
  const packageRoot = dirname(require.resolve('monaco-editor/package.json'))
  const path = resolve(packageRoot, 'min', raw)
  const root = resolve(packageRoot, 'min')
  if (!inside(root, path)) throw new WorkbenchError('asset-invalid', 'invalid Monaco asset path', 403)
  const type = extname(path) === '.css' ? 'text/css' : extname(path) === '.js' ? 'text/javascript' : extname(path) === '.ttf' ? 'font/ttf' : 'application/octet-stream'
  return { path, type }
}
