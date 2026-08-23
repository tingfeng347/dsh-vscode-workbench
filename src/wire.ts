import type { IncomingMessage, ServerResponse } from 'node:http'

export class WorkbenchError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > 2 * 1024 * 1024) throw new WorkbenchError('too-large', 'request body is too large', 413)
    chunks.push(value)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('object expected')
    return value as Record<string, unknown>
  } catch { throw new WorkbenchError('bad-json', 'request body must be a JSON object') }
}

export function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string') throw new WorkbenchError('bad-request', `${key} must be a string`)
  return value
}

export function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function sendError(res: ServerResponse, error: unknown): void {
  const known = error instanceof WorkbenchError ? error : new WorkbenchError('internal', error instanceof Error ? error.message : String(error), 500)
  send(res, known.status, { ok: false, error: { code: known.code, message: known.message } })
}

export function trusted(req: IncomingMessage, allowed: readonly string[]): boolean {
  const host = req.headers.host
  if (host === undefined || req.headers['sec-fetch-site'] === 'cross-site') return false
  let hostUrl: URL
  try { hostUrl = new URL(`http://${host}`) } catch { return false }
  const loopback = hostUrl.hostname === 'localhost' || hostUrl.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostUrl.hostname)
  if (!loopback && !allowed.some(candidate => candidate === host || candidate === hostUrl.hostname)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}
