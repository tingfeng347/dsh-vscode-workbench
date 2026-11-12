// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import * as cordis from '@deepseek-ai/cordis'
import * as stores from '@deepseek-ai/dsh-client-store'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import type { ClientTerminals, TerminalRemote, TerminalView } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { TerminalFrame, TerminalInput, WebTerminalInfo } from '@deepseek-ai/dsh-api-terminal-controller/types'
import { afterEach, expect, it, vi } from 'vitest'
import { TerminalWorkspaces, terminalIssue } from '../src/client/terminal.ts'

// Run the actual published Client controller. Only its Host transport is replaced.
const require = createRequire(import.meta.url)
let sdk!: { ClientTerminals: typeof ClientTerminals }
new Function('window', readFileSync(require.resolve('@deepseek-ai/dsh-api-terminal-controller/client'), 'utf8'))({
  __ModuleLoader__: { load: ({ factory }: { factory(require: (id: string) => unknown): typeof sdk }) => {
    sdk = factory(id => ({ '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': stores, '@deepseek-ai/dsh-api-gateway/client': gateway } as Record<string, unknown>)[id])
  } },
})
const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); localStorage.clear() })

class Feed<T> implements AsyncIterable<T> {
  private values: T[] = []
  private wake?: () => void
  constructor(private readonly signal: AbortSignal) { signal.addEventListener('abort', () => this.wake?.(), { once: true }) }
  push(value: T) { this.values.push(value); this.wake?.() }
  async *[Symbol.asyncIterator]() {
    while (!this.signal.aborted) {
      if (this.values.length > 0) yield this.values.shift()!
      else await new Promise<void>(resolve => { this.wake = resolve })
    }
  }
}

function harness() {
  const ctx = new cordis.Context()
  const host = new Map<string, WebTerminalInfo>()
  const inputs: TerminalInput[] = []
  const holds = new Set<string>()
  const feeds = new Map<string, Feed<TerminalFrame>>()
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const create = vi.fn(async (session: string, request: { id: WebTerminalInfo['id']; cols: number; rows: number }) => {
    const info: WebTerminalInfo = { ...request, title: 'zsh', cwd: `/${session}`, shell: { path: '/bin/zsh', name: 'zsh', args: [] }, state: 'running', exitCode: null }
    host.set(info.id, info)
    return ok(info)
  })
  let failClose = false
  const remote = {
    environment: async () => ok({ cwd: '/s1', maxCols: 500, maxRows: 200, scrollback: 1000, maxInputBytes: 65536, maxBufferedBytes: 2097152 }),
    shells: async () => ok([{ path: '/bin/zsh', name: 'zsh', args: [] }]),
    list: async () => ok([...host.values()]), create,
    rename: async (_session: string, id: string, title: string) => { host.set(id, { ...host.get(id)!, title }); return ok(host.get(id)!) },
    close: vi.fn(async (_session: string, id: string) => {
      if (failClose) return { ok: false, error: new Error('close failed') }
      host.delete(id); return ok(undefined)
    }),
    retain: (_session: string, id: string, signal: AbortSignal) => {
      holds.add(id); signal.addEventListener('abort', () => holds.delete(id), { once: true })
      const feed = new Feed(signal); feed.push({ type: 'retained' }); return feed
    },
    attach: (_session: string, id: string, signal: AbortSignal) => {
      const feed = new Feed<TerminalFrame>(signal)
      let sequence = 0
      feed.push({ type: 'snapshot', sequence, screen: 'ready\r\n', info: host.get(id)!, writable: true })
      feeds.set(id, feed)
      return Object.assign(feed, { send: async (command: TerminalInput) => {
        inputs.push(command)
        feed.push({ type: 'ack', sequence: command.sequence })
        if (command.type === 'write') feed.push({ type: 'output', sequence: ++sequence, data: command.data })
      } })
    },
  }
  ctx.provide('connection', { generation: stores.createSnapshotStore(1) } as never)
  ctx.provide('remote', { terminal: remote, $stream: (options: { open(signal: AbortSignal): AsyncIterable<unknown> }) => {
    const controller = new AbortController()
    return { dispose: async () => controller.abort(), async *[Symbol.asyncIterator]() {
      for await (const value of options.open(controller.signal)) yield { value, generation: 1, signal: controller.signal, accept() {} }
    } }
  } } as never)
  const models = new sdk.ClientTerminals(ctx.isolate('webTerminals'), remote as unknown as TerminalRemote)
  const workspaces = new TerminalWorkspaces(models)
  cleanup.push(() => ctx.fiber.dispose(), () => workspaces.dispose())
  return { ctx, models, workspaces, host, inputs, holds, create, remote, failClose: (value: boolean) => { failClose = value } }
}

function screen(model: TerminalView) {
  const output: string[] = []
  const unsubscribe = model.state.subscribe(() => {
    const render = model.state.getSnapshot().render
    if (render === undefined) return
    output.push(render.frame.type === 'snapshot' ? render.frame.screen : render.frame.data)
    queueMicrotask(() => model.acknowledge(render.revision))
  })
  const unmount = model.mount()
  cleanup.push(unsubscribe, unmount)
  return output
}

it('uses official terminal models for independent split screens, typed input, resizing, rename and close', async () => {
  const h = harness()
  const workspace = h.workspaces.get('s1')
  const first = await workspace.create(); const second = await workspace.create()
  const model = workspace.view(first.id)
  const output = screen(model); screen(workspace.view(second.id))
  await vi.waitFor(() => expect(model.state.getSnapshot().writable).toBe(true))
  model.write('你好\r'); model.resize(120, 30)
  await vi.waitFor(() => expect(output.join('')).toContain('你好'))
  expect(h.inputs).toContainEqual({ type: 'resize', sequence: 2, cols: 120, rows: 30 })
  await workspace.rename(first.id, 'server')
  expect(workspace.getSnapshot().terminals[0]?.title).toBe('server')
  expect(h.host.get(model.id)?.title).toBe('server')
  workspace.close(first.id)
  await vi.waitFor(() => expect(h.host.size).toBe(1))
  expect(workspace.getSnapshot().terminals.map(row => row.id)).toEqual([second.id])
})

it('keeps hidden and background sessions held and restores saved identities without allocating again', async () => {
  const h = harness()
  const first = await h.workspaces.get('s1').create()
  const second = await h.workspaces.get('s2').create()
  const model = h.workspaces.get('s1').view(first.id)
  const stop = model.mount(); stop()
  await vi.waitFor(() => expect(h.holds.size).toBe(2))
  // A new layout owner sees the same official identity, including a dormant Session.
  const restored = new TerminalWorkspaces(h.models)
  cleanup.push(() => restored.dispose())
  await restored.get('s1').refresh()
  expect(restored.get('s1').view(first.id).id).toBe(model.id)
  expect(restored.get('s2').getSnapshot().terminals[0]?.id).toBe(second.id)
  expect(h.create).toHaveBeenCalledTimes(2)
  expect(h.remote.close).not.toHaveBeenCalled()
})

it('keeps failed process cleanup visible and retries through the official controller', async () => {
  const h = harness()
  const workspace = h.workspaces.get('s1')
  const entry = await workspace.create()
  h.failClose(true); workspace.close(entry.id)
  await vi.waitFor(() => expect(h.models.closeFailures.getSnapshot()).toHaveLength(1))
  h.failClose(false)
  h.models.retryClose(h.models.closeFailures.getSnapshot()[0]!.id)
  await vi.waitFor(() => expect(h.host.size).toBe(0))
  expect(h.models.closeFailures.getSnapshot()).toHaveLength(0)
})

it('explains missing saved terminals instead of suggesting that they were restored', () => {
  expect(terminalIssue({ phase: 'failed', writable: false, issue: 'missingTerminal' })).toContain('不存在')
})

it('forgets saved terminals that did not survive a DSH restart', async () => {
  const first = harness()
  const entry = await first.workspaces.get('s1').create()
  expect(first.workspaces.get('s1').getSnapshot().terminals.map(row => row.id)).toEqual([entry.id])
  // The layout identity survives in localStorage, but the new Host has no such process.
  const second = harness()
  const restored = new TerminalWorkspaces(second.models)
  cleanup.push(() => restored.dispose())
  const workspace = restored.get('s1')
  expect(workspace.getSnapshot().terminals.map(row => row.id)).toEqual([entry.id])
  await workspace.refresh()
  expect(workspace.getSnapshot().terminals).toHaveLength(0)
  expect(second.remote.close).not.toHaveBeenCalled()
})

it('preserves concurrent terminal additions from other windows and synchronizes external closures', async () => {
  const h = harness()
  const other = new TerminalWorkspaces(h.models)
  cleanup.push(() => other.dispose())
  const first = await h.workspaces.get('s1').create()
  const second = await other.get('s2').create()
  const restored = new TerminalWorkspaces(h.models)
  cleanup.push(() => restored.dispose())
  expect(restored.get('s1').getSnapshot().terminals.map(row => row.id)).toEqual([first.id])
  expect(restored.get('s2').getSnapshot().terminals.map(row => row.id)).toEqual([second.id])
  // Browsers deliver storage events to the other windows, never to the writer.
  window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }))
  expect(h.workspaces.get('s2').getSnapshot().terminals).toHaveLength(1)
  other.get('s2').close(second.id)
  window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }))
  expect(h.workspaces.get('s2').getSnapshot().terminals).toHaveLength(0)
  expect(h.workspaces.get('s1').getSnapshot().terminals).toHaveLength(1)
})
