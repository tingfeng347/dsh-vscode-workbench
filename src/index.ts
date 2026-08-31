/** DSH host plugin for the VS Code workbench. */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { isAbsolute, relative, sep } from 'node:path'
import type { Duplex } from 'node:stream'
import chokidar from 'chokidar'
import { WebSocket, WebSocketServer } from 'ws'
import type { HostContext } from './context.ts'
import { codiconAsset, createEntry, cwdFor, deleteEntry, gitAction, gitStatus, listFiles, monacoAsset, readDocument, renameEntry, saveDocument, searchWorkspace, uploadFile, workspaceImage } from './host.ts'
import { installTerminal } from './terminal.ts'
import type { SearchRequest } from './types.ts'
import { readBinaryBody, readBody, send, sendError, stringField, trusted, WorkbenchError } from './wire.ts'

export { WorkbenchError } from './wire.ts'
export * from './types.ts'
export const name = 'dsh-vscode-workbench'
export const inject = ['webServer', 'sessions', 'webRuntime']

async function dispatch(ctx: HostContext, method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const sessionId = stringField(body, 'sessionId'); const cwd = cwdFor(ctx, sessionId)
  switch (method) {
    case 'workspace': return { cwd, name: cwd.split(/[\\/]/).at(-1) || cwd }
    case 'fs.list': return listFiles(cwd, stringField(body, 'path'))
    case 'fs.read': return readDocument(cwd, stringField(body, 'path'))
    case 'fs.save': return saveDocument(cwd, stringField(body, 'path'), stringField(body, 'content'), stringField(body, 'revision'))
    case 'fs.create': return createEntry(cwd, stringField(body, 'path'), body.kind === 'directory' ? 'directory' : 'file').then(() => ({ ok: true }))
    case 'fs.rename': return renameEntry(cwd, stringField(body, 'path'), stringField(body, 'nextPath')).then(() => ({ ok: true }))
    case 'fs.delete': return deleteEntry(cwd, stringField(body, 'path')).then(() => ({ ok: true }))
    case 'search': return searchWorkspace(cwd, body as unknown as SearchRequest, signal)
    case 'git.status': return gitStatus(cwd)
    case 'git.action': return gitAction(cwd, stringField(body, 'action'), typeof body.path === 'string' ? body.path : undefined, typeof body.value === 'string' ? body.value : undefined)
    default: throw new WorkbenchError('not-found', `unknown workbench API method ${method}`, 404)
  }
}

export function apply(ctx: HostContext): void {
  installTerminal(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/codicons/codicon.ttf', handler: async (req, res) => {
      if (!trusted(req, ctx.webRuntime.trustedHosts)) { res.writeHead(403); res.end(); return }
      try {
        const asset = codiconAsset()
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable' })
        res.end(await readFile(asset.path))
      } catch (error) { sendError(res, error) }
    },
  }), 'dsh-vscode-workbench: Codicon font')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/dsh-vscode/api', handler: async (req, res) => {
      if (!trusted(req, ctx.webRuntime.trustedHosts)) return send(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: { code: 'method', message: 'POST required' } })
      try {
        const controller = new AbortController()
        req.once('aborted', () => controller.abort())
        const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
        const method = path.slice('/dsh-vscode/api/'.length)
        send(res, 200, { ok: true, value: await dispatch(ctx, method, await readBody(req), controller.signal) })
      } catch (error) { sendError(res, error) }
    },
  }), 'dsh-vscode-workbench: API')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/dsh-vscode/upload', handler: async (req, res) => {
      if (!trusted(req, ctx.webRuntime.trustedHosts)) return send(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
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
    kind:'prefix',path:'/dsh-vscode/file',handler:async(req,res)=>{if(!trusted(req,ctx.webRuntime.trustedHosts)){res.writeHead(403);res.end();return}try{const url=new URL(req.url??'/','http://dsh.local');const sessionId=url.searchParams.get('sessionId');const path=url.searchParams.get('path');if(sessionId===null||path===null)throw new WorkbenchError('bad-request','sessionId and path are required');const asset=await workspaceImage(cwdFor(ctx,sessionId),path);res.writeHead(200,{'content-type':asset.type,'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(await readFile(asset.path))}catch(error){sendError(res,error)}}
  }), 'dsh-vscode-workbench: image preview')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/dsh-vscode/monaco', handler: async (req, res) => {
      if (!trusted(req, ctx.webRuntime.trustedHosts)) { res.writeHead(403); res.end(); return }
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
      if (!trusted(req as IncomingMessage, ctx.webRuntime.trustedHosts)) { socket.destroy(); return }
      wss.handleUpgrade(req as IncomingMessage, socket as Duplex, head, (ws) => {
        const sessionId = new URL(req.url ?? '/', 'http://dsh.local').searchParams.get('sessionId')
        if (sessionId === null) { ws.close(1008, 'sessionId required'); return }
        const workspace = cwdFor(ctx, sessionId)
        const watcher = chokidar.watch(workspace, { ignoreInitial: true, ignored: /(^|[/\\])(\.git|node_modules|\.next|\.nuxt|\.turbo|\.vite|coverage)([/\\]|$)/, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 } })
        let paths = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined
        watcher.on('all', (_event, path) => {
          const changed = isAbsolute(path) ? relative(workspace, path) : path
          paths.add(changed.split(sep).join('/')); clearTimeout(timer); timer = setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'files.changed', paths: [...paths] }))
            paths = new Set()
          }, 150)
        })
        ws.on('close', () => { clearTimeout(timer); void watcher.close() })
      })
    },
  }), 'dsh-vscode-workbench: file watcher')
  ctx.effect(() => () => { wss.close() }, 'dsh-vscode-workbench: watcher teardown')
}
