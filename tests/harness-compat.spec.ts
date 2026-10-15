import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyConnection, type HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { apply, inject } from '../src/index.ts'
import type { HostContext, WorkbenchWebServer } from '../src/context.ts'
import { mainViewSession } from '../src/client/session.ts'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

describe('Harness 0.2 host integration', () => {
  it('uses real Harness cookies for every HTTP route and rejects unauthenticated upgrades', async () => {
    const auth = new Context()
    let record: unknown
    auth.provide('credentials', {
      readRecord: async () => record,
      modifyRecord: async (_key: unknown, mutate: (value: unknown) => Promise<unknown>) => (record = await mutate(record)),
    } as never)
    await applyConnection(auth)
    cleanup.push(() => auth.fiber.dispose())
    const connection = auth.connection as HostConnectionService
    const routes: Parameters<WorkbenchWebServer['register']>[0][] = []
    const upgrades: Parameters<WorkbenchWebServer['registerUpgrade']>[0][] = []
    const original = resolve('original')
    const changed = resolve('changed')
    let directory = original
    const session = { header: { cwd: original } } as Session
    const effects: Array<() => void> = []
    const ctx = {
      connection,
      sessions: { get: (id: string) => id === 'main' ? session : undefined },
      workingDirectory: { get: () => directory },
      webServer: {
        register: route => { routes.push(route); return () => {} },
        registerUpgrade: route => { upgrades.push(route); return () => {} },
      } satisfies WorkbenchWebServer,
      effect(callback: () => void | (() => void)) { const dispose = callback(); if (dispose) effects.push(dispose) },
    } as unknown as HostContext
    apply(ctx)
    cleanup.push(() => { for (const dispose of effects.reverse()) dispose() })
    expect(inject).toEqual(['webServer', 'sessions', 'connection', 'workingDirectory'])
    const server = createServer((req, res) => {
      if (req.url?.startsWith('/?token=')) { connection.authorizeIndex(req, res); return }
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      const route = routes.find(route => route.kind === 'exact' ? route.path === path : path.startsWith(route.path))
      if (!route) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      const route = upgrades.find(route => route.path === path)
      if (route) void route.handler(req, socket, head)
      else socket.destroy()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    for (const route of routes) {
      expect((await fetch(base + route.path)).status, route.path).toBe(401)
    }
    const login = await fetch(connection.authenticatedUrl(base), { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toBeTruthy()
    const headers = { cookie: cookie!, 'content-type': 'application/json' }
    const workspace = (id = 'main') => fetch(`${base}/dsh-vscode/api/workspace`, { method: 'POST', headers, body: JSON.stringify({ sessionId: id }) })
    expect(await (await workspace()).json()).toMatchObject({ value: { cwd: original } })
    directory = changed
    expect(await (await workspace()).json()).toMatchObject({ value: { cwd: changed } })
    expect((await workspace('missing')).status).toBe(404)
    expect((await fetch(`${base}/dsh-vscode/api/workspace`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })).status).toBe(403)
    directory = process.cwd()
    expect((await fetch(`${base}/dsh-vscode-terminal/api/list`, { method: 'POST', headers, body: '{"sessionId":"main"}' })).status).toBe(200)
    for (const route of upgrades) {
      const socket = { destroy: vi.fn() }
      await route.handler({ headers: { host: new URL(base).host } } as IncomingMessage, socket as never, Buffer.alloc(0))
      expect(socket.destroy, route.path).toHaveBeenCalledOnce()
      const code = await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(`${base.replace('http:', 'ws:')}${route.path}?sessionId=missing&id=missing`, { headers })
        ws.once('error', reject)
        ws.once('close', resolve)
      })
      expect(code, route.path).toBe(1008)
    }
  })
})

describe('Harness main-view ownership', () => {
  const row = (id: string, mainView: number): SessionSummary => ({
    id: id as SessionId, displayTitle: id, cwd: `/${id}`, retainedBy: { mainView }, running: false, blank: false, updatedAt: 0,
  })
  it('follows mainView ownership across selection changes and deselection', () => {
    const background = row('background', 0)
    const main = row('main', 1)
    const state: SessionListState = { ids: [background.id, main.id], byId: { [background.id]: background, [main.id]: main }, phase: 'ready', projectionsBySession: {} }
    expect(mainViewSession(state)).toBe(main)
    state.byId = { [background.id]: row('background', 1), [main.id]: row('main', 0) }
    expect(mainViewSession(state)?.id).toBe(background.id)
    state.byId = { [main.id]: row('main', 0) }
    expect(mainViewSession(state)).toBeUndefined()
  })
})
