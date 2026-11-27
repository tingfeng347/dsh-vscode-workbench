import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { readFile } from 'node:fs/promises'
import { apply as applyConnection, type HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { apply, inject } from '../../src/index.ts'
import type { HostContext, WorkbenchWebServer } from '../../src/host/context.ts'
import { mainViewSession } from '../../src/client/dsh/session.ts'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

describe('Harness plugin installation compatibility', () => {
  it('passes the official version gate on the supported runtime without exemptions', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    // Also validate the installed app-boot runtime, including the next-channel check.
    expect(evaluatePluginCompatibility(manifest)).toBeUndefined()
    // Check peer ranges too: engines.dsh takes precedence in the official gate.
    const { engines, ...peerManifest } = manifest
    for (const runtime of ['0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.5', '0.2.2-rc.1', '0.2.2-rc.2', '0.2.2-rc.3', '0.2.2-rc.5',
      '0.2.3-rc.1', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
      expect(evaluatePluginCompatibility(manifest, {}, runtime), runtime).toBeUndefined()
      expect(evaluatePluginCompatibility(peerManifest, {}, runtime), runtime).toBeUndefined()
    }
    // 0.2.1-alpha.2 boots the client but never opens the workbench, so the floor stays at the first rc.
    for (const runtime of ['0.1.1-rc.2', '0.2.0-rc.2', '0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-rc.0']) {
      expect(evaluatePluginCompatibility(manifest, {}, runtime), runtime).toMatchObject({
        runtimeVersion: runtime, exempted: false, requirements: { 'engines.dsh': engines.dsh },
      })
    }
  })
})

describe('Harness 0.2 host integration', () => {
  it('serves the real routes when Harness owns route authentication', async () => {
    const directory = resolve('modern-runtime')
    const routes: Parameters<WorkbenchWebServer['register']>[0][] = []
    const upgrades: Parameters<WorkbenchWebServer['registerUpgrade']>[0][] = []
    const ctx = {
      connection: {},
      sessions: { get: () => undefined },
      workingDirectory: { get: () => directory },
      webServer: {
        register: (route: Parameters<WorkbenchWebServer['register']>[0]) => {
          expect(route.auth).toBe('required')
          routes.push(route)
          return () => {}
        },
        registerUpgrade: (route: Parameters<WorkbenchWebServer['registerUpgrade']>[0]) => {
          expect(route.auth).toBe('required')
          upgrades.push(route)
          return () => {}
        },
      },
      effect(callback: () => void | (() => void)) { const dispose = callback(); if (dispose) cleanup.push(dispose) },
    } as unknown as HostContext
    apply(ctx)
    expect(routes.length).toBeGreaterThan(10)
    expect(upgrades.map(route => route.path).sort()).toEqual(['/dsh-vscode/ws/debug', '/dsh-vscode/ws/files', '/dsh-vscode/ws/lsp', '/dsh-vscode/ws/ssh'])

    const request = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      const route = routes.find(route => route.kind === 'exact' ? route.path === path : path.startsWith(route.path))
      if (!route) { res.writeHead(404); res.end(); return }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => request.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve, reject) => request.close(error => error ? reject(error) : resolve())))
    const base = `http://127.0.0.1:${(request.address() as AddressInfo).port}`
    expect((await fetch(`${base}/dsh-vscode/codicons/codicon.ttf`)).status).toBe(200)
    expect((await fetch(`${base}/dsh-vscode/api/workspace`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'missing' }),
    })).status).toBe(404)
  })

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
    const session = {
      header: { cwd: original },
      requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-flash' } }),
    } as unknown as Session
    const llm = {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'gateway', name: '团队网关' }],
      listModels: async (provider: string) => provider === 'deepseek-official'
        ? [{ provider, id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }]
        : [{ provider, id: 'team-coder-v1', name: 'Team Coder' }],
      stream: vi.fn(async function* (_options: GenerateOptions) {
        yield { type: 'text-delta', index: 0, text: '  return value' }
      }),
    }
    const sessionController = {
      canOpenWorkspacePath: () => true,
      workspacePathApplications: async () => [{ id: 'com.example.player', name: 'Test Player', default: true, icon: null }],
      openWorkspacePath: vi.fn(async () => ({ opened: true as const })),
      modelCatalog: async () => ({
        default: { provider: 'deepseek-official', model: 'deepseek-flash' },
        groups: [
          {
            id: 'deepseek-official',
            name: 'DeepSeek',
            models: [
              { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', badge: { text: { zh: '1017', en: '1017' }, tone: 'info' } },
              { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
            ],
          },
          { id: 'gateway', name: '团队网关', models: [{ id: 'team-coder-v1', name: 'Team Coder' }] },
        ],
        failures: [],
      }),
    }
    const sessionProjections = {
      stateOf: () => ({ pending: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }),
    }
    const agentDefaultModel = {
      currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }),
    }
    const effects: Array<() => void> = []
    const ctx = {
      connection,
      get: (name: string) => name === 'llm'
        ? llm
        : name === 'sessionController'
          ? sessionController
          : name === 'sessionProjections'
            ? sessionProjections
            : name === 'agentDefaultModel'
              ? agentDefaultModel
              : undefined,
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
    const modelCatalog = await fetch(`${base}/dsh-vscode/api/commit.models`, {
      method: 'POST', headers, body: JSON.stringify({ sessionId: 'main' }),
    })
    expect(await modelCatalog.json()).toMatchObject({
      value: {
        models: [
          { provider: 'deepseek-official', model: 'deepseek-flash', providerName: 'DeepSeek', badge: { text: '1017', tone: 'info' } },
          { provider: 'deepseek-official', model: 'deepseek-v4-pro', providerName: 'DeepSeek' },
          { provider: 'gateway', model: 'team-coder-v1', providerName: '团队网关' },
        ],
        unavailable: [],
        defaultModel: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      },
    })
    const workspace = (id = 'main') => fetch(`${base}/dsh-vscode/api/workspace`, { method: 'POST', headers, body: JSON.stringify({ sessionId: id }) })
    expect(await (await workspace()).json()).toMatchObject({ value: { cwd: original } })
    directory = changed
    expect(await (await workspace()).json()).toMatchObject({ value: { cwd: changed } })
    expect((await workspace('missing')).status).toBe(404)
    expect((await fetch(`${base}/dsh-vscode/api/workspace`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })).status).toBe(403)
    directory = process.cwd()
    const complete = (body: Record<string, unknown>) => fetch(`${base}/dsh-vscode/api/editor.inlineCompletion`, {
      method: 'POST', headers, body: JSON.stringify({ sessionId: 'main', path: 'package.json', language: 'typescript', prefix: 'unsaved draft', suffix: '\n}', ...body }),
    })
    expect(await (await complete({})).json()).toEqual({ ok: true, value: { text: '  return value' } })
    expect(llm.stream).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }))
    const prompt = llm.stream.mock.calls.at(-1)?.[0].messages[0]?.content[0]
    expect(prompt).toMatchObject({ type: 'text', text: JSON.stringify({ path: 'package.json', language: 'typescript', prefix: 'unsaved draft', suffix: '\n}' }) })
    expect((await complete({ provider: 'gateway', model: 'team-coder-v1' })).status).toBe(200)
    expect(llm.stream).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'gateway', model: 'team-coder-v1' }))
    expect(await (await complete({ path: '.env.local' })).json()).toEqual({ ok: true, value: { text: '' } })
    expect((await complete({ path: '../package.json' })).status).toBe(403)
    expect((await complete({ prefix: 'x'.repeat(6001) })).status).toBe(400)
    expect(llm.stream).toHaveBeenCalledTimes(2)
    const applications = await fetch(`${base}/dsh-vscode/api/fs.applications`, {
      method: 'POST', headers, body: JSON.stringify({ sessionId: 'main', path: 'package.json' }),
    })
    expect(await applications.json()).toMatchObject({
      value: { available: true, applications: [{ id: 'com.example.player', name: 'Test Player', default: true }] },
    })
    const openExternal = await fetch(`${base}/dsh-vscode/api/fs.openExternal`, {
      method: 'POST', headers, body: JSON.stringify({ sessionId: 'main', path: 'package.json', application: 'com.example.player' }),
    })
    expect(await openExternal.json()).toMatchObject({ value: { opened: true } })
    expect(sessionController.openWorkspacePath).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('package.json'), application: 'com.example.player' }),
      expect.anything(),
    )
    expect((await fetch(`${base}/dsh-vscode-terminal/api/list`, { method: 'POST', headers, body: '{"sessionId":"main"}' })).status).toBe(404)
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
