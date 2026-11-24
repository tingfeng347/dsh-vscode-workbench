/** DSH host plugin for the VS Code workbench. */
import { inspectReview, rejectReview, reviewFeed, reviewPath } from './review.ts'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { appendFileSync, lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { IncomingMessage } from 'node:http'
import { isAbsolute, join, join as joinPath, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import type { Duplex } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import chokidar from 'chokidar'
import { WebSocket, WebSocketServer } from 'ws'
import type { HostContext } from './context.ts'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { commitCatalogFromDsh, firstSupportedCommitModel, generateCommitMessage, loadCommitModelCatalog, loadCommitProviderModels, normalizeCommitModelSelection, normalizeCommitPreferences, type CommitModelCatalog, type CommitModelSelection, type DshChatModelCatalog } from './commit-message.ts'
import { codiconAsset, createEntry, cwdFor, deleteEntry, fileIconAsset, gitAction, gitBlameLine, gitBlameRange, gitCommitContext, gitPreviewFile, gitStatus, listFiles, monacoAsset, openWorkspaceFromPicker, pdfWorkerAsset, xlsxAsset, readDocument, projectSources, renameEntry, saveDocument, workspaceDownloadFile, replaceSearchResults, searchWorkspace, uploadFile, workspacePath, workspacePreviewFile } from './host.ts'
import { attachLanguageServerSocket, installLsp, lspStatuses, uninstallLsp } from './lsp.ts'
import { createDebugBridge } from './debug.ts'
import { generateInlineCompletion, INLINE_PREFIX_LIMIT, INLINE_SUFFIX_LIMIT, INLINE_TIMEOUT_MS, isInlineCompletionPath } from './inline-completion.ts'
import { officePdf, officePdfBuffer, officeStatus } from './office.ts'
import { WorkspaceSite } from './site.ts'
import type { GitStatus, SearchFileEdits, SearchRequest } from './types.ts'
import { watchIgnore, workspaceWatchIgnores } from './watch-ignore.ts'
import { isStaleManifest } from './workspace-watch.ts'
import { createWorkspaceWatcher } from './workspace-watch-host.ts'
import { connectSsh, disconnectSsh, getLiveSshConnection, liveSshConnections, listSshHosts, shellQuote, sshEnvironment, sshGit, sshCreateEntry, sshDeleteEntry, sshRenameEntry, sshUploadFile, sshListFiles, sshOpenFileDownload, sshOpenFilePreview, sshReadDocument, sshReadPreviewFile, sshReplaceSearchResults, sshSaveDocument, sshSearchWorkspace, sshStatus, sshTargetArguments, switchSshWorkspace } from './ssh.ts'
import { readBinaryBody, readBody, send, sendError, stringField, authorize, WorkbenchError } from './wire.ts'

export { WorkbenchError } from './wire.ts'
export * from './types.ts'
export const name = 'dsh-vscode-workbench'

// DSH services used by the workbench when present; resolved through optional injection, never a hard dependency.
let dshDirectoryPicker: import('./context.ts').DirectoryPickerLike | undefined
let dshWorkspaceRegistry: import('./context.ts').WorkspaceRegistryLike | undefined
export const inject = ['webServer', 'sessions', 'connection', 'workingDirectory']

/** The DSH service that hands workspace paths to the desktop, mirroring its own preview actions. */
interface DesktopOpener {
  canOpenWorkspacePath?(): boolean
  openWorkspacePath?(request: { path: string; action?: 'reveal'; application?: string }, signal?: AbortSignal): Promise<{ opened: true }>
  workspacePathApplications?(request: { path: string }, signal?: AbortSignal): Promise<Array<{ id: string; name: string; default: boolean; icon: string | null }>>
}

async function stageRemoteDesktopFile(sessionId: string, connectionId: string, path: string, signal?: AbortSignal): Promise<string> {
  const file = await sshOpenFileDownload(sessionId, connectionId, path, signal)
  let directory: string | undefined
  file.child.stderr.resume()
  // Attach before opening the local file so an immediate spawn failure is observed.
  const result = new Promise<number | null>(resolve => {
    file.child.once('error', () => resolve(null))
    file.child.once('close', resolve)
  })
  try {
    if (file.size > 100 * 1024 * 1024) throw new WorkbenchError('too-large', '超过 100 MiB，请下载后打开。', 413)
    directory = await mkdtemp(join(tmpdir(), 'dvw-ssh-copy-'))
    const localPath = join(directory, file.name.replaceAll(/[/\\]/g, '_'))
    let received = 0
    await pipeline(file.child.stdout, async function* (stream) {
      for await (const chunk of stream) {
        received += chunk.length
        if (received > file.size) throw new WorkbenchError('file-changed', '复制时远程文件发生变化，请重试。', 409)
        yield chunk
      }
    }, createWriteStream(localPath, { flags: 'wx', mode: 0o600 }), { signal })
    if (await result !== 0 || received !== file.size) throw new WorkbenchError('ssh-failed', '远程文件复制未完成。', 502)
    const copiedDirectory = directory
    setTimeout(() => { void rm(copiedDirectory, { recursive: true, force: true }).catch(() => undefined) }, 60 * 60 * 1000).unref()
    return localPath
  } catch (error) {
    file.child.kill()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

const NATIVE_OPEN_TIMEOUT_MS = 15000

/** Deadlines for API calls that wait on an external process; everything else settles on its own. */
const API_DEADLINES: Record<string, number> = {
  'lsp.install': 10 * 60 * 1000,
  'lsp.uninstall': 10 * 60 * 1000,
}

function withDeadline<T>(work: Promise<T>, ms: number, method: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WorkbenchError('timeout', `${method} 超过 ${Math.round(ms / 1000)} 秒未返回`, 504)), ms)
    work.then(
      value => { clearTimeout(timer); resolve(value) },
      cause => { clearTimeout(timer); reject(cause) },
    )
  })
}

function stringArrayField(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new WorkbenchError('bad-request', `${key} must be a non-empty array of non-empty strings`)
  }
  return value as string[]
}

function remoteFileRef(path: string): { sessionIdConnection: string; remotePath: string } | undefined {
  if (!path.startsWith('ssh://')) return undefined
  let url: URL
  try { url = new URL(path) } catch { throw new WorkbenchError('path-invalid', 'SSH 文件路径无效') }
  const connectionId = url.hostname
  const remotePath = url.pathname.slice(1).split('/').map(decodeURIComponent).join('/')
  if (connectionId === '' || remotePath.includes('\0')) throw new WorkbenchError('path-invalid', 'SSH 文件路径无效')
  return { sessionIdConnection: connectionId, remotePath }
}

function currentChatCommitModel(ctx: HostContext, sessionId: string | undefined): CommitModelSelection | undefined {
  try {
    const session = sessionId === undefined ? undefined : ctx.sessions.get(sessionId)
    const projections = ctx.get('sessionProjections') as unknown as {
      stateOf(session: unknown, key: string): { pending?: { provider: string; model: string } | null } | undefined
    } | undefined
    const projection = session === undefined ? undefined : projections?.stateOf(session, 'modelSelection')
    const defaults = ctx.get('agentDefaultModel') as unknown as { currentSelection(): { provider: string; model: string } } | undefined
    const headerConfig = session?.requestHeader()?.config
    return firstSupportedCommitModel(projection?.pending, headerConfig, defaults?.currentSelection())
  } catch {
    return undefined
  }
}

async function loadChatModelCatalog(
  service: { modelCatalog(): Promise<DshChatModelCatalog> },
  signal?: AbortSignal,
): Promise<DshChatModelCatalog> {
  if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new Error('模型目录读取已取消')
  let timer: ReturnType<typeof setTimeout> | undefined
  let abortListener: (() => void) | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('读取 DSH 聊天模型目录超过 5 秒')), 5000)
  })
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(signal?.reason instanceof Error ? signal.reason : new Error('模型目录读取已取消'))
    if (signal?.aborted === true) abortListener()
    else signal?.addEventListener('abort', abortListener, { once: true })
  })
  try {
    return await Promise.race([service.modelCatalog(), timeout, aborted])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (abortListener !== undefined) signal?.removeEventListener('abort', abortListener)
  }
}

// The Explorer and Source Control can ask at the same time. Share pending reads only so
// a later refresh sees saves, external Git commands, and other changes to the repository.
const pendingGitStatuses = new Map<string, Promise<GitStatus>>()

function readGitStatus(cwd: string): Promise<GitStatus> {
  const pending = pendingGitStatuses.get(cwd)
  if (pending !== undefined) return pending
  const request = gitStatus(cwd).finally(() => {
    if (pendingGitStatuses.get(cwd) === request) pendingGitStatuses.delete(cwd)
  })
  pendingGitStatuses.set(cwd, request)
  return request
}

/** Evidence marker: if the new client bundle runs, it opens the debug socket on mount. */
function traceDebug(text: string): void {
  try { appendFileSync(joinPath(tmpdir(), 'dvw-api.log'), `${new Date().toISOString()} ${text}\n`) } catch { /* diagnosis only */ }
}

async function dispatch(ctx: HostContext, method: string, body: Record<string, unknown>, signal?: AbortSignal, site?: WorkspaceSite): Promise<unknown> {
  if (method === 'commit.models') {
    const llm: LlmRuntime | undefined = ctx.get('llm')
    if (llm === undefined) throw new WorkbenchError('llm-unavailable', 'DSH 的模型服务当前不可用。', 503)
    try {
      const sessionController = ctx.get('sessionController') as unknown as { modelCatalog(): Promise<DshChatModelCatalog> } | undefined
      let catalog: CommitModelCatalog | undefined
      if (sessionController !== undefined) {
        try {
          catalog = commitCatalogFromDsh(await loadChatModelCatalog(sessionController, signal))
        } catch (error) {
          if (signal?.aborted === true) throw error
        }
      }
      // Custom provider setups can expose an empty chat catalog; fall back to the LLM runtime instead
      // of failing the whole picker.
      if (catalog === undefined || catalog.models.length === 0) {
        const fallback = await loadCommitModelCatalog(llm, signal)
        if (fallback.models.length > 0) catalog = fallback
        else if (catalog === undefined) catalog = fallback
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      const sessionSelection = currentChatCommitModel(ctx, sessionId)
      const defaultModel = sessionSelection !== undefined && catalog.models.some(model => model.provider === sessionSelection.provider && model.model === sessionSelection.model)
        ? sessionSelection
        : catalog.defaultModel
      return { ...catalog, ...(defaultModel === undefined ? {} : { defaultModel }) }
    } catch (error) {
      throw new WorkbenchError('model-unavailable', error instanceof Error ? error.message : String(error), 503)
    }
  }
  const sessionId = stringField(body, 'sessionId'); const cwd = cwdFor(ctx, sessionId)
  switch (method) {
    case 'review.feed': {
      const session = ctx.sessions.get(sessionId)!
      const from = typeof body.from === 'number' && Number.isSafeInteger(body.from) && body.from >= 0 ? body.from : session.seq
      const feed = reviewFeed(session, from)
      const changes = []
      for (const change of feed.changes) {
        try { changes.push({ ...change, path: await reviewPath(cwd, change.path) }) }
        catch { /* Tools may modify files outside this workspace; never expose them here. */ }
      }
      return { ...feed, changes }
    }
    case 'review.inspect':
      return inspectReview(ctx.sessions.get(sessionId)!, cwd, stringField(body, 'path'), stringArrayField(body, 'ids'))
    case 'review.reject':
      return rejectReview(
        ctx.sessions.get(sessionId)!,
        cwd,
        stringField(body, 'path'),
        stringArrayField(body, 'ids'),
        stringField(body, 'revision'),
      )
    case 'workspace': return { cwd, name: cwd.split(/[\\/]/).at(-1) || cwd }
    case 'fs.list': {
      const path = stringField(body, 'path')
      const remote = remoteFileRef(path)
      if (remote !== undefined) return sshListFiles(sessionId, remote.sessionIdConnection, remote.remotePath, signal)
      return listFiles(cwd, path)
    }
    case 'fs.read': {
      const path = stringField(body, 'path')
      const remote = remoteFileRef(path)
      if (remote !== undefined) return { ...await sshReadDocument(sessionId, remote.sessionIdConnection, remote.remotePath, signal), path }
      return readDocument(cwd, path)
    }
    case 'fs.save': {
      const path = stringField(body, 'path')
      const remote = remoteFileRef(path)
      if (remote !== undefined) return { ...await sshSaveDocument(sessionId, remote.sessionIdConnection, remote.remotePath, stringField(body, 'content'), stringField(body, 'revision'), signal), path }
      return saveDocument(cwd, path, stringField(body, 'content'), stringField(body, 'revision'))
    }
    case 'fs.create':
    case 'fs.rename':
    case 'fs.delete': {
      const path = stringField(body, 'path')
      const remote = remoteFileRef(path)
      const connectionId = remote?.sessionIdConnection
      if (method === 'fs.create') {
        const kind = body.kind === 'directory' ? 'directory' : 'file'
        if (remote !== undefined && connectionId !== undefined) await sshCreateEntry(sessionId, connectionId, remote.remotePath, kind, signal)
        else await createEntry(cwd, path, kind)
      } else if (method === 'fs.delete') {
        if (remote !== undefined && connectionId !== undefined) await sshDeleteEntry(sessionId, connectionId, remote.remotePath, signal)
        else await deleteEntry(cwd, path)
      } else {
        const nextPath = stringField(body, 'nextPath')
        const next = remoteFileRef(nextPath)
        if (remote !== undefined && connectionId !== undefined && next?.sessionIdConnection === connectionId) {
          await sshRenameEntry(sessionId, connectionId, remote.remotePath, next.remotePath, signal)
        } else if (remote === undefined && next === undefined) await renameEntry(cwd, path, nextPath)
        else throw new WorkbenchError('path-invalid', '无法跨工作区移动文件')
      }
      return { ok: true }
    }
    case 'fs.applications': {
      const target = await workspacePath(cwd, stringField(body, 'path'))
      const opener = ctx.get('sessionController') as unknown as DesktopOpener | undefined
      if (opener?.canOpenWorkspacePath?.() !== true || opener.workspacePathApplications === undefined) {
        return { available: false, applications: [] }
      }
      const applications = await opener.workspacePathApplications({ path: target.absolute }, AbortSignal.timeout(NATIVE_OPEN_TIMEOUT_MS))
      return { available: true, applications }
    }
    case 'fs.openExternal': {
      const path = stringField(body, 'path')
      const remote = remoteFileRef(path)
      const opener = ctx.get('sessionController') as unknown as DesktopOpener | undefined
      if (opener?.canOpenWorkspacePath?.() !== true || opener.openWorkspacePath === undefined) {
        throw new WorkbenchError('open-unavailable', '当前 DSH 没有提供用本地应用打开文件的能力。', 503)
      }
      const application = typeof body.application === 'string' && body.application !== '' ? body.application : undefined
      const reveal = body.action === 'reveal'
      const absolute = remote === undefined
        ? (await workspacePath(cwd, path)).absolute
        : await stageRemoteDesktopFile(sessionId, remote.sessionIdConnection, remote.remotePath, signal)
      try {
        await opener.openWorkspacePath({
          path: absolute,
          ...(reveal ? { action: 'reveal' as const } : {}),
          ...(reveal || application === undefined ? {} : { application }),
        }, AbortSignal.timeout(NATIVE_OPEN_TIMEOUT_MS))
      } catch (error) {
        throw new WorkbenchError('open-failed', error instanceof Error ? error.message : String(error), 502)
      }
      return { opened: true }
    }
    case 'project.sources': return projectSources(cwd)
    case 'office.status': return officeStatus()
    case 'preview.site': {
      if (site === undefined) throw new WorkbenchError('site-unavailable', 'HTML 预览服务不可用', 503)
      return { url: await site.url(sessionId, stringField(body, 'path')) }
    }
    case 'workspace.open': return openWorkspaceFromPicker(dshDirectoryPicker, dshWorkspaceRegistry, AbortSignal.any([AbortSignal.timeout(10 * 60 * 1000), ...(signal === undefined ? [] : [signal])]))
    case 'lsp.status': return lspStatuses(cwd)
    case 'lsp.install': await installLsp(stringField(body, 'id'), signal); return lspStatuses(cwd)
    case 'lsp.uninstall': await uninstallLsp(stringField(body, 'id')); return lspStatuses(cwd)
    case 'search': return searchWorkspace(cwd, body as unknown as SearchRequest, signal)
    case 'search.replace':
      if (cwd !== stringField(body, 'cwd')) throw new WorkbenchError('workspace-changed', '工作区已切换，请重新搜索', 409)
      return replaceSearchResults(cwd, body.files as SearchFileEdits[])
    case 'ssh.hosts': return listSshHosts()
    case 'ssh.connections': return liveSshConnections(sessionId)
    case 'ssh.connect': return connectSsh(sessionId, {
      host: stringField(body, 'host'),
      ...(typeof body.user === 'string' && body.user !== '' ? { user: body.user } : {}),
      ...(typeof body.password === 'string' && body.password !== '' ? { password: body.password } : {}),
      ...(typeof body.port === 'number' || typeof body.port === 'string' ? { port: Number(body.port) } : {}),
      ...(typeof body.identityFile === 'string' && body.identityFile !== '' ? { identityFile: body.identityFile } : {}),
      ...(typeof body.workspace === 'string' && body.workspace !== '' ? { workspace: body.workspace } : {}),
      ...(typeof body.label === 'string' && body.label !== '' ? { label: body.label } : {}),
    })
    case 'ssh.status': return sshStatus(sessionId, stringField(body, 'connectionId'))
    case 'ssh.disconnect': return disconnectSsh(sessionId, stringField(body, 'connectionId'))
    case 'ssh.workspace': return switchSshWorkspace(sessionId, stringField(body, 'connectionId'), stringField(body, 'path'))
    case 'ssh.list': return sshListFiles(sessionId, stringField(body, 'connectionId'), stringField(body, 'path'), signal)
    case 'ssh.read': return sshReadDocument(sessionId, stringField(body, 'connectionId'), stringField(body, 'path'), signal)
    case 'ssh.save': return sshSaveDocument(sessionId, stringField(body, 'connectionId'), stringField(body, 'path'), stringField(body, 'content'), stringField(body, 'revision'), signal)
    case 'ssh.search': return sshSearchWorkspace(sessionId, stringField(body, 'connectionId'), body as unknown as SearchRequest, signal)
    case 'ssh.search.replace': return sshReplaceSearchResults(sessionId, stringField(body, 'connectionId'), body.files as SearchFileEdits[], signal)
    case 'ssh.git': return sshGit(sessionId, stringField(body, 'connectionId'), stringField(body, 'action'), typeof body.path === 'string' ? body.path : undefined, typeof body.value === 'string' ? body.value : undefined, signal)
    case 'git.status': return readGitStatus(cwd)
    case 'git.blameRange': return gitBlameRange(cwd, body.source, body.startLine, body.endLine, signal)
    case 'git.blameLine': return gitBlameLine(cwd, body.source, body.line, signal)
    case 'git.action': {
      pendingGitStatuses.delete(cwd)
      try {
        return await gitAction(cwd, stringField(body, 'action'), typeof body.path === 'string' ? body.path : undefined, typeof body.value === 'string' ? body.value : undefined)
      } finally {
        pendingGitStatuses.delete(cwd)
      }
    }
    case 'editor.inlineCompletion': {
      const path = stringField(body, 'path')
      const language = stringField(body, 'language')
      const prefix = stringField(body, 'prefix')
      const suffix = stringField(body, 'suffix')
      if (path.length === 0 || path.length > 4096 || !/^[\w+#.-]{1,64}$/.test(language) ||
          prefix.length > INLINE_PREFIX_LIMIT || suffix.length > INLINE_SUFFIX_LIMIT ||
          prefix.includes('\0') || suffix.includes('\0')) {
        throw new WorkbenchError('bad-request', '代码补全的上下文无效或超出长度限制。')
      }
      if (!isInlineCompletionPath(path)) return { text: '' }
      const target = await workspacePath(cwd, path)
      if (!isInlineCompletionPath(relative(target.root, await realpath(target.absolute)))) return { text: '' }
      const selection = body.provider !== undefined || body.model !== undefined
        ? normalizeCommitModelSelection(body.provider, body.model)
        : currentChatCommitModel(ctx, sessionId)
      if (selection === undefined) throw new WorkbenchError('model-unavailable', '请在工作台设置中选择可用的补全模型。', 409)
      const llm: LlmRuntime | undefined = ctx.get('llm')
      if (llm === undefined) throw new WorkbenchError('llm-unavailable', 'DSH 的模型服务当前不可用。', 503)
      const timeout = AbortSignal.timeout(INLINE_TIMEOUT_MS)
      const callSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
      try {
        return { text: await generateInlineCompletion(llm, selection, { path, language, prefix, suffix }, callSignal) }
      } catch {
        if (timeout.aborted) throw new WorkbenchError('completion-timeout', 'AI 代码补全超时。', 504)
        throw new WorkbenchError('completion-failed', '补全模型调用失败，请在工作台设置中确认模型可用。', 502)
      }
    }
    case 'git.commitMessage': {
      const hasExplicitSelection = body.provider !== undefined || body.model !== undefined
      const selection = hasExplicitSelection
        ? normalizeCommitModelSelection(body.provider, body.model)
        : currentChatCommitModel(ctx, sessionId)
      if (selection === undefined) {
        throw new WorkbenchError('model-unavailable', '无法读取 DSH 聊天当前使用的模型，请到 Workbench 设置中选择模型。', 409)
      }
      const llm: LlmRuntime | undefined = ctx.get('llm')
      if (llm === undefined) throw new WorkbenchError('llm-unavailable', 'DSH 的模型服务当前不可用。', 503)
      let provider
      try {
        provider = llm.listProviders().find(candidate => candidate.id === selection.provider)
      } catch (error) {
        throw new WorkbenchError('model-unavailable', `无法读取 DSH 模型来源：${error instanceof Error ? error.message : String(error)}`, 503)
      }
      if (provider === undefined) {
        throw new WorkbenchError('model-unavailable', `所选模型来源“${selection.provider}”当前不可用，请到设置重新选择。`, 409)
      }
      let models
      try {
        models = await loadCommitProviderModels(llm, provider, signal)
      } catch (error) {
        throw new WorkbenchError('model-unavailable', `无法读取“${provider.name}”的模型列表：${error instanceof Error ? error.message : String(error)}`, 503)
      }
      const selected = models.find(model => model.model === selection.model)
      if (selected === undefined) {
        throw new WorkbenchError('model-unavailable', `所选模型“${selection.model}”当前不可用，请到设置重新选择。`, 409)
      }
      const context = await gitCommitContext(cwd)
      const preferences = normalizeCommitPreferences(body.detail, body.language)
      try {
        return { message: await generateCommitMessage(llm, { provider: selected.provider, model: selected.model }, context, signal, preferences) }
      } catch (error) {
        if (error instanceof WorkbenchError) throw error
        throw new WorkbenchError('llm-failed', error instanceof Error ? error.message : String(error), 502)
      }
    }
    default: throw new WorkbenchError('not-found', `unknown workbench API method ${method}`, 404)
  }
}

export function apply(ctx: HostContext): void {
  const site = new WorkspaceSite(ctx)
  ctx.effect(() => () => site.dispose(), 'dsh-vscode-workbench: workspace sites')
  ctx.effect(() => {
    if (typeof ctx.inject !== 'function') return
    // Optional injection: the callback runs once both services are active, and never if a profile omits them.
    const fiber = ctx.inject(['directoryPicker', 'workspaceRegistry'], (child) => {
      const services = child as unknown as { directoryPicker: import('./context.ts').DirectoryPickerLike; workspaceRegistry: import('./context.ts').WorkspaceRegistryLike }
      dshDirectoryPicker = services.directoryPicker
      dshWorkspaceRegistry = services.workspaceRegistry
      return () => { dshDirectoryPicker = undefined; dshWorkspaceRegistry = undefined }
    })
    return () => { void fiber.dispose?.() }
  }, 'dsh-vscode-workbench: optional DSH services')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/preview.js', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const content = await readFile(new URL('./preview.js', import.meta.url))
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(content)
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: preview runtime')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/codicons/codicon.ttf', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const asset = codiconAsset()
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(await readFile(asset.path))
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: Codicon font')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/xlsx.js', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const asset = xlsxAsset()
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(await readFile(asset.path))
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: SheetJS asset')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/dsh-vscode/file-icons', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const raw = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.local').pathname.slice('/dsh-vscode/file-icons/'.length))
        const asset = fileIconAsset(raw)
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(await readFile(asset.path))
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: file icons')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/pdfjs/worker.mjs', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const asset = pdfWorkerAsset()
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(await readFile(asset.path))
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: PDF.js worker')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/dsh-vscode/api', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: { code: 'method', message: 'POST required' } })
      try {
        const controller = new AbortController()
        req.once('aborted', () => controller.abort())
        res.once('close', () => { if (!res.writableEnded) controller.abort() })
        const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
        const method = path.slice('/dsh-vscode/api/'.length)
        const body = await readBody(req)
        // Only calls that wait on something external get a deadline. A directory picker waits for
        // the user and an LSP install waits for npm, so one shared 8 second cap used to 504 them
        // while the work kept running in the background. Everything else is bounded inside itself.
        const deadline = API_DEADLINES[method]
        const value = deadline === undefined
          ? await dispatch(ctx, method, body, controller.signal, site)
          : await withDeadline(dispatch(ctx, method, body, controller.signal, site), deadline, method)
        send(res, 200, { ok: true, value })
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: API')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/upload', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: { code: 'method', message: 'POST required' } })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.local')
        const sessionId = url.searchParams.get('sessionId'); const directory = url.searchParams.get('directory'); const name = url.searchParams.get('name')
        if (sessionId === null || directory === null || name === null) throw new WorkbenchError('bad-request', 'sessionId, directory and name are required')
        const cwd = cwdFor(ctx, sessionId)
        const remote = remoteFileRef(directory)
        const controller = new AbortController()
        res.once('close', () => { if (!res.writableEnded) controller.abort() })
        const content = await readBinaryBody(req)
        const value = remote === undefined
          ? await uploadFile(cwd, directory, name, content)
          : await sshUploadFile(sessionId, remote.sessionIdConnection, remote.remotePath, name, content, controller.signal)
        send(res, 201, { ok: true, value })
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: file upload')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/ssh/file', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      const controller = new AbortController()
      res.once('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.local')
        const sessionId = url.searchParams.get('sessionId')
        const connectionId = url.searchParams.get('connectionId')
        const path = url.searchParams.get('path')
        if (sessionId === null || connectionId === null || path === null) {
          throw new WorkbenchError('bad-request', 'sessionId, connectionId and path are required')
        }
        const file = await sshOpenFilePreview(sessionId, connectionId, path, controller.signal)
        res.writeHead(200, {
          'content-type': file.type,
          'content-length': file.size,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        })
        res.once('close', () => file.child.kill())
        file.child.stdout.on('error', error => res.destroy(error))
        file.child.stderr.on('data', () => undefined)
        file.child.once('error', error => res.destroy(error))
        file.child.stdout.pipe(res)
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: SSH file preview')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/ssh/office', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      const controller = new AbortController()
      res.once('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.local')
        const sessionId = url.searchParams.get('sessionId')
        const connectionId = url.searchParams.get('connectionId')
        const path = url.searchParams.get('path')
        if (sessionId === null || connectionId === null || path === null) {
          throw new WorkbenchError('bad-request', 'sessionId, connectionId and path are required')
        }
        const source = await sshReadPreviewFile(sessionId, connectionId, path, controller.signal)
        const pdf = await officePdfBuffer(source.data, source.name)
        const info = await stat(pdf.path)
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': info.size, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' })
        createReadStream(pdf.path).on('error', error => res.destroy(error)).pipe(res)
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: SSH Office preview')

  ctx.effect(() => ctx.webServer.register({
    kind:'prefix',path:'/dsh-vscode/file',handler:async(req,res)=>{if(!authorize(req,res,ctx.connection))return;try{const url=new URL(req.url??'/','http://dsh.local');const sessionId=url.searchParams.get('sessionId');const path=url.searchParams.get('path');const commit=url.searchParams.get('commit');if(sessionId===null||path===null)throw new WorkbenchError('bad-request','sessionId and path are required');const cwd=cwdFor(ctx,sessionId);if(commit===null){const asset=await workspacePreviewFile(cwd,path);res.writeHead(200,{'content-type':asset.type,'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(await readFile(asset.path))}else{const asset=await gitPreviewFile(cwd,commit,path);res.writeHead(200,{'content-type':asset.type,'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(asset.data)}}catch(error){sendError(res,error)}},
    auth: 'required',
  }), 'dsh-vscode-workbench: file preview')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/download', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.local')
        const sessionId = url.searchParams.get('sessionId')
        const path = url.searchParams.get('path')
        if (sessionId === null || path === null) throw new WorkbenchError('bad-request', 'sessionId and path are required')
        const cwd = cwdFor(ctx, sessionId)
        const remote = remoteFileRef(path)
        const controller = new AbortController()
        res.once('close', () => { if (!res.writableEnded) controller.abort() })
        const file = remote === undefined
          ? await workspaceDownloadFile(cwd, path)
          : await sshOpenFileDownload(sessionId, remote.sessionIdConnection, remote.remotePath, controller.signal)
        const stream = 'child' in file ? file.child.stdout : createReadStream(file.path)
        if ('child' in file) {
          file.child.stderr.resume()
          file.child.once('error', error => res.destroy(error))
        }
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': file.size,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        })
        stream.once('error', (error: Error) => res.destroy(error)).pipe(res)
      } catch (error) {
        if (res.headersSent) res.destroy(error instanceof Error ? error : undefined)
        else sendError(res, error)
      }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: file download')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/office', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.local')
        const sessionId = url.searchParams.get('sessionId'); const path = url.searchParams.get('path'); const commit = url.searchParams.get('commit')
        if (sessionId === null || path === null) throw new WorkbenchError('bad-request', 'sessionId and path are required')
        const cwd = cwdFor(ctx, sessionId)
        const pdf = commit === null ? await officePdf(cwd, path) : await officePdfBuffer((await gitPreviewFile(cwd, commit, path)).data, path)
        const info = await stat(pdf.path)
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': info.size, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' })
        createReadStream(pdf.path).on('error', error => res.destroy(error)).pipe(res)
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: office preview')
  

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/dsh-vscode/monaco', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const raw = decodeURIComponent(new URL(req.url ?? '/', 'http://dsh.local').pathname.slice('/dsh-vscode/monaco/'.length))
        const asset = monacoAsset(raw)
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(await readFile(asset.path))
      } catch (error) { sendError(res, error) }
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: Monaco assets')

  const wss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/dsh-vscode/ws/files', handler(req, socket, head) {
      if (ctx.connection.requestRejection?.(req) !== undefined) { socket.destroy(); return }
      wss.handleUpgrade(req as IncomingMessage, socket as Duplex, head, (ws) => {
        const search = new URL(req.url ?? '/', 'http://dsh.local').searchParams
        const sessionId = search.get('sessionId')
        if (sessionId === null) { ws.close(1008, 'sessionId required'); return }
        let workspace: string
        try { workspace = cwdFor(ctx, sessionId) }
        catch { ws.close(1008, 'session workspace unavailable'); return }
        let watcher: ReturnType<typeof createWorkspaceWatcher> | undefined
        let legacy: ReturnType<typeof chokidar.watch> | undefined
        let paths = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined
        let appliedVersion = -1
        let pendingManifest: { version: number; paths: string[] } | undefined
        const send = (payload: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)) }
        const flush = (changed: string) => {
          paths.add(changed)
          clearTimeout(timer)
          timer = setTimeout(() => { send({ type: 'files.changed', paths: [...paths] }); paths = new Set() }, 150)
        }
        const applyWatch = (version: number, list: string[]) => {
          if (isStaleManifest(version, appliedVersion)) return
          if (watcher === undefined) { pendingManifest = { version, paths: list }; return }
          appliedVersion = version
          clearTimeout(legacyTimer)
          void legacy?.close()
          legacy = undefined
          // The reply is sent only after the watch is armed, so the client's re-read cannot race it.
          void watcher.apply({ version, paths: list }).then(result => {
            send({ type: 'files.ready', version: result.version, added: result.added, paths: result.watching, skipped: result.skipped })
          }).catch(error => { send({ type: 'files.watch-error', message: String(error) }) })
        }
        // Exclusions come from the workspace's .gitignore plus the built-in dependency/build trees.
        void workspaceWatchIgnores(workspace).then(extra => {
          if (ws.readyState !== WebSocket.OPEN) return
          watcher = createWorkspaceWatcher({ workspace, ignored: watchIgnore(workspace, extra), onChange: flush })
          if (pendingManifest !== undefined) {
            const queued = pendingManifest
            pendingManifest = undefined
            applyWatch(queued.version, queued.paths)
          }
        }).catch(error => { send({ type: 'files.watch-error', message: String(error) }) })
        // A client that never sends a manifest still expects notifications for the whole tree.
        const legacyTimer = setTimeout(() => {
          if (appliedVersion >= 0) return
          void workspaceWatchIgnores(workspace).then(extra => {
            if (ws.readyState !== WebSocket.OPEN || appliedVersion >= 0) return
            const instance = legacy = chokidar.watch(workspace, {
              ignoreInitial: true, ignored: watchIgnore(workspace, extra),
              awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
            })
            instance.on('all', (_event, path) => {
              flush((isAbsolute(path) ? relative(workspace, path) : path).split(sep).join('/'))
            })
            instance.on('error', () => { void instance.close() })
          }).catch(error => { send({ type: 'files.watch-error', message: String(error) }) })
        }, 1500)
        ws.on('message', data => {
          let message: { type?: string; version?: number; paths?: unknown }
          try { message = JSON.parse(String(data)) } catch { return }
          if (message.type !== 'watch') return
          const version = typeof message.version === 'number' ? message.version : -1
          const list = Array.isArray(message.paths) ? message.paths.filter((row): row is string => typeof row === 'string') : []
          applyWatch(version, list)
        })
        ws.on('close', () => {
          clearTimeout(timer)
          clearTimeout(legacyTimer)
          void watcher?.close()
          void legacy?.close()
        })
      })
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: file watcher')

  const lspWss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/dsh-vscode/ws/lsp', handler(req, socket, head) {
      if (ctx.connection.requestRejection?.(req) !== undefined) { socket.destroy(); return }
      lspWss.handleUpgrade(req as IncomingMessage, socket as Duplex, head, (ws) => {
        const search = new URL(req.url ?? '/', 'http://dsh.local').searchParams
        const sessionId = search.get('sessionId'); const serverId = search.get('server')
        if (sessionId === null || serverId === null) { ws.close(1008, 'sessionId and server required'); return }
        let workspace: string
        try { workspace = cwdFor(ctx, sessionId) }
        catch { ws.close(1008, 'session workspace unavailable'); return }
        void attachLanguageServerSocket(ws, workspace, serverId)
      })
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: language server bridge')
  ctx.effect(() => () => { for (const ws of lspWss.clients) ws.terminate(); lspWss.close() }, 'dsh-vscode-workbench: language server teardown')
  const debugWss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/dsh-vscode/ws/debug', handler(req, socket, head) {
      if (ctx.connection.requestRejection?.(req) !== undefined) { socket.destroy(); return }
      debugWss.handleUpgrade(req as IncomingMessage, socket as Duplex, head, ws => {
        const search = new URL(req.url ?? '/', 'http://dsh.local').searchParams
        const sessionId = search.get('sessionId')
        // The bridge spawns and kills processes, so it only exists inside a real DSH session.
        if (sessionId === null || sessionId === '') { ws.close(1008, 'sessionId is required'); return }
        let workspace: string
        try { workspace = cwdFor(ctx, sessionId) }
        catch { ws.close(1008, 'session workspace unavailable'); return }
        // The session owns a spawned runtime, so every message is resolved inside its workspace.
        // Adapters live outside the profile so a venv or adapter bundle never lands in the app dir.
        const adaptersRoot = process.env.DSH_WORKBENCH_ADAPTERS ?? joinPath(homedir(), '.dsh', 'workbench-adapters')
        traceDebug(`debug-ws-connect session=${sessionId}`)
        const bridge = createDebugBridge({
          workspace,
          adaptersRoot,
          resolvePath: async path => (await workspacePath(workspace, path)).absolute,
          send: message => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)) },
        })
        // Frames are handled in arrival order: an adapter must never see a relative path, and a
        // path outside the workspace must never reach it at all.
        ws.on('message', data => { void bridge.accept(data as Buffer) })
        ws.on('close', () => bridge.dispose())
        ws.on('error', () => bridge.dispose())
      })
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: debug bridge')
  ctx.effect(() => () => { debugWss.close() }, 'dsh-vscode-workbench: debug teardown')
  const sshWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/dsh-vscode/ws/ssh', handler(req, socket, head) {
      if (ctx.connection.requestRejection?.(req) !== undefined) { socket.destroy(); return }
      sshWss.handleUpgrade(req as IncomingMessage, socket as Duplex, head, ws => {
        const search = new URL(req.url ?? '/', 'http://dsh.local').searchParams
        const sessionId = search.get('sessionId')
        const connectionId = search.get('connection')
        if (sessionId === null || connectionId === null) { ws.close(1008, 'sessionId and connection required'); return }
        let connection
        try { connection = getLiveSshConnection(sessionId, connectionId) }
        catch (error) {
          ws.close(1008, error instanceof Error ? error.message : String(error))
          return
        }
        const cols = Math.max(20, Math.min(500, Number(search.get('cols') ?? 80)))
        const rows = Math.max(5, Math.min(200, Number(search.get('rows') ?? 24)))
        const remote = `stty cols ${cols} rows ${rows} 2>/dev/null || true; cd -- ${shellQuote(connection.root)} && exec "\${SHELL:-/bin/sh}" -l`
        const child = spawn('ssh', [...sshTargetArguments(connection), remote], {
          cwd: homedir(),
          shell: false,
          windowsHide: true,
          env: { ...process.env, TERM: 'xterm-256color', ...sshEnvironment(connection.target) },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        const sendData = (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data: data.toString('base64') }))
        }
        child.stdout.on('data', sendData)
        child.stderr.on('data', sendData)
        child.on('error', error => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: error.message }))
        })
        child.on('close', code => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'exit', code: code ?? 1 }))
          if (ws.readyState === WebSocket.OPEN) ws.close()
        })
        ws.on('message', data => {
          let message: { type?: string; data?: string }
          try { message = JSON.parse(String(data)) } catch { return }
          if (message.type === 'input' && typeof message.data === 'string') child.stdin.write(message.data)
          else if (message.type === 'close') child.kill()
        })
        ws.on('close', () => child.kill())
        ws.on('error', () => child.kill())
      })
    },
    auth: 'required',
  }), 'dsh-vscode-workbench: SSH terminal bridge')
  ctx.effect(() => () => {
    for (const ws of sshWss.clients) ws.terminate()
    sshWss.close()
  }, 'dsh-vscode-workbench: SSH terminal teardown')
  ctx.effect(() => () => { wss.close() }, 'dsh-vscode-workbench: watcher teardown')
}
