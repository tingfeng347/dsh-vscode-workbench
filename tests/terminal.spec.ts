import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTerminalProtocolReply, TerminalWorkspaceController } from '../src/client/terminal.ts'
import { defaultTerminalShell, ensureExecutable, sanitizedTerminalEnv } from '../src/terminal.ts'

afterEach(() => vi.unstubAllGlobals())

function terminalAnswer(ok: boolean, value?: unknown, error?: { code: string; message: string }) {
  return { ok, text: async () => JSON.stringify(ok ? { ok: true, value } : { ok: false, error }) } as unknown as Response
}

describe('terminal host settings', () => {
  it('keeps normal shell variables while removing credentials', () => {
    expect(sanitizedTerminalEnv({ PATH: '/bin', LANG: 'zh_CN.UTF-8', DEEPSEEK_API_KEY: 'secret', TOKEN: 'secret', EMPTY: undefined })).toEqual({ PATH: '/bin', LANG: 'zh_CN.UTF-8' })
  })

  it('selects the platform interactive shell', () => {
    expect(defaultTerminalShell('linux', { SHELL: '/usr/bin/fish' })).toEqual({ shell: '/usr/bin/fish', args: ['-l'] })
    expect(defaultTerminalShell('win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' })).toEqual({ shell: 'powershell.exe', args: ['-NoLogo'] })
  })

  it('identifies terminal protocol replies emitted while replaying output', () => {
    expect(isTerminalProtocolReply('\x1b]11;rgb:1313/1414/1717\x1b\\')).toBe(true)
    expect(isTerminalProtocolReply('\x1b[?62;1;2;6;7;8;9c')).toBe(true)
    expect(isTerminalProtocolReply('git status\r')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('restores a native helper extracted without execute bits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-workbench-pty-'))
    const helper = join(directory, 'spawn-helper')
    try {
      await writeFile(helper, '')
      await chmod(helper, 0o644)
      expect(ensureExecutable(helper)).toBe(true)
      expect((await stat(helper)).mode & 0o111).toBe(0o111)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('does not fail plugin startup when a native helper is unavailable', () => {
    expect(ensureExecutable(join(tmpdir(), 'dsh-workbench-missing-spawn-helper'))).toBe(process.platform === 'win32')
  })
})

describe('terminal workspace session retry', () => {
  it('waits for the selected session before listing terminals', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return calls === 1
        ? terminalAnswer(false, undefined, { code: 'session-not-found', message: 'session not found' })
        : terminalAnswer(true, [])
    })
    const workspace = new TerminalWorkspaceController('s1')
    await expect(workspace.refresh()).resolves.toBe(true)
    expect(calls).toBe(2)
    expect(workspace.getSnapshot()).toEqual({ terminals: [], loading: false })
  })

  it('surfaces unrelated terminal failures without retrying', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return terminalAnswer(false, undefined, { code: 'internal', message: 'boom' })
    })
    const workspace = new TerminalWorkspaceController('s1')
    await expect(workspace.refresh()).resolves.toBe(false)
    expect(calls).toBe(1)
    expect(workspace.getSnapshot().error).toBe('boom')
  })

  it('retries creating a terminal while the session is being published', async () => {
    const terminal = { id: 't1', title: 'zsh', cwd: '/workspace', running: true, sequence: 0 }
    let createCalls = 0
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/create')) {
        createCalls++
        return createCalls === 1
          ? terminalAnswer(false, undefined, { code: 'session-not-found', message: 'session not found' })
          : terminalAnswer(true, terminal)
      }
      return terminalAnswer(true, [terminal])
    })
    const workspace = new TerminalWorkspaceController('s1')
    await expect(workspace.create()).resolves.toEqual(terminal)
    expect(createCalls).toBe(2)
    expect(workspace.getSnapshot().terminals).toEqual([terminal])
  })
})
