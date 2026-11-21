/** DSH host plugin for the VS Code workbench. */
import { inspectReview, rejectReview, reviewFeed, reviewPath } from './review.ts'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { appendFileSync, lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { IncomingMessage } from 'node:http'
import { isAbsolute, join, join as joinPath, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import type { Duplex } from 'node:stream'
import { spawn } from 'node:child_process'
import chokidar from 'chokidar'
import { WebSocket, WebSocketServer } from 'ws'
import type { HostContext } from './context.ts'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { commitCatalogFromDsh, firstSupportedCommitModel, generateCommitMessage, loadCommitModelCatalog, loadCommitProviderModels, normalizeCommitModelSelection, normalizeCommitPreferences, type CommitModelCatalog, type CommitModelSelection, type DshChatModelCatalog } from './commit-message.ts'
import { codiconAsset, createEntry, cwdFor, deleteEntry, fileIconAsset, gitAction, gitBlameLine, gitBlameRange, gitCommitContext, gitPreviewFile, gitStatus, listFiles, monacoAsset, openWorkspaceFromPicker, pdfWorkerAsset, xlsxAsset, readDocument, projectSources, renameEntry, saveDocument, workspaceDownloadFile, replaceSearchResults, searchWorkspace, uploadFile, workspacePath, workspacePreviewFile } from './host.ts'
import { attachLanguageServerSocket, installLsp, lspStatuses, uninstallLsp } from './lsp.ts'
import { createDebugBridge } from './debug.ts'
import { officePdf, officePdfBuffer, officeStatus } from './office.ts'
import { WorkspaceSite } from './site.ts'
import type { SearchFileEdits, SearchRequest } from './types.ts'
import { watchIgnore, workspaceWatchIgnores } from './watch-ignore.ts'
import { isStaleManifest } from './workspace-watch.ts'
import { createWorkspaceWatcher } from './workspace-watch-host.ts'
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

/** Probes that spawn processes: serving a recent answer keeps startup from queueing behind them. */
const probeCache = new Map<string, { at: number; value: unknown }>()

async function cached<T>(key: string, ttl: number, produce: () => Promise<T> | T): Promise<T> {
  const hit = probeCache.get(key)
  if (hit !== undefined && Date.now() - hit.at < ttl) return hit.value as T
  const value = await produce()
  probeCache.set(key, { at: Date.now(), value })
  return value
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
    case 'fs.list': return listFiles(cwd, stringField(body, 'path'))
    case 'fs.read': return readDocument(cwd, stringField(body, 'path'))
    case 'fs.save': return saveDocument(cwd, stringField(body, 'path'), stringField(body, 'content'), stringField(body, 'revision'))
    case 'fs.create': return createEntry(cwd, stringField(body, 'path'), body.kind === 'directory' ? 'directory' : 'file').then(() => ({ ok: true }))
    case 'fs.rename': return renameEntry(cwd, stringField(body, 'path'), stringField(body, 'nextPath')).then(() => ({ ok: true }))
    case 'fs.delete': return deleteEntry(cwd, stringField(body, 'path')).then(() => ({ ok: true }))
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
      const target = await workspacePath(cwd, stringField(body, 'path'))
      const opener = ctx.get('sessionController') as unknown as DesktopOpener | undefined
      if (opener?.canOpenWorkspacePath?.() !== true || opener.openWorkspacePath === undefined) {
        throw new WorkbenchError('open-unavailable', '当前 DSH 没有提供用本地应用打开文件的能力。', 503)
      }
      const application = typeof body.application === 'string' && body.application !== '' ? body.application : undefined
      const reveal = body.action === 'reveal'
      try {
        await opener.openWorkspacePath({
          path: target.absolute,
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
    case 'git.status': return cached(`git.status:${cwd}`, 3_000, () => gitStatus(cwd))
    case 'git.blameRange': return gitBlameRange(cwd, body.source, body.startLine, body.endLine, signal)
    case 'git.blameLine': return gitBlameLine(cwd, body.source, body.line, signal)
    case 'git.action': probeCache.delete(`git.status:${cwd}`); return gitAction(cwd, stringField(body, 'action'), typeof body.path === 'string' ? body.path : undefined, typeof body.value === 'string' ? body.value : undefined)
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
  }), 'dsh-vscode-workbench: API')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/upload', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: { code: 'method', message: 'POST required' } })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.local')
        const sessionId = url.searchParams.get('sessionId'); const directory = url.searchParams.get('directory'); const name = url.searchParams.get('name')
        if (sessionId === null || directory === null || name === null) throw new WorkbenchError('bad-request', 'sessionId, directory and name are required')
        send(res, 201, { ok: true, value: await uploadFile(cwdFor(ctx, sessionId), directory, name, await readBinaryBody(req)) })
      } catch (error) { sendError(res, error) }
    },
  }), 'dsh-vscode-workbench: file upload')

  ctx.effect(() => ctx.webServer.register({
    kind:'prefix',path:'/dsh-vscode/file',handler:async(req,res)=>{if(!authorize(req,res,ctx.connection))return;try{const url=new URL(req.url??'/','http://dsh.local');const sessionId=url.searchParams.get('sessionId');const path=url.searchParams.get('path');const commit=url.searchParams.get('commit');if(sessionId===null||path===null)throw new WorkbenchError('bad-request','sessionId and path are required');const cwd=cwdFor(ctx,sessionId);if(commit===null){const asset=await workspacePreviewFile(cwd,path);res.writeHead(200,{'content-type':asset.type,'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(await readFile(asset.path))}else{const asset=await gitPreviewFile(cwd,commit,path);res.writeHead(200,{'content-type':asset.type,'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(asset.data)}}catch(error){sendError(res,error)}}
  }), 'dsh-vscode-workbench: file preview')

  ctx.effect(() => ctx.webServer.register({
    kind:'exact',path:'/dsh-vscode/download',handler:async(req,res)=>{if(!authorize(req,res,ctx.connection))return;try{const url=new URL(req.url??'/','http://dsh.local');const sessionId=url.searchParams.get('sessionId');const path=url.searchParams.get('path');if(sessionId===null||path===null)throw new WorkbenchError('bad-request','sessionId and path are required');const file=await workspaceDownloadFile(cwdFor(ctx,sessionId),path);res.writeHead(200,{'content-type':'application/octet-stream','content-length':file.size,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'x-content-type-options':'nosniff','cache-control':'no-store'});createReadStream(file.path).on('error',error=>res.destroy(error)).pipe(res)}catch(error){sendError(res,error)}}
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
  }), 'dsh-vscode-workbench: Monaco assets')

  const wss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/dsh-vscode/ws/files', handler(req, socket, head) {
      if (ctx.connection.requestRejection(req) !== undefined) { socket.destroy(); return }
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
  }), 'dsh-vscode-workbench: file watcher')

  const lspWss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/dsh-vscode/ws/lsp', handler(req, socket, head) {
      if (ctx.connection.requestRejection(req) !== undefined) { socket.destroy(); return }
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
  }), 'dsh-vscode-workbench: language server bridge')
  ctx.effect(() => () => { for (const ws of lspWss.clients) ws.terminate(); lspWss.close() }, 'dsh-vscode-workbench: language server teardown')
  const debugWss = new WebSocketServer({ noServer: true })
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/dsh-vscode/ws/debug', handler(req, socket, head) {
      if (ctx.connection.requestRejection(req) !== undefined) { socket.destroy(); return }
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
  }), 'dsh-vscode-workbench: debug bridge')
  ctx.effect(() => () => { debugWss.close() }, 'dsh-vscode-workbench: debug teardown')
  ctx.effect(() => () => { wss.close() }, 'dsh-vscode-workbench: watcher teardown')
}
