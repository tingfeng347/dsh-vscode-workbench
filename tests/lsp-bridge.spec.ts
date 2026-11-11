import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { lspLocations } from '../src/client/lsp.ts'
import { pipeLanguageServer } from '../src/lsp.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

/** A minimal LSP server: answers initialize and definition, and publishes one diagnostic. */
const SERVER = String.raw`
let buffer = Buffer.alloc(0)
function send(message) { const body = JSON.stringify(message); process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body) }
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return
    const size = Number(/content-length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + size) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + size).toString()); buffer = buffer.subarray(end + 4 + size)
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { definitionProvider: true } } })
      send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: message.params.rootUri + '/a.ts', diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, severity: 1, message: 'fake error' }] } })
    }
    if (message.method === 'textDocument/definition') send({ jsonrpc: '2.0', id: message.id, result: [{ uri: message.params.textDocument.uri, range: { start: { line: 2, character: 1 }, end: { line: 2, character: 4 } } }] })
    if (message.method === 'shutdown') send({ jsonrpc: '2.0', id: message.id, result: null })
  }
})
`

describe('Language server stdio bridge', () => {
  it('relays initialize, notifications and definition requests to a real process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dvw-lsp-'))
    roots.push(root)
    const script = join(root, 'server.cjs')
    await writeFile(script, SERVER)
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] })
    const received: Record<string, unknown>[] = []
    const bridge = pipeLanguageServer(child, { onMessage: message => received.push(message as Record<string, unknown>) })
    try {
      bridge.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: 'file:///repo' } }))
      await waitFor(() => received.some(message => message.id === 1))
      expect((received.find(message => message.id === 1) as { result: { capabilities: { definitionProvider: boolean } } }).result.capabilities.definitionProvider).toBe(true)
      await waitFor(() => received.some(message => message.method === 'textDocument/publishDiagnostics'))
      bridge.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'textDocument/definition', params: { textDocument: { uri: 'file:///repo/a.ts' }, position: { line: 3, character: 0 } } }))
      await waitFor(() => received.some(message => message.id === 2))
      expect((received.find(message => message.id === 2) as { result: unknown }).result).toEqual([{ uri: 'file:///repo/a.ts', range: { start: { line: 2, character: 1 }, end: { line: 2, character: 4 } } }])
    } finally { bridge.kill() }
  })

  it('ignores malformed client frames instead of crashing the bridge', async () => {
    const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const bridge = pipeLanguageServer(child, { onMessage: () => undefined })
    expect(() => bridge.write('not json')).not.toThrow()
    bridge.kill()
  })
})

async function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for language server reply')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('LSP location mapping', () => {
  const monaco = {
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} },
  } as unknown as typeof import('monaco-editor')

  it('converts zero-based locations and LocationLinks', () => {
    const locations = lspLocations(monaco, [
      { uri: 'file:///repo/a.ts', range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } } },
      { targetUri: 'file:///repo/b.ts', targetSelectionRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 2 } } },
    ])
    expect(locations.map(location => [location.uri.toString(), location.range.startLineNumber, location.range.startColumn])).toEqual([['file:///repo/a.ts', 1, 2], ['file:///repo/b.ts', 5, 1]])
  })

  it('returns nothing for empty results', () => {
    expect(lspLocations(monaco, null)).toEqual([])
    expect(lspLocations(monaco, [])).toEqual([])
  })
})
