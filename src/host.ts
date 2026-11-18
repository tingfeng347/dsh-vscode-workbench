import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { HostContext } from './context.ts'
import { prioritizeCommitPatch, type CommitContext } from './commit-message.ts'
import type { FileDocument, FileEntry, GitBlameRange, GitBlameSource, GitBranch, GitChange, GitCommit, GitCommitFile, GitConflictVersions, GitDiff, GitLineBlame, GitStatus, SearchMatch, SearchRequest } from './types.ts'
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
export function run(command: string, args: string[], cwd: string, timeout = PROCESS_TIMEOUT, signal?: AbortSignal, input?: string): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true })
    let stdout = ''; let stderr = ''; let settled = false
    const timer = setTimeout(() => { child.kill(); if (!settled) reject(new WorkbenchError('timeout', `${command} timed out`, 504)) }, timeout)
    const abort = () => { child.kill(); if (!settled) { settled = true; clearTimeout(timer); reject(new WorkbenchError('cancelled', `${command} cancelled`, 499)) } }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdin.on('error', () => { /* Git can reject an input patch before reading it. */ })
    child.stdin.end(input)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
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
  return parseCommitFiles(result.stdout)
}

function parseCommitFiles(output: string): GitCommitFile[] {
  const tokens = output.split('\0').filter(Boolean); const files: GitCommitFile[] = []
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++] ?? ''; const code = status[0] ?? ''
    if (code === 'R' || code === 'C') { const previousPath=tokens[index++]??'';const path=tokens[index++]??'';files.push({path,previousPath,status:code}) }
    else { const path=tokens[index++]??'';files.push({path,status:code}) }
  }
  return files
}

async function revisionDiff(repository: string, file: GitCommitFile, after: string, before?: string): Promise<GitDiff> {
  const paths = [...new Set([file.previousPath ?? file.path, file.path])]
  const options = ['--no-ext-diff', '--no-textconv', '--find-renames', '--patch', '--no-color']
  const [diff, original, modified] = await Promise.all([
    checkedGit(repository, ['--literal-pathspecs', ...(before === undefined
      ? ['show', ...options, '--format=', after, '--', ...paths]
      : ['diff', ...options, before, after, '--', ...paths])]),
    file.status === 'A' || before === undefined ? '' : gitObject(repository, `${before}:${paths[0]}`),
    file.status === 'D' ? '' : gitObject(repository, `${after}:${file.path}`),
  ])
  return { diff, original, modified, blame: {
    original: original && before ? {kind:'commit',path:paths[0]!,revision:before} : undefined,
    modified: modified ? {kind:'commit',path:file.path,revision:after} : undefined,
  }}
}

async function checkedGit(repository: string, args: string[]): Promise<string> {
  const result = await run('git', args, repository)
  if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 409)
  return result.stdout
}

async function resolveCommit(repository: string, ref: string): Promise<string> {
  return (await checkedGit(repository, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim()
}

async function gitHead(repository: string): Promise<string | undefined> {
  const result = await run('git', ['rev-parse', '--verify', 'HEAD'], repository)
  return result.code === 0 ? result.stdout.trim() : undefined
}

function blameDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function snapshotBlame(kind: 'index' | 'worktree', path: string, text: string, revision?: string, historyPath?: string): GitBlameSource | undefined {
  return text ? { kind, path, revision, historyPath, digest:blameDigest(text) } : undefined
}

export async function gitBlameLine(cwd: string, value: unknown, line: unknown, signal?: AbortSignal): Promise<GitLineBlame> {
  return (await gitBlameRange(cwd,value,line,line,signal)).lines[0]!
}

export async function gitBlameRange(cwd: string, value: unknown, startLine: unknown, endLine: unknown, signal?: AbortSignal): Promise<GitBlameRange> {
  signal?.throwIfAborted()
  if (typeof startLine !== 'number' || typeof endLine !== 'number' || !Number.isSafeInteger(startLine) ||
      !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > TEXT_LIMIT || endLine - startLine >= 128 ||
      value === null || typeof value !== 'object') throw new WorkbenchError('bad-request', 'invalid Git line selection')
  const uniform = (kind: 'uncommitted' | 'unavailable'): GitBlameRange => ({
    startLine, lines: Array.from({length:endLine-startLine+1},()=>({kind} as GitLineBlame)),
  })
  const source = value as Record<string, unknown>
  if (source.kind === 'untracked') return uniform('uncommitted')
  if (source.kind !== 'commit' && source.kind !== 'index' && source.kind !== 'worktree' && source.kind !== 'document') {
    throw new WorkbenchError('bad-request', 'invalid Git blame source')
  }
  const repository = await gitRoot(cwd).catch(error=>{
    if (source.kind === 'document' && error instanceof WorkbenchError && error.code === 'not-repository') return undefined
    throw error
  })
  if (!repository) return uniform('unavailable')
  const pathField = (item: unknown) => validateGitPath(repository, typeof item === 'string' && !item.includes('\0') ? item : undefined)
  const workspaceFile = source.kind === 'document' ? await workspacePath(cwd, typeof source.path === 'string' ? source.path : '') : undefined
  const path = pathField(workspaceFile ? relativePath(repository,workspaceFile.absolute) : source.path)
  const previousPath = (source.kind === 'index' || source.kind === 'worktree') && source.historyPath !== undefined
    ? pathField(source.historyPath) : undefined
  const baseline = source.kind === 'document' ? await gitHead(repository) : source.kind === 'commit' || source.revision !== undefined
    ? validateCommitHash(typeof source.revision === 'string' ? source.revision : undefined)
    : undefined
  let input: string | undefined
  if (source.kind === 'document') {
    const document = await readDocument(repository,path)
    if (document.revision !== source.revision) throw new WorkbenchError('stale-diff', '文件内容已变化，请重新加载文件。',409)
    if (document.binary || document.tooLarge || document.content === '') return uniform('unavailable')
    input = document.content
  } else if (source.kind !== 'commit') {
    if (typeof source.digest !== 'string' || !/^[a-f0-9]{64}$/.test(source.digest)) throw new WorkbenchError('bad-request', 'invalid Git snapshot')
    input = source.kind === 'index' ? await gitObject(repository, `:0:${path}`) : await readDocument(repository,path).then(file=>file.content, error=>{
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    })
    if (blameDigest(input) !== source.digest) throw new WorkbenchError('stale-diff', '文件内容已变化，请重新打开对比。',409)
  }
  let historyPath = path
  if (input !== undefined) {
    if (!baseline) return uniform('uncommitted')
    // Older Git versions accept --contents only with the implicit HEAD.
    if (source.kind !== 'document' && await gitHead(repository) !== baseline) {
      throw new WorkbenchError('stale-diff', '当前提交已变化，请重新打开对比。', 409)
    }
    const hasBlob = async (target: string) => {
      signal?.throwIfAborted()
      const object = await run('git', ['cat-file', '-t', `${baseline}:${target}`], repository, PROCESS_TIMEOUT, signal)
      return object.code === 0 && object.stdout.trim() === 'blob'
    }
    if (!await hasBlob(path)) {
      signal?.throwIfAborted()
      const renamed = previousPath ?? parseCommitFiles(await checkedGit(repository, [
        'diff', '--cached', '--name-status', '-z', '-M', baseline, '--',
      ])).find(file=>file.path===path && file.status==='R')?.previousPath
      if (!renamed || !await hasBlob(renamed)) return uniform('uncommitted')
      historyPath = renamed
    }
  }
  signal?.throwIfAborted()
  const result = await run('git', [
    '--literal-pathspecs', 'blame', '--porcelain', '-L', `${startLine},${endLine}`,
    ...(input === undefined ? [baseline!] : ['--contents', '-']), '--', historyPath,
  ], repository, PROCESS_TIMEOUT, signal, input)
  if (input !== undefined && await gitHead(repository) !== baseline) {
    throw new WorkbenchError('stale-diff', '当前提交已变化，请重新打开文件或对比。', 409)
  }
  if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 409)
  const commits = new Map<string, GitLineBlame>()
  const lines = new Map<number, GitLineBlame>()
  let hash = '', line = 0, author = '', timestamp = 0, subject = ''
  for (const text of result.stdout.split('\n')) {
    if (text.startsWith('\t') && hash) {
      const blame = commits.get(hash) ?? (/^0+$/.test(hash)
        ? {kind:'uncommitted'} : {kind:'commit',hash,author,timestamp,subject})
      commits.set(hash,blame)
      lines.set(line,blame)
      hash = ''
      continue
    }
    const header = !hash && /^([a-f0-9]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(text)
    if (header) {
      hash = header[1]!
      line = Number(header[2])
      author = ''; timestamp = 0; subject = ''
    } else if (text.startsWith('author ')) author = text.slice(7)
    else if (text.startsWith('author-time ')) timestamp = Number(text.slice(12))
    else if (text.startsWith('summary ')) subject = text.slice(8)
  }
  if (lines.size !== endLine-startLine+1) throw new WorkbenchError('git-failed', 'Git 未返回所选行的提交信息。', 409)
  return {startLine,lines:Array.from({length:endLine-startLine+1},(_,offset)=>lines.get(startLine+offset)!)}
}

function gitSelection(value: string | undefined, fields: number, allowEmptyLast = false): string[] {
  let selection: unknown
  try { selection = JSON.parse(value ?? '') } catch { /* Report the same error for malformed selections. */ }
  if (!Array.isArray(selection) || selection.length !== fields || !selection.every((item, index) => typeof item === 'string' && (item.length > 0 || allowEmptyLast && index === fields - 1) && !item.includes('\0'))) {
    throw new WorkbenchError('bad-request', 'invalid Git selection')
  }
  return selection
}

function worktreeDiffArgs(path: string, staged: boolean): string[] {
  return ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', ...(staged ? ['--cached'] : []), '--', path]
}

function stagingHunks(patch: string) {
  const [header = '', ...hunks] = patch.split(/(?=^@@ -)/m)
  if ((header.match(/^diff --git /gm)?.length ?? 0) !== 1 ||
      !/^--- "?a\//m.test(header) || !/^\+\+\+ "?b\//m.test(header) ||
      /^(?:old mode |new mode |rename from |copy from )/m.test(header)) return
  if (hunks.length === 0) return
  const revision = createHash('sha256').update(patch).digest('hex')
  return { header, hunks, revision }
}

async function gitOperation(repository: string): Promise<GitStatus['operation']> {
  const markers = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
  const paths = await checkedGit(repository, ['rev-parse', ...markers.flatMap(marker => ['--git-path', marker])])
  const exists = await Promise.all(paths.trimEnd().split('\n').map(path=>access(resolve(repository, path)).then(()=>true,()=>false)))
  if (exists[0] || exists[1]) return 'rebase'
  if (exists[2]) return 'merge'
  if (exists[3]) return 'cherry-pick'
  if (exists[4]) return 'revert'
}

function parseGitLog(output: string): GitCommit[] {
  return output.split('\0').filter(record=>record.trim()!=='').map(record => {
    const [rawHash = '', parents = '', author = '', date = '', subject = '', refs = ''] = record.split('\x1f')
    return { hash: rawHash.trim(), parents: parents.split(' ').filter(Boolean), author, date, subject, refs: refs.split(',').map(item => item.trim()).filter(Boolean) }
  })
}

const GIT_LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x00'

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const repository = await gitRoot(cwd)
  const [result, operation] = await Promise.all([
    run('git', ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], repository),
    gitOperation(repository),
  ])
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
      changes.push({ path, ...(originalPath === undefined ? {} : { originalPath }), index: xy[0] ?? '.', worktree: xy[1] ?? '.', staged: xy[0] !== '.', untracked: false, ...(record.startsWith('u ') ? { conflicted: true } : {}) })
    }
  }
  return { repository, branch, ahead, behind, changes, ...(operation ? { operation } : {}) }
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
    case 'hunk.stage':
    case 'hunk.unstage': {
      const target = validateGitPath(repository, path)
      const [expected, rawIndex] = gitSelection(value, 2)
      if (!/^\d+$/.test(rawIndex!)) throw new WorkbenchError('bad-request', 'invalid hunk index')
      const reverse = action === 'hunk.unstage'
      const patch = stagingHunks(await checkedGit(repository, worktreeDiffArgs(target, reverse)))
      const hunk = patch?.hunks[Number(rawIndex)]
      if (patch === undefined || patch.revision !== expected || hunk === undefined) {
        throw new WorkbenchError('revision-conflict', '差异已变化，请重新打开文件差异后重试', 409)
      }
      const result = await run('git', ['apply', '--cached', ...(reverse ? ['--reverse'] : []), '--'], repository, PROCESS_TIMEOUT, undefined, patch.header + hunk)
      if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 409)
      return gitAction(cwd, 'diff', target, reverse ? 'staged' : 'worktree')
    }
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
    case 'branch.rename': {
      const [current, next] = gitSelection(value, 2)
      args = ['branch', '-m', '--', current!, next!]
      break
    }
    case 'branch.delete': args = ['branch', '-d', '--', value ?? '']; break
    case 'tag.create': args = ['tag', '--', value ?? '', await resolveCommit(repository, path ?? 'HEAD')]; break
    case 'tag.delete': args = ['tag', '-d', '--', value ?? '']; break
    case 'branch.switch': args = ['switch', '--', value ?? '']; break
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
    case 'ref.resolve': return resolveCommit(repository, value ?? '')
    case 'commit.details':
      return parseGitLog(await checkedGit(repository, ['show', '-s', '--decorate=short', `--format=format:${GIT_LOG_FORMAT}`, await resolveCommit(repository, validateCommitHash(value))]))
    case 'refs':
      return (await checkedGit(repository, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']))
        .split('\n').filter(ref => ref && !ref.endsWith('/HEAD'))
    case 'log.all':
      return parseGitLog(await checkedGit(repository, ['log', '--all', '--topo-order', '--decorate=short', `--format=format:${GIT_LOG_FORMAT}`, '-n', '100']))
    case 'file.history': {
      const target = validateGitPath(repository, path)
      return parseGitLog(await checkedGit(repository, ['--literal-pathspecs', 'log', '--follow', '--decorate=short', `--format=format:${GIT_LOG_FORMAT}`, '-n', '100', '--', target]))
    }
    case 'file.blame': {
      const target = validateGitPath(repository, path)
      const document = await readDocument(repository, target)
      if (document.binary || document.tooLarge) throw new WorkbenchError('not-text', '仅支持 5 MiB 以内的文本文件')
      return checkedGit(repository, ['--no-pager', 'blame', '--date=short', '--', target])
    }
    case 'compare.files':
    case 'compare.diff': {
      const [from, to] = gitSelection(value, 2)
      const [before, after] = await Promise.all([
        resolveCommit(repository, from!),
        to === ':worktree:' ? undefined : resolveCommit(repository, to!),
      ])
      if (after === undefined) {
        const nameStatus = await checkedGit(repository, ['diff', '--name-status', '-z', '-M', before, '--'])
        const files = parseCommitFiles(nameStatus)
        if (action === 'compare.files') return files
        const target = validateGitPath(repository, path)
        const file = files.find(item=>item.path===target)
        if (!file) throw new WorkbenchError('not-found', 'file is not part of the comparison', 404)
        const [diff, original, modified] = await Promise.all([
          checkedGit(repository, ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', before, '--', ...new Set([file.previousPath??target,target])]),
          file.status === 'A' ? '' : gitObject(repository, `${before}:${file.previousPath??target}`),
          file.status === 'D' ? '' : readDocument(repository,target).then(document=>document.content),
        ])
        const head = modified ? await gitHead(repository) : undefined
        return { diff, original, modified, blame: {
          original: original ? {kind:'commit',path:file.previousPath??target,revision:before} : undefined,
          modified: snapshotBlame('worktree',target,modified,head,file.previousPath),
        }} satisfies GitDiff
      }
      const files = await commitFiles(repository, after, before)
      if (action === 'compare.files') return files
      const file = files.find(item => item.path === validateGitPath(repository, path))
      if (file === undefined) throw new WorkbenchError('not-found', 'file is not part of the comparison', 404)
      return revisionDiff(repository, file, after, before)
    }
    case 'stash.list': {
      const output = await checkedGit(repository, ['stash', 'list', '--format=%gd%x1f%H%x1f%gs%x00'])
      return output.split('\0').map(record=>record.trim()).filter(Boolean).map(record => {
        const [ref = '', hash = '', subject = ''] = record.split('\x1f')
        return { ref, hash, subject }
      })
    }
    case 'stash.push': args = ['stash', 'push', '--include-untracked', ...(value ? ['-m', value] : [])]; break
    case 'stash.apply':
    case 'stash.drop': {
      const [ref, hash] = gitSelection(value, 2)
      if (!/^stash@\{\d+\}$/.test(ref!) || await resolveCommit(repository, ref!) !== hash) {
        throw new WorkbenchError('revision-conflict', 'Stash 已变化，请刷新列表', 409)
      }
      args = action === 'stash.apply' ? ['stash', 'apply', '--index', hash!] : ['stash', 'drop', ref!]
      break
    }
    case 'fetch': args = ['fetch', '--all']; break
    case 'pull': args = ['-c', 'core.editor=true', 'pull', '--ff-only']; break
    case 'merge': args = ['-c', 'core.editor=true', 'merge', '--no-edit', await resolveCommit(repository, value ?? '')]; break
    case 'rebase': args = ['-c', 'core.editor=true', 'rebase', await resolveCommit(repository, value ?? '')]; break
    case 'cherry-pick':
    case 'revert': args = ['-c', 'core.editor=true', action, '--no-edit', await resolveCommit(repository, value ?? '')]; break
    case 'operation.continue':
    case 'operation.abort': {
      const operation = await gitOperation(repository)
      if (operation === undefined || operation !== value) throw new WorkbenchError('revision-conflict', 'Git 操作状态已变化，请刷新', 409)
      args = ['-c', 'core.editor=true', operation, action === 'operation.continue' ? '--continue' : '--abort']
      break
    }
    case 'conflict.versions':
    case 'conflict.save':
    case 'conflict.diff':
    case 'conflict.ours':
    case 'conflict.theirs': {
      const target = validateGitPath(repository, path)
      const entries = await checkedGit(repository, ['--literal-pathspecs', 'ls-files', '-u', '--', target])
      if (!entries) throw new WorkbenchError('revision-conflict', '该文件已没有待解决的冲突', 409)
      const revision = createHash('sha256').update(entries).digest('hex')
      if (action === 'conflict.save') {
        const [expectedStages, expectedFile, content] = gitSelection(value, 3, true)
        if (expectedStages !== revision) throw new WorkbenchError('revision-conflict', '冲突版本已变化，请重新加载', 409)
        const document = await readDocument(repository, target)
        if (!(await lstat(resolve(repository,target))).isFile() || document.binary || document.tooLarge ||
            !entries.split('\n').filter(Boolean).every(entry=>/^100(?:644|755) /.test(entry)) ||
            Buffer.byteLength(content!) > TEXT_LIMIT) {
          throw new WorkbenchError('not-text', '仅支持合并普通文本文件')
        }
        if (/^(?:<{7,}(?: |$)|={7,}$|>{7,}(?: |$)|\|{7,}(?: |$))/m.test(content!)) {
          throw new WorkbenchError('unresolved-markers', '结果中仍有冲突标记')
        }
        await saveDocument(repository, target, content!, expectedFile!)
        args = ['--literal-pathspecs', 'add', '--', target]
        break
      }
      if (action === 'conflict.versions') {
        const regular = entries.split('\n').filter(Boolean).every(entry=>/^100(?:644|755) /.test(entry))
        const document = regular ? await readDocument(repository, target).catch(error=>{
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        }) : undefined
        if (!document || document.binary || document.tooLarge) return { path: target, revision } satisfies GitConflictVersions
        const stages = await Promise.all([1, 2, 3].map(async stage=>{
          const spec = `:${stage}:${target}`
          if (!entries.split('\n').some(entry=>entry.split('\t')[0]?.endsWith(` ${stage}`))) return undefined
          const size = Number(await checkedGit(repository, ['cat-file', '-s', spec]))
          if (size > TEXT_LIMIT) return undefined
          return checkedGit(repository, ['cat-file', 'blob', spec])
        }))
        if (stages.some(text=>text?.includes('\0'))) return { path: target, revision } satisfies GitConflictVersions
        return { path: target, revision, document, base: stages[0], ours: stages[1], theirs: stages[2] } satisfies GitConflictVersions
      }
      if (action === 'conflict.diff') {
        const [original, modified] = await Promise.all([gitObject(repository, `:2:${target}`), gitObject(repository, `:3:${target}`)])
        return { diff: '', original, modified } satisfies GitDiff
      }
      const ours = action === 'conflict.ours'
      const stage = ours ? 2 : 3
      if (!entries.split('\n').some(entry=>entry.split('\t')[0]?.endsWith(` ${stage}`))) {
        args = ['--literal-pathspecs', 'rm', '--force', '--', target]
        break
      }
      await checkedGit(repository, ['--literal-pathspecs', 'checkout', ours ? '--ours' : '--theirs', '--', target])
      args = ['--literal-pathspecs', 'add', '--', target]
      break
    }
    case 'log': {
      const head = await run('git', ['rev-parse', '--verify', 'HEAD'], repository)
      if (head.code !== 0) return []
      return parseGitLog(await checkedGit(repository, ['log', '--topo-order', '--decorate=short', `--format=format:${GIT_LOG_FORMAT}`, '-n', '100']))
    }
    case 'commit.show': {
      const hash = validateCommitHash(value)
      const result = await run('git', ['show', '--no-ext-diff', '--find-renames', '--format=fuller', '--stat', '--patch', '--no-color', hash], repository)
      if (result.code !== 0) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 409)
      return { diff: result.stdout, original: '', modified: result.stdout } satisfies GitDiff
    }
    case 'commit.files': { const hash=validateCommitHash(value); return commitFiles(repository, hash, await commitParent(repository, hash)) }
    case 'commit.file.diff': {
      const hash=await resolveCommit(repository,validateCommitHash(value));const target=validateGitPath(repository,path);const parent=await commitParent(repository,hash);const files=await commitFiles(repository,hash,parent);const file=files.find(item=>item.path===target)
      if (file===undefined) throw new WorkbenchError('not-found','file is not part of the commit',404)
      return revisionDiff(repository, file, hash, parent)
    }
    case 'diff': {
      const target = validateGitPath(repository, path)
      const untracked = value === 'untracked'
      const staged = value === 'staged'
      args = untracked
        ? ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', target]
        : worktreeDiffArgs(target, staged)
      break
    }
    default: throw new WorkbenchError('bad-action', `unknown Git action ${action}`)
  }
  if (args.some(arg => arg === '') && action !== 'commit') throw new WorkbenchError('bad-request', 'path or value is required')
  if (action === 'diff' && value === 'untracked') await workspacePath(repository, validateGitPath(repository, path))
  const result = await run('git', args, repository)
  const expectedUntrackedDifference = action === 'diff' && value === 'untracked' && result.code === 1
  if (result.code !== 0 && !expectedUntrackedDifference) throw new WorkbenchError('git-failed', result.stderr || result.stdout, 409)
  if(action!=='diff')return gitStatus(cwd)
  const target=validateGitPath(repository,path)
  const moved = value === 'staged' ? (await gitStatus(cwd)).changes.find(change=>change.path===target)?.originalPath : undefined
  const head = value === 'untracked' ? undefined : await gitHead(repository)
  const original=value==='untracked'||value==='staged'&&!head?'':await gitObject(repository,`${value==='staged'?`${head}:`:':0:'}${moved??target}`)
  const modified=value==='staged'?await gitObject(repository,`:${target}`):await readDocument(repository,target).then(file=>file.content,error=>{
    if (error instanceof WorkbenchError && error.code === 'not-file' || (error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  })
  const patch = value === 'untracked' ? undefined : stagingHunks(result.stdout)
  const staging: GitDiff['staging'] = patch && {
    mode: value === 'staged' ? 'staged' : 'worktree',
    revision: patch.revision,
    hunks: patch.hunks.map(hunk=>{
      const label = hunk.split('\n', 1)[0]!
      return { label, line: Math.max(1, Number(/\+(\d+)/.exec(label)?.[1] ?? 1)) }
    }),
  }
  const originalBlame = value === 'staged'
    ? original && head ? {kind:'commit' as const,path:moved??target,revision:head} : undefined
    : snapshotBlame('index',target,original,head)
  const modifiedBlame = value === 'untracked'
    ? modified ? {kind:'untracked' as const} : undefined
    : snapshotBlame(value === 'staged' ? 'index' : 'worktree',target,modified,head,moved)
  return {diff:result.stdout,original,modified,blame:{original:originalBlame,modified:modifiedBlame},...(staging ? { staging } : {})} satisfies GitDiff
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
