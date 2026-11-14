// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GENERATED_FILE_OPEN_EVENT,
  installDshChangedFilesOpenInterceptor,
  installGeneratedFileOpenInterceptor,
  parseGeneratedFileAddress,
  type GeneratedFileOpenDetail,
  type GeneratedFileOpenHost,
} from '../src/client/generatedFileLinks.ts'

const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function encodedAddress(sessionId: string, path: string): string {
  const encodedSession = encodeURIComponent(sessionId)
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `dsh-resource://file/session/${encodedSession}/${encodedPath}`
}

function createHost(sessionId: string | undefined = 'session-1') {
  let mounted: string | undefined = sessionId
  const original = vi.fn()
  const sidebar = {
    mounted: { getSnapshot: () => mounted },
    openResource: original,
  } as unknown as GeneratedFileOpenHost
  return {
    sidebar,
    original,
    setMounted(value: string | undefined) { mounted = value },
  }
}

function listen() {
  const listener = vi.fn<(event: CustomEvent<GeneratedFileOpenDetail>) => void>()
  window.addEventListener(GENERATED_FILE_OPEN_EVENT, listener as unknown as EventListener)
  disposers.push(() => window.removeEventListener(GENERATED_FILE_OPEN_EVENT, listener as unknown as EventListener))
  return listener
}

type OpenWithLine = (address: string, options?: { params?: { line?: number } }) => void

describe('generated file addresses', () => {
  it('decodes encoded session ids and paths without resolving the path', () => {
    const address = encodedAddress('session/# 1', 'src/../文档/a #1.ts')
    expect(parseGeneratedFileAddress(address)).toEqual({
      sessionId: 'session/# 1',
      path: 'src/../文档/a #1.ts',
    })
  })

  it('supports encoded and literal path separators while ignoring query and fragment suffixes', () => {
    expect(parseGeneratedFileAddress('dsh-resource://file/session/a/src/lib%20x/file.ts?line=9#L9')).toEqual({
      sessionId: 'a',
      path: 'src/lib x/file.ts',
    })
    expect(parseGeneratedFileAddress('dsh-resource://file/session/a/src%2Flib/file.ts')).toEqual({
      sessionId: 'a',
      path: 'src/lib/file.ts',
    })
  })

  it('rejects unrelated, malformed, and incomplete addresses', () => {
    for (const address of [
      'https://example.com/file.ts',
      'dsh-resource://image/session/a/file.ts',
      'dsh-resource://file/absolute/tmp/file.ts',
      'dsh-resource://file/session//file.ts',
      'dsh-resource://file/session/a/',
      'dsh-resource://file/session/%E0%A4%A/file.ts',
      'dsh-resource://file/session/a',
    ]) expect(parseGeneratedFileAddress(address)).toBeUndefined()
  })
})

describe('generated file interceptor', () => {
  it('opens a same-session file as a CustomEvent with its requested line', () => {
    const host = createHost('session-1')
    const listener = listen()
    disposers.push(installGeneratedFileOpenInterceptor(host.sidebar, () => true))
    const address = encodedAddress('session-1', 'src/generated file.ts')

    ;(host.sidebar.openResource as unknown as OpenWithLine)(address, { params: { line: 27 } })

    expect(host.original).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0]![0].detail).toEqual({
      sessionId: 'session-1',
      path: 'src/generated file.ts',
      line: 27,
    })
  })

  it('omits invalid line values from the event detail', () => {
    const host = createHost('session-1')
    const listener = listen()
    disposers.push(installGeneratedFileOpenInterceptor(host.sidebar, () => true))

    ;(host.sidebar.openResource as unknown as OpenWithLine)(encodedAddress('session-1', 'a.ts'), { params: { line: Number.NaN } })

    expect(listener.mock.calls[0]![0].detail).toEqual({ sessionId: 'session-1', path: 'a.ts' })
  })

  it('passes other sessions, invalid addresses, and hidden workbenches through unchanged', () => {
    const host = createHost('session-1')
    let visible = true
    const listener = listen()
    disposers.push(installGeneratedFileOpenInterceptor(host.sidebar, () => visible))
    const otherSession = encodedAddress('session-2', 'a.ts')
    const unsupported = 'https://example.com/a.ts'
    const currentSession = encodedAddress('session-1', 'a.ts')
    const options = { params: { line: 3 } }

    ;(host.sidebar.openResource as unknown as OpenWithLine)(otherSession, options)
    ;(host.sidebar.openResource as unknown as OpenWithLine)(unsupported)
    visible = false
    ;(host.sidebar.openResource as unknown as OpenWithLine)(currentSession, options)

    expect(listener).not.toHaveBeenCalled()
    expect(host.original.mock.calls).toEqual([
      [otherSession, options],
      [unsupported],
      [currentSession, options],
    ])
  })

  it('uses the mounted session at call time', () => {
    const host = createHost('session-1')
    const listener = listen()
    disposers.push(installGeneratedFileOpenInterceptor(host.sidebar, () => true))

    host.setMounted('session-2')
    host.sidebar.openResource(encodedAddress('session-2', 'b.ts'))

    expect(host.original).not.toHaveBeenCalled()
    expect(listener.mock.calls[0]![0].detail).toEqual({ sessionId: 'session-2', path: 'b.ts' })
  })

  it('wraps once for repeat installers and restores the original after the final dispose', () => {
    const host = createHost('session-1')
    const firstDispose = installGeneratedFileOpenInterceptor(host.sidebar, () => true)
    const wrapper = host.sidebar.openResource
    const secondDispose = installGeneratedFileOpenInterceptor(host.sidebar, () => true)

    expect(host.sidebar.openResource).toBe(wrapper)
    firstDispose()
    expect(host.sidebar.openResource).toBe(wrapper)
    secondDispose()
    expect(host.sidebar.openResource).toBe(host.original)

    host.sidebar.openResource(encodedAddress('session-1', 'a.ts'))
    expect(host.original).toHaveBeenCalledOnce()
  })
})

describe('DSH changed-files card interceptor', () => {
  function changedFilesCard() {
    const card = document.createElement('div')
    card.dataset.changedFiles = 'true'
    card.innerHTML = `
      <button type="button" aria-label="View this turn's changes">已编辑 2 个文件</button>
      <button type="button" aria-label="View changes to src/first.ts"><span class="row_path_hash">src/first.ts</span><span>+4 -1</span></button>
      <button type="button" aria-label="View changes to src/second.ts"><span class="row_path_hash">src/second.ts</span><span>+2 -0</span></button>
      <button type="button" aria-expanded="false" aria-label="展开全部 2 个改动文件">全部 2 个文件</button>
    `
    document.body.append(card)
    return card
  }

  it('opens the exact file row in the workbench before DSH handles the click', () => {
    const host = createHost('session-1')
    const listener = listen()
    const showWorkbench = vi.fn()
    const card = changedFilesCard()
    disposers.push(installDshChangedFilesOpenInterceptor(host.sidebar, () => true, showWorkbench))

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    card.querySelectorAll('button')[2]!.querySelector('span')!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(showWorkbench).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0]![0].detail).toEqual({ sessionId: 'session-1', path: 'src/second.ts' })
  })

  it('opens the first visible changed file when the card header is clicked', () => {
    const host = createHost('session-2')
    const listener = listen()
    const showWorkbench = vi.fn()
    const card = changedFilesCard()
    disposers.push(installDshChangedFilesOpenInterceptor(host.sidebar, () => true, showWorkbench))

    card.querySelector('button')!.click()

    expect(showWorkbench).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0]![0].detail).toEqual({ sessionId: 'session-2', path: 'src/first.ts' })
  })

  it('leaves expand-all and unavailable sessions to DSH', () => {
    const host = createHost(undefined)
    const listener = listen()
    const showWorkbench = vi.fn()
    const card = changedFilesCard()
    disposers.push(installDshChangedFilesOpenInterceptor(host.sidebar, () => true, showWorkbench))

    card.querySelector('[aria-expanded]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    host.setMounted('session-1')
    card.querySelectorAll('button')[1]!.click()
    host.setMounted(undefined)
    card.querySelectorAll('button')[1]!.click()

    expect(showWorkbench).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('leaves the official changed-file behavior intact while the workbench is hidden', () => {
    const host = createHost('session-1')
    const listener = listen()
    const showWorkbench = vi.fn()
    let visible = false
    disposers.push(installDshChangedFilesOpenInterceptor(host.sidebar, () => visible, showWorkbench))
    const card = changedFilesCard()

    const hiddenEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    card.querySelectorAll('button')[1]!.dispatchEvent(hiddenEvent)
    expect(hiddenEvent.defaultPrevented).toBe(false)
    expect(showWorkbench).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()

    visible = true
    card.querySelectorAll('button')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(showWorkbench).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
  })
})
