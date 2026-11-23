// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SSHView } from '../src/client/SSHView.tsx'
import type { SshConnection } from '../src/types.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.replaceChildren()
})

it('shows the remote explorer heading and runs an explicit remote search', async () => {
  const connection: SshConnection = {
    id: 'connection-1',
    label: 'build',
    host: 'build',
    hostName: 'build.example.com',
    user: 'deploy',
    root: '/srv/app',
    connectedAt: '2026-11-23T00:00:00Z',
  }
  const searchRequests: string[] = []
  const fileRequests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = url.split('/').at(-1)
    if (method === 'ssh.git') return Response.json({ ok: false, error: { message: '当前远程工作区不在 Git 仓库中' } })
    if (method === 'ssh.list') {
      fileRequests.push(String(init?.body))
      if (fileRequests.length === 1) return Response.json({ ok: false, error: { message: '远程目录暂不可读' } }, { status: 502 })
      return Response.json({ ok: true, value: [{ name: 'remote.ts', path: 'remote.ts', kind: 'file' }] })
    }
    const value = method === 'ssh.hosts'
      ? { hosts: [], configPath: '/tmp/ssh/config' }
      : method === 'ssh.connections'
        ? [connection]
        : method === 'ssh.search'
          ? (searchRequests.push(String(init?.body)), {
              matches: [{ path: 'src/app.ts', line: 4, column: 3, preview: 'const remote = true', match: 'remote', lineHash: 'hash' }],
              limited: false,
            })
          : []
    return Response.json({ ok: true, value })
  }))

  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => {
    root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onDiff={() => {}} onChanged={() => {}} onTerminal={() => {}}/>)
  })

  const files = await vi.waitFor(() => {
    const value = document.querySelector<HTMLButtonElement>('[data-remote-section="files"]')
    expect(value).not.toBeNull()
    return value!
  })
  expect(document.querySelector('.dvw-side-head')?.textContent).toBe('远程资源管理器')
  expect(document.querySelector('[title="断开 SSH"]')).not.toBeNull()
  expect(document.querySelector('.dvw-ssh-remote-switch')).toBeNull()
  expect(files.getAttribute('aria-expanded')).toBe('true')
  expect(files.textContent).toContain('文件')
  const sectionToggles = [...document.querySelectorAll<HTMLButtonElement>('.dvw-ssh-section-toggle')]
  expect(sectionToggles).toHaveLength(2)
  for (const toggle of sectionToggles) {
    expect(toggle.querySelectorAll(':scope > .codicon')).toHaveLength(2)
  }
  expect(sectionToggles[0]?.querySelector('.codicon-server')).not.toBeNull()
  expect(document.querySelector('.dvw-ssh-target-main small')).toBeNull()
  expect(document.querySelector('[title="刷新远程文件"]')).toBeNull()
  expect(document.querySelector('.dvw-ssh-tree-section > .dvw-ssh-panel-toolbar')).toBeNull()
  expect(document.querySelectorAll('.dvw-ssh-workspace-section')).toHaveLength(1)
  expect(document.querySelector('[data-remote-section="search"]')?.getAttribute('aria-pressed')).toBe('false')
  expect(document.querySelector('[data-remote-section="git"]')?.getAttribute('aria-pressed')).toBe('false')
  expect(document.querySelector('.dvw-ssh-tabs')).toBeNull()
  expect(document.querySelector('.dvw-ssh-workspace-bar')).toBeNull()
  expect(document.querySelector('[aria-label="选择远程工作区"]')?.closest('.dvw-ssh-workspace-section')).toBe(files.closest('.dvw-ssh-workspace-section'))
  expect(document.querySelector('.dvw-ssh-targets-resizer')).not.toBeNull()

  const retry = document.querySelector<HTMLButtonElement>('[aria-label="重试读取工作区"]')
  expect(retry).not.toBeNull()
  await act(async () => retry!.click())
  expect(document.querySelector('.dvw-ssh-tree-name')?.textContent).toBe('remote.ts')
  const tree = document.querySelector<HTMLElement>('.dvw-ssh-tree-section')


  await act(async () => files.click())
  expect(files.getAttribute('aria-expanded')).toBe('false')
  expect(document.querySelector<HTMLElement>('.dvw-ssh-panel')?.hidden).toBe(true)

  await act(async () => files.click())
  expect(document.querySelector('.dvw-ssh-panel')).not.toBeNull()

  const search = document.querySelector<HTMLButtonElement>('[data-remote-section="search"]')!
  await act(async () => search.click())
  expect(search.getAttribute('aria-pressed')).toBe('true')
  expect(files.textContent).toBe('返回文件')
  expect(tree?.hidden).toBe(true)
  expect(files.hasAttribute('aria-expanded')).toBe(false)
  expect(document.querySelector('.dvw-ssh-workspace-section')?.getAttribute('data-panel')).toBe('search')
  const input = document.querySelector<HTMLInputElement>('[aria-label="远程搜索"]')!
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(input, 'remote')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const submit = document.querySelector<HTMLButtonElement>('[aria-label="搜索远程文件"]')!
  expect(submit.disabled).toBe(false)
  await act(async () => submit.click())
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toBe('1 处匹配'))
  expect(searchRequests).toHaveLength(1)
  expect(JSON.parse(searchRequests[0]!)).toMatchObject({
    sessionId: 's',
    connectionId: 'connection-1',
    query: 'remote',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  })
  expect(document.querySelector('.dvw-ssh-result')?.textContent).toContain('4const remote = true')

  await act(async () => files.click())
  expect(document.querySelector('.dvw-ssh-tree-section')).not.toBeNull()
  expect(search.getAttribute('aria-pressed')).toBe('false')
  expect(tree?.hidden).toBe(false)
  expect(document.querySelector('.dvw-ssh-tree-section')).toBe(tree)

  const git = document.querySelector<HTMLButtonElement>('[data-remote-section="git"]')!
  await act(async () => git.click())
  expect(git.getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('.dvw-ssh-git-error')?.textContent).toContain('当前远程工作区不在 Git 仓库中')
  const previousRequests = fileRequests.length
  await act(async () => files.click())
  expect(git.getAttribute('aria-pressed')).toBe('false')
  expect(files.getAttribute('aria-expanded')).toBe('true')
  expect(document.querySelector('.dvw-ssh-tree-section')).not.toBeNull()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(fileRequests).toHaveLength(previousRequests + 1)
  expect(JSON.parse(fileRequests.at(-1)!)).toMatchObject({ connectionId: connection.id, path: '' })
})

it('opens the SSH terminal after a successful connection', async () => {
  const host = { alias: 'build', hostName: 'build.example.com', user: 'deploy' }
  const connection: SshConnection = {
    id: 'connection-2',
    label: 'build:.',
    host: 'build',
    hostName: 'build.example.com',
    user: 'deploy',
    root: '/srv/app',
    connectedAt: '2026-11-23T00:00:00Z',
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = url.split('/').at(-1)
    const value = method === 'ssh.hosts'
      ? { hosts: [host], configPath: '/tmp/ssh/config' }
      : method === 'ssh.connections'
        ? []
        : method === 'ssh.connect'
          ? connection
          : []
    return Response.json({ ok: true, value })
  }))
  const onTerminal = vi.fn()
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => {
    root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onDiff={() => {}} onChanged={() => {}} onTerminal={onTerminal}/>)
  })

  const target = await vi.waitFor(() => {
    const value = document.querySelector<HTMLButtonElement>('.dvw-ssh-target-main')
    expect(value).not.toBeNull()
    return value!
  })
  await act(async () => target.click())
  await vi.waitFor(() => expect(onTerminal).toHaveBeenCalledWith(connection))
})

it('switches the connected SSH workspace without reconnecting', async () => {
  const connection: SshConnection = {
    id: 'connection-root',
    label: 'build',
    host: 'build',
    hostName: 'build.example.com',
    root: '/srv/app',
    connectedAt: '2026-11-23T00:00:00Z',
  }
  const selected = {
    ...connection,
    id: 'connection-code',
    root: '/srv/app/code',
  }
  const workspaceRequests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = url.split('/').at(-1)
    const value = method === 'ssh.hosts'
      ? { hosts: [], configPath: '/tmp/ssh/config' }
      : method === 'ssh.connections'
        ? [connection]
        : method === 'ssh.list'
          ? [{ name: 'code', path: 'code', kind: 'directory' }]
          : method === 'ssh.workspace'
            ? (workspaceRequests.push(String(init?.body)), selected)
            : []
    return Response.json({ ok: true, value })
  }))
  const onTerminal = vi.fn()
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => {
    root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onDiff={() => {}} onChanged={() => {}} onTerminal={onTerminal}/>)
  })

  const picker = await vi.waitFor(() => {
    const value = document.querySelector<HTMLButtonElement>('[aria-label="选择远程工作区"]')
    expect(value).not.toBeNull()
    return value!
  })
  expect(picker.title).toContain('/srv/app')
  await act(async () => picker.click())
  const folder = await vi.waitFor(() => {
    const value = [...document.querySelectorAll<HTMLButtonElement>('.dvw-ssh-workspace-folders > button')].find(button => button.textContent === 'code')
    expect(value).not.toBeUndefined()
    return value!
  })
  await act(async () => folder.click())
  await vi.waitFor(() => expect(document.querySelector('.dvw-ssh-workspace-location')?.textContent).toContain('/srv/app/code'))
  await act(async () => document.querySelector<HTMLButtonElement>('.dvw-ssh-quickpick-actions .dvw-ssh-primary')!.click())

  await vi.waitFor(() => expect(onTerminal).toHaveBeenCalledWith(selected, { open: false }))
  expect(workspaceRequests).toHaveLength(1)
  expect(JSON.parse(workspaceRequests[0]!)).toMatchObject({
    sessionId: 's',
    connectionId: 'connection-root',
    path: '/srv/app/code',
  })
  expect(document.querySelector('[aria-label="选择远程工作区"]')?.getAttribute('title')).toContain('/srv/app/code')
})

it('keeps workspace switching available while showing remote Git', async () => {
  const connection: SshConnection = {
    id: 'connection-git',
    label: 'build',
    host: 'build',
    hostName: 'build.example.com',
    root: '/srv/app',
    connectedAt: '2026-11-23T00:00:00Z',
  }
  const selected = {
    ...connection,
    id: 'connection-git-code',
    root: '/srv/app/code',
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = url.split('/').at(-1)
    if (method === 'ssh.hosts') return Response.json({ ok: true, value: { hosts: [], configPath: '/tmp/ssh/config' } })
    if (method === 'ssh.connections') return Response.json({ ok: true, value: [connection] })
    if (method === 'ssh.list') {
      return Response.json({ ok: true, value: [{ name: 'code', path: 'code', kind: 'directory' }] })
    }
    if (method === 'ssh.git') {
      return Response.json({
        ok: false,
        error: { code: 'git-failed', message: '当前远程工作区不在 Git 仓库中' },
      }, { status: 400 })
    }
    if (method === 'ssh.workspace') return Response.json({ ok: true, value: selected })
    return Response.json({ ok: true, value: [] })
  }))
  const onTerminal = vi.fn()
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => {
    root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onDiff={() => {}} onChanged={() => {}} onTerminal={onTerminal}/>)
  })

  const git = await vi.waitFor(() => {
    const value = document.querySelector<HTMLButtonElement>('[data-remote-section="git"]')
    expect(value).not.toBeNull()
    return value!
  })
  await act(async () => git.click())
  await vi.waitFor(() => expect(document.querySelector('.dvw-ssh-git-error')?.textContent).toContain('不在 Git 仓库中'))

  const picker = document.querySelector<HTMLButtonElement>('[aria-label="选择远程工作区"]')!
  await act(async () => picker.click())
  const folder = await vi.waitFor(() => {
    const value = document.querySelector<HTMLButtonElement>('.dvw-ssh-workspace-folders > button')
    expect(value?.textContent).toBe('code')
    return value!
  })
  await act(async () => folder.click())
  await act(async () => document.querySelector<HTMLButtonElement>('.dvw-ssh-quickpick-actions .dvw-ssh-primary')!.click())

  await vi.waitFor(() => expect(picker.getAttribute('title')).toContain('/srv/app/code'))
  expect(onTerminal).toHaveBeenCalledWith(selected, { open: false })
})

it('retries a transient SSH connection close once after two seconds', async () => {
  vi.useFakeTimers()
  const host = { alias: 'build', hostName: 'build.example.com', user: 'deploy' }
  const connection: SshConnection = {
    id: 'connection-retry',
    label: 'build:.',
    host: 'build',
    hostName: 'build.example.com',
    user: 'deploy',
    root: '/srv/app',
    connectedAt: '2026-11-23T00:00:00Z',
  }
  let connectAttempts = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = url.split('/').at(-1)
    if (method === 'ssh.hosts') return Response.json({ ok: true, value: { hosts: [host], configPath: '/tmp/ssh/config' } })
    if (method === 'ssh.connections') return Response.json({ ok: true, value: [] })
    if (method === 'ssh.connect') {
      connectAttempts++
      if (connectAttempts === 1) {
        return Response.json({
          ok: false,
          error: { code: 'ssh-failed', message: 'Connection closed by 198.18.6.168 port 23820' },
        }, { status: 502 })
      }
      return Response.json({ ok: true, value: connection })
    }
    return Response.json({ ok: true, value: [] })
  }))
  const onTerminal = vi.fn()
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => {
    root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onDiff={() => {}} onChanged={() => {}} onTerminal={onTerminal}/>)
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })

  const target = document.querySelector<HTMLButtonElement>('.dvw-ssh-target-main')!
  await act(async () => target.click())
  expect(connectAttempts).toBe(1)
  expect(document.querySelector('[role="alert"]')).toBeNull()

  await act(async () => { await vi.advanceTimersByTimeAsync(1999) })
  expect(connectAttempts).toBe(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(connectAttempts).toBe(2)
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(onTerminal).toHaveBeenCalledWith(connection)
})
