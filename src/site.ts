/** Token-protected localhost server for previewing workspace HTML with its relative assets. */
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join } from 'node:path'
import type { HostContext } from './context.ts'
import { cwdFor, workspacePath } from './host.ts'

const SITE_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.bmp': 'image/bmp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
}

const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EISDIR'])

/**
 * The official browser refuses to load the application origin, so a workspace page has to be
 * served from somewhere else. This listener binds a random localhost port and only answers
 * requests carrying its own token, which keeps the preview usable from both the built-in
 * browser and the user's normal browser without handing the rest of the host API away.
 */
export class WorkspaceSite {
  private readonly token = randomBytes(18).toString('base64url')
  private server: Server | undefined
  private starting: Promise<string> | undefined

  constructor(private readonly ctx: HostContext) {}

  /** Address of one workspace file, starting the listener on first use. */
  async url(sessionId: string, path: string): Promise<string> {
    const origin = await this.start()
    const encoded = path.split('/').filter(segment => segment !== '').map(segment => encodeURIComponent(segment)).join('/')
    return `${origin}/${this.token}/${encodeURIComponent(sessionId)}/${encoded}`
  }

  dispose(): void {
    const server = this.server
    this.server = undefined
    this.starting = undefined
    if (server === undefined) return
    server.closeAllConnections()
    server.close()
  }

  private start(): Promise<string> {
    this.starting ??= new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => { void this.serve(req.url ?? '/', req.method ?? 'GET', res) })
      this.server = server
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        server.removeListener('error', reject)
        if (address === null || typeof address === 'string') { reject(new Error('无法启动 HTML 预览服务')); return }
        // A preview connection failing later must not take the host down.
        server.on('error', () => {})
        resolve(`http://127.0.0.1:${address.port}`)
      })
    }).catch(error => { this.dispose(); throw error })
    return this.starting
  }

  private async serve(rawUrl: string, method: string, res: import('node:http').ServerResponse): Promise<void> {
    const fail = (status: number, message: string) => { if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(message) }
    if (method !== 'GET' && method !== 'HEAD') { fail(405, 'method not allowed'); return }
    const prefix = `/${this.token}/`
    let pathname: string
    try { pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname) } catch { fail(400, 'bad request'); return }
    if (!pathname.startsWith(prefix)) { fail(404, 'not found'); return }
    const rest = pathname.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) { fail(404, 'not found'); return }
    const sessionId = rest.slice(0, slash)
    const path = rest.slice(slash + 1)
    let file: string
    try {
      file = (await workspacePath(cwdFor(this.ctx, sessionId), path)).absolute
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
      if (!(await stat(file)).isFile()) { fail(404, 'not found'); return }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      fail(code !== undefined && MISSING.has(code) ? 404 : 400, 'not found')
      return
    }
    res.writeHead(200, {
      'content-type': SITE_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    if (method === 'HEAD') { res.end(); return }
    createReadStream(file).on('error', () => res.destroy()).pipe(res)
  }
}
