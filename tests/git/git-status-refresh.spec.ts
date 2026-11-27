import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { expect, it, vi } from 'vitest'
import type { HostContext, WorkbenchWebServer } from '../../src/host/context.ts'
import { apply } from '../../src/index.ts'

it('refreshes Git status immediately after saves and external staging', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dvw-git-status-'))
  const routes: Parameters<WorkbenchWebServer['register']>[0][] = []
  const disposers: Array<() => void> = []
  try {
    execFileSync('git', ['init', '-q'], { cwd })
    apply({
      connection: { requestRejection: () => undefined },
      sessions: { get: () => ({}) },
      workingDirectory: { get: () => cwd },
      webServer: {
        register: route => { routes.push(route); return () => {} },
        registerUpgrade: () => () => {},
      } satisfies WorkbenchWebServer,
      effect(callback: () => (() => void) | undefined) {
        const dispose = callback()
        if (dispose) disposers.push(dispose)
      },
    } as unknown as HostContext)
    const api = routes.find(route => route.path === '/dsh-vscode/api')!
    const status = async () => {
      const request = Object.assign(Readable.from([JSON.stringify({ sessionId: 'session' })]), {
        url: '/dsh-vscode/api/git.status', method: 'POST',
      })
      const response = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn() })
      await api.handler(request as unknown as IncomingMessage, response as unknown as ServerResponse)
      expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
      return JSON.parse(response.end.mock.calls[0]![0]).value
    }

    expect(await status()).toMatchObject({ changes: [] })
    await writeFile(join(cwd, 'new-file.ts'), 'export const value = 1\n')
    expect(await status()).toMatchObject({ changes: [{ path: 'new-file.ts', untracked: true }] })
    execFileSync('git', ['add', '--', 'new-file.ts'], { cwd })
    expect(await status()).toMatchObject({ changes: [{ path: 'new-file.ts', staged: true, untracked: false }] })
  } finally {
    for (const dispose of disposers.reverse()) dispose()
    await rm(cwd, { force: true, recursive: true })
  }
})
