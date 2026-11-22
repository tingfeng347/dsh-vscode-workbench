import { describe, expect, it, vi } from 'vitest'
import { chmod, link, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { LSP_SERVERS, findExecutable, frameLsp, lspFrameParser, lspRoot, lspSearchDirs, lspStatuses, resolveLsp } from '../src/lsp.ts'

describe('Language server catalog', () => {
  it('covers the common languages with one server each', () => {
    expect(LSP_SERVERS.map(server => server.id).sort()).toEqual(['cpp', 'go', 'java', 'python', 'rust', 'typescript', 'vue'])
    expect(lspRoot()).toMatch(/dsh-vscode-workbench[\\/]lsp$/)
  })

  it('installs npm servers privately and documents manual ones', () => {
    const pyright = LSP_SERVERS.find(server => server.id === 'python')!
    expect(pyright.install).toMatchObject({ kind: 'npm', package: 'pyright', bin: 'pyright-langserver' })
    for (const id of ['go', 'rust', 'java', 'cpp']) {
      const server = LSP_SERVERS.find(candidate => candidate.id === id)!
      expect(server.install.kind).toBe('system')
      if (server.install.kind === 'system') {
        expect(server.install.hint.length).toBeGreaterThan(0)
        // The toolchain is tracked separately so the UI can say "Go 未安装" next to "gopls 未安装".
        expect(server.language!.name.length).toBeGreaterThan(0)
        expect(server.language!.commands.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('Language server detection', () => {
  it('searches PATH plus the usual per-user and Homebrew bin directories', () => {
    const home = '/home/tester'
    const env = { PATH: ['/one', '/two'].join(delimiter) } as NodeJS.ProcessEnv
    const dirs = lspSearchDirs(env, home)
    expect(dirs.slice(0, 2)).toEqual(['/one', '/two'])
    for (const expected of [
      join(home, 'go', 'bin'),
      join(home, '.cargo', 'bin'),
      join(home, '.dotnet', 'tools'),
    ]) expect(dirs).toContain(expected)
    if (process.platform !== 'win32') {
      expect(dirs).toContain(join(home, '.local', 'bin'))
      expect(dirs).toContain('/opt/homebrew/bin')
      expect(dirs).toContain('/usr/local/bin')
    }
    expect(new Set(dirs).size).toBe(dirs.length)
  })

  it('only reports executables it can actually run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dvw-lsp-'))
    try {
      const executable = join(root, process.platform === 'win32' ? 'gopls.exe' : 'gopls')
      await writeFile(executable, process.platform === 'win32' ? '' : '#!/bin/sh\n')
      if (process.platform !== 'win32') await chmod(executable, 0o755)
      expect(await findExecutable('gopls', [join(root, 'missing'), root])).toBe(executable)

      const plain = join(root, 'not-executable')
      await writeFile(plain, '')
      if (process.platform !== 'win32') await chmod(plain, 0o644)
      expect(await findExecutable('not-executable', [root])).toBeUndefined()
      await mkdir(join(root, process.platform === 'win32' ? 'directory.exe' : 'directory'))
      expect(await findExecutable('directory', [root])).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('starts Pyright from its actual npm package entry point without relying on PATH wrappers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dvw-lsp-python-'))
    vi.stubEnv(process.platform === 'win32' ? 'USERPROFILE' : 'HOME', root)
    try {
      const directory = join(lspRoot(), 'python', 'node_modules', 'pyright')
      await mkdir(join(directory, 'bin'), { recursive: true })
      const entry = join(directory, 'bin', 'pyright-langserver')
      await writeFile(join(directory, 'package.json'), JSON.stringify({ bin: { 'pyright-langserver': './bin/pyright-langserver' } }))
      await writeFile(entry, '#!/usr/bin/env node\n')
      expect(await resolveLsp('python')).toMatchObject({ command: process.execPath, args: [entry, '--stdio'], shell: false })
      expect((await lspStatuses()).find(status => status.id === 'python')?.installed).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('distinguishes the active Rust Analyzer component from a rustup shim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dvw-lsp-rust-'))
    vi.stubEnv('PATH', root)
    try {
      const rustup = join(root, 'rustup')
      const actual = join(root, 'toolchain', 'rust-analyzer')
      await mkdir(join(root, 'toolchain'))
      await writeFile(rustup, '#!/bin/sh\n[ -x "$PWD/toolchain/rust-analyzer" ] || exit 1\nprintf "%s\n" "$PWD/toolchain/rust-analyzer"\n', { mode: 0o755 })
      await link(rustup, join(root, 'rust-analyzer'))
      await expect(resolveLsp('rust', root)).rejects.toMatchObject({ code: 'lsp-missing' })
      await writeFile(actual, '#!/bin/sh\n', { mode: 0o755 })
      expect(await resolveLsp('rust', root)).toMatchObject({ command: await realpath(actual) })
    } finally {
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the language toolchain and the language server as separate facts', async () => {
    const statuses = await lspStatuses()
    const go = statuses.find(status => status.id === 'go')!
    expect(go.command).toBe('gopls')
    expect(go.language).toEqual({ name: 'Go', installed: expect.any(Boolean) })
    expect(typeof go.installed).toBe('boolean')
    expect(statuses.find(status => status.id === 'python')!.language).toEqual({ name: 'Python', installed: expect.any(Boolean) })
    expect(statuses.find(status => status.id === 'typescript')!.language).toBeUndefined()
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
