/** DSH host plugin for the VS Code workbench. */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { isAbsolute, relative, sep } from 'node:path'
import type { Duplex } from 'node:stream'
import { spawn } from 'node:child_process'
import chokidar from 'chokidar'
import { WebSocket, WebSocketServer } from 'ws'
import type { HostContext } from './context.ts'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { generateCommitMessage, normalizeCommitPreferences } from './commit-message.ts'
import { codiconAsset, createEntry, cwdFor, deleteEntry, fileIconAsset, gitAction, gitCommitContext, gitStatus, listFiles, monacoAsset, openWorkspaceFromPicker, pdfWorkerAsset, xlsxAsset, readDocument, projectSources, renameEntry, saveDocument, workspaceDownloadFile, searchWorkspace, uploadFile, workspacePreviewFile } from './host.ts'
import { installLsp, lspStatuses, resolveLsp, uninstallLsp, pipeLanguageServer } from './lsp.ts'
import { officePdf, officeStatus } from './office.ts'
import { WorkspaceSite } from './site.ts'
import type { SearchRequest } from './types.ts'
import { watchIgnore, workspaceWatchIgnores } from './watch-ignore.ts'
import { readBinaryBody, readBody, send, sendError, stringField, authorize, WorkbenchError } from './wire.ts'

export { WorkbenchError } from './wire.ts'
export * from './types.ts'
export const name = 'dsh-vscode-workbench'

// DSH services used by the workbench when present; resolved through optional injection, never a hard dependency.
let dshDirectoryPicker: import('./context.ts').DirectoryPickerLike | undefined
let dshWorkspaceRegistry: import('./context.ts').WorkspaceRegistryLike | undefined
export const inject = ['webServer', 'sessions', 'connection', 'workingDirectory']

async function dispatch(ctx: HostContext, method: string, body: Record<string, unknown>, signal?: AbortSignal, site?: WorkspaceSite): Promise<unknown> {
  const sessionId = stringField(body, 'sessionId'); const cwd = cwdFor(ctx, sessionId)
  switch (method) {
    case 'workspace': return { cwd, name: cwd.split(/[\\/]/).at(-1) || cwd }
    case 'fs.list': return listFiles(cwd, stringField(body, 'path'))
    case 'fs.read': return readDocument(cwd, stringField(body, 'path'))
    case 'fs.save': return saveDocument(cwd, stringField(body, 'path'), stringField(body, 'content'), stringField(body, 'revision'))
    case 'fs.create': return createEntry(cwd, stringField(body, 'path'), body.kind === 'directory' ? 'directory' : 'file').then(() => ({ ok: true }))
    case 'fs.rename': return renameEntry(cwd, stringField(body, 'path'), stringField(body, 'nextPath')).then(() => ({ ok: true }))
    case 'fs.delete': return deleteEntry(cwd, stringField(body, 'path')).then(() => ({ ok: true }))
    case 'project.sources': return projectSources(cwd)
    case 'office.status': return officeStatus()
    case 'preview.site': {
      if (site === undefined) throw new WorkbenchError('site-unavailable', 'HTML 预览服务不可用', 503)
      return { url: await site.url(sessionId, stringField(body, 'path')) }
    }
    case 'workspace.open': return openWorkspaceFromPicker(dshDirectoryPicker, dshWorkspaceRegistry, AbortSignal.timeout(10 * 60 * 1000))
    case 'lsp.status': return lspStatuses()
    case 'lsp.install': await installLsp(stringField(body, 'id')); return lspStatuses()
    case 'lsp.uninstall': await uninstallLsp(stringField(body, 'id')); return lspStatuses()
    case 'search': return searchWorkspace(cwd, body as unknown as SearchRequest, signal)
    case 'git.status': return gitStatus(cwd)
    case 'git.action': return gitAction(cwd, stringField(body, 'action'), typeof body.path === 'string' ? body.path : undefined, typeof body.value === 'string' ? body.value : undefined)
    case 'git.commitMessage': {
      const session = ctx.sessions.get(sessionId)
      const config = session?.requestHeader()?.config
      if (config === undefined) throw new WorkbenchError('model-unavailable', '当前会话还没有模型配置，请先发送一条消息后再生成提交信息。', 409)
      const llm: LlmRuntime | undefined = ctx.get('llm')
      if (llm === undefined) throw new WorkbenchError('llm-unavailable', 'DSH 的模型服务当前不可用。', 503)
      const context = await gitCommitContext(cwd)
      const preferences = normalizeCommitPreferences(body.detail, body.language)
      try {
        return { message: await generateCommitMessage(llm, config, context, signal, preferences) }
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
        const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
        const method = path.slice('/dsh-vscode/api/'.length)
        send(res, 200, { ok: true, value: await dispatch(ctx, method, await readBody(req), controller.signal, site) })
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
    kind:'prefix',path:'/dsh-vscode/file',handler:async(req,res)=>{if(!authorize(req,res,ctx.connection))return;try{const url=new URL(req.url??'/','http://dsh.local');const sessionId=url.searchParams.get('sessionId');const path=url.searchParams.get('path');if(sessionId===null||path===null)throw new WorkbenchError('bad-request','sessionId and path are required');const asset=await workspacePreviewFile(cwdFor(ctx,sessionId),path);res.writeHead(200,{'content-type':asset.type,'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(await readFile(asset.path))}catch(error){sendError(res,error)}}
  }), 'dsh-vscode-workbench: file preview')

  ctx.effect(() => ctx.webServer.register({
    kind:'exact',path:'/dsh-vscode/download',handler:async(req,res)=>{if(!authorize(req,res,ctx.connection))return;try{const url=new URL(req.url??'/','http://dsh.local');const sessionId=url.searchParams.get('sessionId');const path=url.searchParams.get('path');if(sessionId===null||path===null)throw new WorkbenchError('bad-request','sessionId and path are required');const file=await workspaceDownloadFile(cwdFor(ctx,sessionId),path);res.writeHead(200,{'content-type':'application/octet-stream','content-length':file.size,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'x-content-type-options':'nosniff','cache-control':'no-store'});createReadStream(file.path).on('error',error=>res.destroy(error)).pipe(res)}catch(error){sendError(res,error)}}
  }), 'dsh-vscode-workbench: file download')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/office', handler: async (req, res) => {
      if (!authorize(req, res, ctx.connection)) return
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.local')
        const sessionId = url.searchParams.get('sessionId'); const path = url.searchParams.get('path')
        if (sessionId === null || path === null) throw new WorkbenchError('bad-request', 'sessionId and path are required')
        const pdf = await officePdf(cwdFor(ctx, sessionId), path)
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
        let watcher: ReturnType<typeof chokidar.watch> | undefined; let paths = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined
        // Exclusions come from the workspace's .gitignore plus the built-in dependency/build trees.
        void workspaceWatchIgnores(workspace).then(extra => {
          const instance = watcher = chokidar.watch(workspace, { ignoreInitial: true, ignored: watchIgnore(workspace, extra), awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 } })
          instance.on('error', error => {
            console.warn('[dsh-vscode-workbench] file watcher stopped:', error)
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'files.watch-error', message: String(error) }))
            void instance.close()
          })
          instance.on('all', (_event, path) => {
            const changed = isAbsolute(path) ? relative(workspace, path) : path
            paths.add(changed.split(sep).join('/')); clearTimeout(timer); timer = setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'files.changed', paths: [...paths] }))
              paths = new Set()
            }, 150)
          })
        })
        ws.on('close', () => { clearTimeout(timer); void watcher?.close() })
      })
    },
  }), 'dsh-vscode-workbench: file watcher')

  const lspWss = new WebSocketServer({ noServer: true })
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
        void (async () => {
          try {
            const server = await resolveLsp(serverId)
            const child = spawn(server.command, server.args, { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], shell: server.shell, windowsHide: true })
            const bridge = pipeLanguageServer(child, {
              onMessage: message => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)) },
              onStderr: text => console.warn('[dsh-vscode-workbench] lsp:', text.trim().slice(0, 500)),
              onExit: code => { if (ws.readyState === WebSocket.OPEN) ws.close(1000, `server exited ${code ?? ''}`.trim()) },
            })
            ws.on('message', data => bridge.write(String(data)))
            ws.on('close', () => bridge.kill())
            ws.on('error', () => bridge.kill())
            child.on('error', error => { if (ws.readyState === WebSocket.OPEN) ws.close(1011, String(error).slice(0, 120)) })
          } catch (error) {
            ws.close(1008, (error instanceof Error ? error.message : 'language server unavailable').slice(0, 120))
          }
        })()
      })
    },
  }), 'dsh-vscode-workbench: language server bridge')
  ctx.effect(() => () => { lspWss.close() }, 'dsh-vscode-workbench: language server teardown')
  ctx.effect(() => () => { wss.close() }, 'dsh-vscode-workbench: watcher teardown')
}
