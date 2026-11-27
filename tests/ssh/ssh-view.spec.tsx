// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { SSHView } from '../../src/client/ssh/SSHView.tsx'
import type { SshConnection } from '../../src/shared/types.ts'

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

it('opens SSH failure details outside the sidebar and retries the same host', async () => {
  // jsdom does not implement the browser's modal-dialog lifecycle.
  const dialogPrototype = HTMLDialogElement.prototype
  if (typeof dialogPrototype.showModal !== 'function') {
    Object.defineProperties(dialogPrototype, {
      showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true } },
      close: { configurable: true, value(this: HTMLDialogElement) { this.open = false } },
    })
    onTestFinished(() => {
      Reflect.deleteProperty(dialogPrototype, 'showModal')
      Reflect.deleteProperty(dialogPrototype, 'close')
    })
  }
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
  const requests: unknown[] = []
  const detail = 'ssh: connect to host build.example.com port 22: Connection refused'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = url.split('/').at(-1)
    if (method === 'ssh.connect') {
      requests.push(JSON.parse(String(init?.body)))
      if (requests.length <= 2) {
        return Response.json({ ok: false, error: { code: 'ssh-network', message: detail } }, { status: 502 })
      }
    }
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
  const failure = () => document.querySelector<HTMLDialogElement>('dialog[aria-label="SSH 连接失败"]')
  expect(failure()?.open).toBe(true)
  expect(document.querySelector('.dvw-ssh-error')).toBeNull()
  expect(failure()?.textContent).toContain('无法连接到「build」')
  expect(failure()?.querySelector('details')?.open).toBe(false)
  await act(async () => failure()?.querySelector('summary')?.click())
  expect(failure()?.querySelector('details')?.open).toBe(true)
  expect(failure()?.querySelector('pre')?.textContent).toBe(detail)

  const action = (label: string) => Array.from(failure()!.querySelectorAll('button')).find(button => button.textContent?.trim() === label)!
  await act(async () => action('关闭').click())
  expect(failure()).toBeNull()
  expect(target.disabled).toBe(false)

  await act(async () => target.click())
  await act(async () => action('重试').click())
  expect(requests).toHaveLength(3)
  expect(requests[2]).toEqual(requests[1])
  expect(failure()).toBeNull()
  expect(onTerminal).toHaveBeenCalledWith(connection)
})

it('opens the SSH connection form in a top-level dialog layer', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const method = url.split('/').at(-1)
    const value = method === 'ssh.hosts' ? { hosts: [] } : []
    return Response.json({ ok: true, value })
  }))
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => {
    root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onDiff={() => {}} onChanged={() => {}} onTerminal={() => {}}/>)
  })
  await act(async () => document.querySelector<HTMLButtonElement>('[title="新建远程"]')!.click())

  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="新建 SSH 远程"]')!
  const layer = dialog.parentElement
  expect(layer?.parentElement).toBe(document.body)
  expect(layer?.classList).toContain('dvw-ssh-dialog-layer')
  expect(dialog.querySelector<HTMLDetailsElement>('details')?.open).toBe(true)
  expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe('连接')
})

it.each([
  ['password', true], ['password', false], ['key', false],
] as const)('reopens a %s target with password saved = %s', async (method, passwordSaved) => {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const action = url.split('/').at(-1)
    if (action === 'ssh.connect') {
      requests.push(JSON.parse(String(init?.body)))
      if (requests.at(-1)?.useSavedPassword) {
        return Response.json({ ok: false, error: { code: 'ssh-password-unavailable', message: 'unavailable' } }, { status: 409 })
      }
    }
    const value = action === 'ssh.hosts' ? { hosts: [{ alias: 'build', hostName: 'build', identityFile: '/original/key' }] } : action === 'ssh.connect' ? {
      id: 'password-login', label: 'build', host: 'build', hostName: 'build', root: '/srv', connectedAt: 'now', passwordSaved,
    } : []
    return Response.json({ ok: true, value })
  }))
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onDiff={() => {}} onChanged={() => {}} onTerminal={() => {}}/>))
  await act(async () => document.querySelector<HTMLButtonElement>('[title="新建远程"]')!.click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="新建 SSH 远程"]')!
  const set = async (label: string, value: string) => {
    const input = [...dialog.querySelectorAll('label')].find(item => item.querySelector('span')?.textContent === label)?.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })))
  }
  const select = dialog.querySelector<HTMLSelectElement>('select')!
  const changeMethod = async (value: string) => {
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  await set('私钥路径', '/local/test key')
  await changeMethod('password')
  expect(dialog.textContent).toContain('登录用户')
  expect(dialog.textContent).toContain('登录密码')
  expect([...dialog.querySelectorAll('label span')].some(span => span.textContent === '私钥路径')).toBe(false)
  await set('输入 SSH 主机', 'build')
  await set('登录用户', 'root')
  await set('登录密码', 'one-time-secret')
  if (method === 'key') await changeMethod('key')
  await act(async () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]).toMatchObject({ host: 'build', user: 'root' })
  if (method === 'password') {
    expect(requests[0]).toMatchObject({ password: 'one-time-secret', savePassword: true })
    expect(requests[0]).not.toHaveProperty('identityFile')
  } else {
    expect(requests[0]).toHaveProperty('identityFile', '/local/test key')
    expect(requests[0]).not.toHaveProperty('password')
  }
  expect(localStorage.getItem('dvw:ssh-hosts:v1')).not.toContain('one-time-secret')

  await act(async () => root!.unmount())
  root = createRoot(node)
  await act(async () => root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onDiff={() => {}} onChanged={() => {}} onTerminal={() => {}}/>))
  await act(async () => document.querySelector<HTMLButtonElement>('.dvw-ssh-target-main')!.click())
  if (method === 'password') {
    expect(document.querySelector<HTMLSelectElement>('[aria-label="验证方式"]')?.value).toBe('password')
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('')
    expect(requests).toHaveLength(passwordSaved ? 2 : 1)
    if (passwordSaved) {
      expect(requests[1]).toHaveProperty('useSavedPassword', true)
      expect(requests[1]).not.toHaveProperty('password')
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('请重新输入')
    }
  } else {
    expect(requests[1]).toMatchObject({ user: 'root', identityFile: '/local/test key' })
  }
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

it('downloads remote files and uploads drops to the directory under the pointer', async () => {
  const connection: SshConnection = {
    id: 'remote-transfer', host: 'transfer', hostName: 'transfer.invalid', label: 'transfer',
    root: '/srv/project', connectedAt: '2026-11-23T00:00:00Z',
  }
  const directory = { name: 'docs', path: 'docs', kind: 'directory' }
  const file = { name: 'index.txt', path: 'index.txt', kind: 'file' }
  const upload = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const address = new URL(url, 'http://workspace.local')
    if (address.pathname.endsWith('/upload')) {
      upload(address.searchParams, init?.body)
      return Response.json({ ok: true, value: { name: 'data.bin', path: 'docs/data.bin', kind: 'file' } })
    }
    const method = address.pathname.split('/').at(-1)
    const value = method === 'ssh.hosts' ? { hosts: [] } : method === 'ssh.connections' ? [connection]
      : method === 'ssh.list' && JSON.parse(String(init?.body)).path === '' ? [directory, file] : []
    return Response.json({ ok: true, value })
  }))
  const onAddToDsh = vi.fn()
  const node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => root!.render(<SSHView sessionId="s" visible isDirty={() => false} onOpen={() => {}} onAddToDsh={onAddToDsh} onDiff={() => {}} onChanged={() => {}} onTerminal={() => {}}/>))
  const rows = document.querySelectorAll<HTMLElement>('.dvw-ssh-tree-row')
  expect(rows).toHaveLength(2)
  const href = vi.fn()
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { href(this.href) })
  const menu = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent?.trim() === label)!
  try {
    await act(async () => rows[1]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    expect(menu('下载')).toBeDefined()
    expect(menu('重命名')).toBeDefined()
    expect(menu('删除')).toBeDefined()
    await act(async () => menu('下载').click())
    const url = new URL(href.mock.calls[0]![0])
    expect(url.pathname).toBe('/dsh-vscode/download')
    expect(url.searchParams.get('path')).toBe('ssh://remote-transfer/index.txt')
    await act(async () => rows[1]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    await act(async () => menu('添加到 DSH 对话').click())
    expect(onAddToDsh).toHaveBeenCalledWith(connection, file)
  } finally { download.mockRestore() }

  const binary = new File([new Uint8Array([0, 255])], 'data.bin')
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [binary] } })
  await act(async () => rows[0]!.dispatchEvent(drop))
  expect(drop.defaultPrevented).toBe(true)
  const [params, body] = upload.mock.calls[0]!
  expect(params.get('directory')).toBe('ssh://remote-transfer/docs')
  expect(params.get('name')).toBe('data.bin')
  expect(body).toBe(binary)
})
