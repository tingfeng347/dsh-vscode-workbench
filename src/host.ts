import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { HostContext } from './context.ts'
import { prioritizeCommitPatch, type CommitContext } from './commit-message.ts'
import type { FileDocument, FileEntry, GitBranch, GitChange, GitCommit, GitCommitFile, GitDiff, GitStatus, SearchMatch, SearchRequest } from './types.ts'
import { WorkbenchError } from './wire.ts'

const require = createRequire(import.meta.url)
const TEXT_LIMIT = 5 * 1024 * 1024
const PROCESS_TIMEOUT = 30_000

export function cwdFor(ctx: HostContext, sessionId: string): string {
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) throw new WorkbenchError('session-not-found', 'session not found', 404)
  const cwd = ctx.workingDirectory.get(session)
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

const PROJECT_SOURCE = /\.(?:[cm]?[jt]sx?|d\.ts)$/i
const PROJECT_CONFIG = new Set(['tsconfig.json', 'jsconfig.json', 'package.json'])
const PROJECT_SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.turbo', '.cache', 'vendor', 'third_party'])

/** Add a folder picked in the OS chooser to DSH's workspace list, reusing an existing registration. */
export async function openWorkspaceFromPicker(
  picker: import('./context.ts').DirectoryPickerLike | undefined,
  registry: import('./context.ts').WorkspaceRegistryLike | undefined,
  signal: AbortSignal,
): Promise<{ opened: boolean; workspace?: { id: string; path: string; title: string } }> {
  if (picker === undefined) throw new WorkbenchError('picker-unavailable', '当前环境没有可用的文件夹选择器', 409)
  const capability = picker.capability()
  if (capability.kind !== 'native' || capability.pick === undefined) throw new WorkbenchError('picker-browse', '浏览器模式暂不支持从工作台选择文件夹，请使用 DSH 侧栏的「添加工作区」', 409)
  const picked = await capability.pick(signal)
  if (picked === null) return { opened: false }
  if (registry === undefined) throw new WorkbenchError('workspace-unavailable', '工作区服务不可用', 503)
  const workspace = await registry.create(picked)
  return { opened: true, workspace: { id: workspace.id, path: workspace.path, title: workspace.title } }
}

/** TS/JS sources the editor's language service indexes, bounded so huge repos stay responsive. */
export async function projectSources(cwd: string, limits: { files?: number; bytes?: number; fileBytes?: number } = {}): Promise<{ files: { path: string; content: string }[]; truncated: boolean }> {
  const { files: maxFiles = 2000, bytes: maxBytes = 24 * 1024 * 1024, fileBytes = 512 * 1024 } = limits
  const { root } = await workspacePath(cwd, '')
  const files: { path: string; content: string }[] = []; let total = 0; let truncated = false
  const queue = [root]
  while (queue.length > 0) {
    const directory = queue.shift()!
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) { if (!PROJECT_SKIP.has(entry.name) && !entry.name.startsWith('.')) queue.push(full); continue }
      if (!entry.isFile() || !(PROJECT_SOURCE.test(entry.name) || PROJECT_CONFIG.has(entry.name))) continue
      const info = await stat(full).catch(() => undefined)
      if (info === undefined || info.size > fileBytes) continue
      if (files.length >= maxFiles || total + info.size > maxBytes) { truncated = true; return { files, truncated } }
      const content = await readFile(full, 'utf8').catch(() => undefined)
      if (content === undefined) continue
      total += info.size; files.push({ path: relativePath(root, full), content })
    }
  }
  return { files, truncated }
}

export async function listFiles(cwd: string, path: string): Promise<FileEntry[]> {
  const { root, absolute } = await workspacePath(cwd, path)
  const values = await readdir(absolute, { withFileTypes: true })
  const rows = await Promise.all(values.filter(item => item.name !== '.git').map(async item => {
    const full = join(absolute, item.name)
    if (!item.isSymbolicLink()) return { name: item.name, path: relativePath(root, full), kind: item.isDirectory() ? 'directory' as const : 'file' as const }
    const actual = await realpath(full).catch(() => undefined)
    if (actual === undefined || !inside(root, actual)) return undefined
    const info = await stat(full)
    const kind = info.isDirectory() ? 'directory' as const : 'file' as const
    return { name: item.name, path: relativePath(root, full), kind, size: info.size, mtimeMs: info.mtimeMs }
  }))
  return rows.filter(row => row !== undefined).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
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

const pendingSaves = new Map<string, Promise<void>>()

export async function saveDocument(cwd: string, path: string, content: string, expected: string): Promise<FileDocument> {
  const resolved = await workspacePath(cwd, path)
  const absolute = await realpath(resolved.absolute)
  const previous = pendingSaves.get(absolute) ?? Promise.resolve()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  pendingSaves.set(absolute, pending)
  await previous
  let temp: string | undefined
  try {
    const checkRevision = async () => {
      const checked = await workspacePath(cwd, path)
      if (await realpath(checked.absolute) !== absolute || (await readDocument(cwd, path)).revision !== expected) {
        throw new WorkbenchError('revision-conflict', 'file changed on disk; reload before saving', 409)
      }
    }
    await checkRevision()
    const info = await stat(absolute)
    temp = join(dirname(absolute), `.${randomUUID()}.dsh-vscode.tmp`)
    const handle = await open(temp, 'wx', info.mode & 0o777)
    try {
      await handle.writeFile(content, { encoding: 'utf8' })
      await handle.chmod(info.mode & 0o777)
    } finally { await handle.close() }
    await checkRevision()
    await rename(temp, absolute)
    return await readDocument(cwd, path)
  } finally {
    try { if (temp !== undefined) await rm(temp, { force: true }) }
    finally {
      release()
      if (pendingSaves.get(absolute) === pending) pendingSaves.delete(absolute)
    }
  }
}

export async function createEntry(cwd: string, path: string, kind: 'file' | 'directory'): Promise<void> {
  const { absolute } = await workspacePath(cwd, path, true)
  if (kind === 'directory') await mkdir(absolute)
  else { const handle = await open(absolute, 'wx'); await handle.close() }
}

/** Write an uploaded file into an existing workspace directory without overwriting files. */
export async function uploadFile(cwd: string, directory: string, name: string, content: Buffer): Promise<FileEntry> {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new WorkbenchError('filename-invalid', 'uploaded file name is invalid')
  const targetPath = directory === '' ? name : `${directory}/${name}`
  const { root, absolute } = await workspacePath(cwd, targetPath, true)
  const handle = await open(absolute, 'wx')
  try { await handle.writeFile(content) } finally { await handle.close() }
  const info = await lstat(absolute)
  return { name, path: relativePath(root, absolute), kind: 'file', size: info.size, mtimeMs: info.mtimeMs }
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
  const { root, absolute } = await workspacePath(cwd, path)
  if (absolute === root) throw new WorkbenchError('root-delete', 'cannot delete workspace root', 403)
  await rm(absolute, { recursive: true, force: false })
}

const IMAGE_TYPES:Record<string,string>={'.avif':'image/avif','.bmp':'image/bmp','.gif':'image/gif','.ico':'image/x-icon','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'}
const PREVIEW_TYPES:Record<string,string>={...IMAGE_TYPES,'.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.odt':'application/vnd.oasis.opendocument.text','.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xlsm':'application/vnd.ms-excel.sheet.macroEnabled.12','.ods':'application/vnd.oasis.opendocument.spreadsheet','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.pptm':'application/vnd.ms-powerpoint.presentation.macroEnabled.12'}
/** Resolve an image inside the workspace for protected browser preview. */
export async function workspaceImage(cwd:string,path:string):Promise<{path:string;type:string}>{const resolved=await workspacePath(cwd,path);const type=IMAGE_TYPES[extname(resolved.absolute).toLowerCase()];if(type===undefined)throw new WorkbenchError('unsupported-media','file is not a supported image',415);return {path:resolved.absolute,type}}
/** Resolve a supported preview file inside the workspace. */
export async function workspacePreviewFile(cwd:string,path:string):Promise<{path:string;type:string}>{const resolved=await workspacePath(cwd,path);const type=PREVIEW_TYPES[extname(resolved.absolute).toLowerCase()];if(type===undefined)throw new WorkbenchError('unsupported-media','file is not a supported preview format',415);return {path:resolved.absolute,type}}

/** Resolve a regular workspace file for drag-out downloads. */
export async function workspaceDownloadFile(cwd:string,path:string):Promise<{path:string;name:string;size:number}>{const resolved=await workspacePath(cwd,path);const info=await stat(resolved.absolute);if(!info.isFile())throw new WorkbenchError('not-file','only files can be downloaded',400);return {path:resolved.absolute,name:basename(resolved.absolute),size:info.size}}

/** Resolve the PDF.js worker shipped with this plugin's runtime dependency. */
export function pdfWorkerAsset(): { path: string; type: string } {
  return { path: require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'), type: 'text/javascript; charset=utf-8' }
}

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
      matches.push({ path: event.data.path.text.replace(/\\/g, '/').replace(/^\.\//, ''), line: event.data.line_number ?? 1, column: hit.start + 1, preview: event.data.lines.text.trimEnd(), match: hit.match?.text ?? '' })
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

async function commitParent(repository: string, hash: string): Promise<string | undefined> {
  const parent=await run('git',['rev-parse','--verify',`${hash}^1`],repository)
  return parent.code===0?parent.stdout.trim():undefined
}

async function commitFiles(repository: string, hash: string, parent: string | undefined): Promise<GitCommitFile[]> {
  const result = parent!==undefined
    ? await run('git',['diff','--name-status','-z','-M',parent,hash,'--'],repository)
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
  const records = result.stdout.split('\0')
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    if (record.startsWith('# branch.head ')) branch = record.slice(14)
    else if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record); ahead = Number(match?.[1] ?? 0); behind = Number(match?.[2] ?? 0)
    } else if (record.startsWith('? ')) changes.push({ path: record.slice(2), index: '?', worktree: '?', staged: false, untracked: true })
    else if (record.startsWith('1 ') || record.startsWith('2 ') || record.startsWith('u ')) {
      const renamed = record.startsWith('2 ')
      const parts = record.split(' '); const xy = parts[1] ?? '..'
      const path = parts.slice(renamed ? 9 : record.startsWith('u ') ? 10 : 8).join(' ')
      const originalPath = renamed ? records[++index] : undefined
      changes.push({ path, ...(originalPath === undefined ? {} : { originalPath }), index: xy[0] ?? '.', worktree: xy[1] ?? '.', staged: xy[0] !== '.', untracked: false })
    }
  }
  return { repository, branch, ahead, behind, changes }
}

/** Collect the staged (or working-tree) changes and recent subjects used to draft a commit message. */
export async function gitCommitContext(cwd: string, limit = 64_000): Promise<CommitContext> {
  const status = await gitStatus(cwd)
  if (status.changes.length === 0) throw new WorkbenchError('no-changes', '没有可提交的更改。', 409)
  const files = status.changes.map(change => change.untracked ? `${change.path} (新增)` : change.path)
  const recentResult = await run('git', ['log', '-n', '5', '--pretty=format:%s'], status.repository)
  const recent = recentResult.code === 0 ? recentResult.stdout.split('\n').map(subject => subject.trim()).filter(Boolean) : []
  const staged = await run('git', ['diff', '-U0', '--cached', '--no-ext-diff', '--no-color', '--'], status.repository)
  if (staged.code !== 0) throw new WorkbenchError('git-failed', staged.stderr || staged.stdout, 409)
  let patch = staged.stdout
  if (patch.trim() === '') {
    const tracked = await run('git', ['diff', '-U0', '--no-ext-diff', '--no-color', '--'], status.repository)
    if (tracked.code !== 0) throw new WorkbenchError('git-failed', tracked.stderr || tracked.stdout, 409)
    patch = tracked.stdout
    const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null'
    for (const change of status.changes.filter(item => item.untracked).slice(0, 20)) {
      const diff = await run('git', ['diff', '-U0', '--no-index', '--no-color', '--', nullFile, change.path], status.repository)
      if (diff.stdout.trim() !== '') patch += `\n${diff.stdout.slice(0, 4_000)}`
      if (patch.length >= limit * 2) break
    }
  }
  const bounded = prioritizeCommitPatch(patch, limit)
  return { repository: status.repository, branch: status.branch, files, recent, patch: bounded.patch, truncated: bounded.truncated }
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
    case 'commit': {
      const status = await gitStatus(cwd)
      if (!status.changes.some(change => change.index !== '.' && change.index !== '?')) {
        throw new WorkbenchError('no-staged-changes', '没有已暂存的更改。请先暂存要提交的文件。', 409)
      }
      args = ['commit', '-m', value ?? '']
      break
    }
    case 'commit.amend': args = ['commit', '--amend', '-m', value ?? '']; break
    case 'push': {
      let pushed = await run('git', ['push'], repository)
      if (pushed.code !== 0 && /no upstream branch|has no upstream/i.test(pushed.stderr)) {
        const branch = (await gitStatus(cwd)).branch
        pushed = await run('git', ['push', '--set-upstream', 'origin', branch], repository)
      }
      if (pushed.code !== 0) throw new WorkbenchError('git-failed', pushed.stderr || pushed.stdout, 409)
      return gitStatus(cwd)
    }
    case 'sync': {
      const pulled = await run('git', ['pull', '--rebase'], repository)
      if (pulled.code !== 0) throw new WorkbenchError('git-failed', pulled.stderr || pulled.stdout, 409)
      let pushed = await run('git', ['push'], repository)
      if (pushed.code !== 0 && /no upstream branch|has no upstream/i.test(pushed.stderr)) {
        const branch = (await gitStatus(cwd)).branch
        pushed = await run('git', ['push', '--set-upstream', 'origin', branch], repository)
      }
      if (pushed.code !== 0) throw new WorkbenchError('git-failed', pushed.stderr || pushed.stdout, 409)
      return gitStatus(cwd)
    }
    case 'branch.create': args = ['switch', '-c', value ?? '']; break
    case 'branch.switch': args = ['switch', value ?? '']; break
    case 'branch.list': {
      const refs = await run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repository)
      if (refs.code !== 0) throw new WorkbenchError('git-failed', refs.stderr, 500)
      const worktrees = await run('git', ['worktree', 'list', '--porcelain'], repository)
      const used = new Map<string, string>()
      if (worktrees.code === 0) {
        const same = (a: string, b: string) => normalize(a) === normalize(b) || process.platform === 'win32' && normalize(a).toLowerCase() === normalize(b).toLowerCase()
        let worktree = ''
        for (const line of worktrees.stdout.split('\n')) {
          if (line.startsWith('worktree ')) worktree = line.slice('worktree '.length).trim()
          else if (line.startsWith('branch refs/heads/')) {
            const name = line.slice('branch refs/heads/'.length).trim()
            if (name !== '' && !same(worktree, repository)) used.set(name, worktree)
          }
        }
      }
      return refs.stdout.split('\n').filter(Boolean).map(name => ({ name, ...(used.has(name) ? { worktree: used.get(name) } : {}) })) satisfies GitBranch[]
    }
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
    case 'commit.files': { const hash=validateCommitHash(value); return commitFiles(repository, hash, await commitParent(repository, hash)) }
    case 'commit.file.diff': {
      const hash=validateCommitHash(value);const target=validateGitPath(repository,path);const parent=await commitParent(repository,hash);const files=await commitFiles(repository,hash,parent);const file=files.find(item=>item.path===target)
      if (file===undefined) throw new WorkbenchError('not-found','file is not part of the commit',404)
      // Spawning git is slow on Windows, so the patch and both blobs are read concurrently.
      const [shown,original,modified]=await Promise.all([
        parent!==undefined
          ? run('git',['diff','--no-ext-diff','--find-renames','--patch','--no-color',parent,hash,'--',file.previousPath??target,target],repository)
          : run('git',['show','--no-ext-diff','--find-renames','--format=','--patch','--no-color',hash,'--',file.previousPath??target,target],repository),
        file.status==='A'||parent===undefined?'':gitObject(repository,`${parent}:${file.previousPath??target}`),
        file.status==='D'?'':gitObject(repository,`${hash}:${target}`),
      ])
      if(shown.code!==0)throw new WorkbenchError('git-failed',shown.stderr||shown.stdout,409)
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

/** Browser build of SheetJS served as an asset so the client bundle stays free of Node builtins. */
export function xlsxAsset(): { path: string; type: string } {
  const packageRoot = dirname(require.resolve('xlsx/package.json'))
  return { path: resolve(packageRoot, 'dist', 'xlsx.full.min.js'), type: 'text/javascript; charset=utf-8' }
}

export function monacoAsset(raw: string): { path: string; type: string } {
  const packageRoot = dirname(require.resolve('monaco-editor/package.json'))
  const path = resolve(packageRoot, 'min', raw)
  const root = resolve(packageRoot, 'min')
  if (!inside(root, path)) throw new WorkbenchError('asset-invalid', 'invalid Monaco asset path', 403)
  const type = extname(path) === '.css' ? 'text/css' : extname(path) === '.js' ? 'text/javascript' : extname(path) === '.ttf' ? 'font/ttf' : 'application/octet-stream'
  return { path, type }
}

/** Resolve a vscode-icons SVG shipped by @vscode-icons/vscode-icons-api. */
export function fileIconAsset(raw: string): { path: string; type: string } {
  if (!/^[a-z0-9_-]+\.svg$/i.test(raw)) throw new WorkbenchError('asset-invalid', 'invalid file icon path', 403)
  const packageRoot = dirname(require.resolve('@vscode-icons/vscode-icons-api/package.json'))
  return { path: resolve(packageRoot, 'icons', raw), type: 'image/svg+xml' }
}
