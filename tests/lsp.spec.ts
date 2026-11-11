import { describe, expect, it } from 'vitest'
import { LSP_SERVERS, frameLsp, lspFrameParser, lspRoot } from '../src/lsp.ts'

describe('Language server catalog', () => {
  it('covers the common languages with one server each', () => {
    const languages = LSP_SERVERS.flatMap(server => server.languages)
    for (const language of ['python', 'go', 'rust', 'cpp', 'java', 'csharp', 'lua', 'php', 'shell', 'yaml', 'json', 'css', 'html', 'dockerfile']) {
      expect(languages).toContain(language)
    }
    expect(new Set(LSP_SERVERS.map(server => server.id)).size).toBe(LSP_SERVERS.length)
    expect(lspRoot()).toMatch(/dsh-vscode-workbench[\\/]lsp$/)
  })

  it('installs npm servers privately and documents manual ones', () => {
    const pyright = LSP_SERVERS.find(server => server.id === 'python')!
    expect(pyright.install).toMatchObject({ kind: 'npm', package: 'pyright', bin: 'pyright-langserver' })
    for (const id of ['go', 'rust', 'cpp', 'java', 'csharp', 'lua']) {
      const server = LSP_SERVERS.find(candidate => candidate.id === id)!
      expect(server.install.kind).toBe('system')
      if (server.install.kind === 'system') expect(server.install.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('LSP framing', () => {
  it('writes Content-Length headers with UTF-8 byte counts', () => {
    expect(frameLsp({ jsonrpc: '2.0', id: 1 })).toBe('Content-Length: 24\r\n\r\n{"jsonrpc":"2.0","id":1}')
    const framed = frameLsp({ id: 2, text: '你好' })
    expect(framed).toContain(`Content-Length: ${Buffer.byteLength('{"id":2,"text":"你好"}')}`)
  })

  it('parses messages split across chunks and back to back', () => {
    const received: unknown[] = []
    const parse = lspFrameParser(message => received.push(message))
    const frames = Buffer.from(frameLsp({ id: 1, method: 'a' }) + frameLsp({ id: 2, method: 'b' }))
    for (let index = 0; index < frames.length; index += 7) parse(frames.subarray(index, index + 7))
    expect(received).toEqual([{ id: 1, method: 'a' }, { id: 2, method: 'b' }])
  })

  it('ignores malformed bodies without wedging the stream', () => {
    const received: unknown[] = []
    const parse = lspFrameParser(message => received.push(message))
    parse(Buffer.from('Content-Length: 5\r\n\r\nnope!'))
    parse(Buffer.from(frameLsp({ id: 3 })))
    expect(received).toEqual([{ id: 3 }])
  })
})
