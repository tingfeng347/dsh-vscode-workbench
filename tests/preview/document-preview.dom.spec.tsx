// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentPreview } from '../../src/client/preview/documentPreview.tsx'
import { ImagePreview } from '../../src/client/preview/ImagePreview.tsx'
import { fitPreviewWidth, type PreviewView } from '../../src/client/preview/PreviewViewport.tsx'

const runtime = vi.hoisted(() => ({ getDocument: vi.fn(), renderAsync: vi.fn(), api: vi.fn() }))
vi.mock('../../src/client/preview/runtime.ts', () => ({ loadPreviewRuntime: async () => ({ pdf: { getDocument: runtime.getDocument, GlobalWorkerOptions: {} }, renderAsync: runtime.renderAsync }) }))
vi.mock('../../src/client/transport/api.ts', () => ({ api: runtime.api }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
const observers: FakeObserver[] = []
class FakeObserver {
  node?: Element
  constructor(readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(this) }
  observe(node: Element) { this.node = node }
  disconnect() {}
}
const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
const getPage = vi.fn(async (_page: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: renderPage }))
const destroy = vi.fn(async () => {})

beforeEach(() => {
  runtime.api.mockReset().mockResolvedValue({ available: true, applications: [] })
  runtime.getDocument.mockReset().mockImplementation(() => ({ promise: Promise.resolve({ numPages: 20, getPage }), destroy }))
  runtime.renderAsync.mockReset()
  renderPage.mockClear(); getPage.mockClear(); destroy.mockClear(); observers.length = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(424)
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren()
  vi.useRealTimers()
})

async function mount(element: React.ReactNode) {
  if (root === undefined) { const node = document.createElement('div'); document.body.append(node); root = createRoot(node) }
  await act(async () => root!.render(element))
}
function button(label: string) { return document.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]')! }
const src = '/dsh-vscode/file?sessionId=s&path=report.pdf'

describe('document reader', () => {
  it('fits wide content without enlarging small images', () => {
    expect(fitPreviewWidth(424, 600)).toBeCloseTo(2 / 3)
    expect(fitPreviewWidth(424, 200)).toBe(1)
  })

  it('lays out every PDF page and only renders pages near the viewport', async () => {
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf"/>)
    expect(document.querySelectorAll('[data-pdf-page]')).toHaveLength(20)
    expect(getPage.mock.calls.map(call => call[0])).toEqual([1, 1])
    expect(button('选择缩放比例').textContent).toBe('67%')
    const second = observers.find(item => item.node?.getAttribute('data-pdf-page') === '2')!
    await act(async () => second.callback([{ isIntersecting: true }]))
    expect(getPage).toHaveBeenLastCalledWith(2)
    const canvas = second.node!.querySelector('canvas')!
    expect(canvas.hidden).toBe(false)
    await act(async () => second.callback([{ isIntersecting: false }]))
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    expect(canvas.hidden).toBe(true)
  })

  it('stores zoom and scroll on the tab without intercepting an ordinary wheel', async () => {
    const view: PreviewView = {}
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf" view={view}/>)
    await act(async () => button('选择缩放比例').click())
    const actualSize = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent === '100%')!
    await act(async () => actualSize.click())
    expect(view.zoom).toBe(1)
    const node = document.querySelector<HTMLElement>('.dvw-preview-scrollport')!
    node.scrollTop = 400; node.scrollLeft = 20
    await act(async () => node.dispatchEvent(new Event('scroll')))
    const wheel = new WheelEvent('wheel', { deltaY: 150, bubbles: true, cancelable: true })
    node.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(false)
    await mount(<span>another tab</span>)
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf" view={view}/>)
    expect(button('选择缩放比例').textContent).toBe('100%')
    expect(document.querySelector('.dvw-preview-scrollport')!.scrollTop).toBe(400)
    expect(document.querySelector('.dvw-preview-scrollport')!.scrollLeft).toBe(20)
  })

  it('destroys an in-flight PDF load when its editor closes', async () => {
    runtime.getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy })
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf"/>)
    expect(document.querySelector('[role="status"]')?.textContent).toContain('文档渲染中')
    await mount(<span>closed</span>)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('settles trackpad zoom before repainting PDF pages', async () => {
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf"/>)
    vi.useFakeTimers()
    const node = document.querySelector('.dvw-preview-scrollport')!
    const renders = renderPage.mock.calls.length
    for (let i = 0; i < 10; i++) {
      const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -1, cancelable: true, bubbles: true })
      node.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(renderPage).toHaveBeenCalledTimes(renders)
    await act(async () => { vi.advanceTimersByTime(121) })
    expect(renderPage).toHaveBeenCalledTimes(renders + 1)
    expect(runtime.getDocument).toHaveBeenCalledOnce()
  })

  it('retains mixed-orientation page geometry when restoring a tab', async () => {
    const view: PreviewView = {}
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf" view={view}/>)
    getPage.mockResolvedValueOnce({ getViewport: ({ scale }: { scale: number }) => ({ width: 1000 * scale, height: 650 * scale }), render: renderPage })
    const third = observers.find(item => item.node?.getAttribute('data-pdf-page') === '3')!
    await act(async () => third.callback([{ isIntersecting: true }]))
    expect((third.node as HTMLElement).style.getPropertyValue('--dvw-preview-width')).toBe('1000px')
    await mount(<span>another tab</span>)
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf" view={view}/>)
    expect(document.querySelector<HTMLElement>('[data-pdf-page="3"]')!.style.getPropertyValue('--dvw-preview-width')).toBe('1000px')
  })

  it('keeps zoom direction and small steps below fifty percent in narrow viewports', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(174)
    const view: PreviewView = {}
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf" view={view}/>)
    expect(button('选择缩放比例').textContent).toBe('25%')
    await act(async () => button('放大').click())
    expect(view.zoom).toBe(0.35)
    await act(async () => button('缩小').click())
    expect(view.zoom).toBe(0.25)
    vi.useFakeTimers()
    const node = document.querySelector('.dvw-preview-scrollport')!
    const zoom = async (deltaY: number) => {
      node.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY, cancelable: true, bubbles: true }))
      await act(async () => { vi.advanceTimersByTime(121) })
    }
    await zoom(20)
    expect(view.zoom).toBe(0.25)
    await zoom(-20)
    expect(view.zoom).toBe(0.31)
    await zoom(20)
    expect(view.zoom).toBe(0.25)
  })

  it('retries a failed PDF while retaining the file header and original download', async () => {
    runtime.getDocument.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('offline')), destroy }))
    await mount(<DocumentPreview kind="pdf" src={src} path="report.pdf"/>)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('offline')
    expect(document.querySelector('.dvw-preview-path')?.textContent).toBe('report.pdf')
    expect(document.querySelector('a[download]')?.getAttribute('href')).toBe(src)
    await act(async () => document.querySelector<HTMLButtonElement>('.dvw-preview-retry')!.click())
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.querySelectorAll('[data-pdf-page]')).toHaveLength(20)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('does not open a current local file from a Git snapshot or SSH preview', async () => {
    for (const url of [src + '&commit=abc123', '/dsh-vscode/ssh/file?sessionId=s&path=remote.pdf']) {
      runtime.api.mockClear()
      await mount(<DocumentPreview kind="pdf" src={url} path="report.pdf"/>)
      expect(document.querySelector('.dvw-open-with')).toBeNull()
      expect(runtime.api).not.toHaveBeenCalled()
      expect(document.querySelector('a[download]')?.getAttribute('href')).toBe(url)
    }
  })

  it('converts Office through the existing host route and retains commit coordinates', async () => {
    await mount(<DocumentPreview kind="office" src={src + '&commit=abc123'} path="report.docx"/>)
    expect(runtime.api).toHaveBeenCalledWith('office.status', { sessionId: 's' }, expect.any(AbortSignal))
    expect(runtime.getDocument).toHaveBeenCalledWith('/dsh-vscode/office?sessionId=s&path=report.pdf&commit=abc123')
  })

  it('retries a failed Office status request instead of treating it as a missing converter', async () => {
    runtime.api.mockImplementation(async (method: string) => {
      if (method === 'office.status') throw new Error('disconnected')
      return { available: true, applications: [] }
    })
    await mount(<DocumentPreview kind="office" src={src} path="report.docx"/>)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('disconnected')
    runtime.api.mockResolvedValue({ available: true })
    await act(async () => document.querySelector<HTMLButtonElement>('.dvw-preview-retry')!.click())
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(runtime.getDocument).toHaveBeenCalled()
  })

  it('loads and retries images inside the same reader frame', async () => {
    await mount(<ImagePreview src={src} path="C:\workspace\image.png"/>)
    expect(document.querySelector('a[download]')?.getAttribute('download')).toBe('image.png')
    expect(document.querySelector('[role="status"]')?.textContent).toBe('图片加载中…')
    const first = document.querySelector('.dvw-image-preview img')!
    await act(async () => first.dispatchEvent(new Event('error')))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('无法显示图片')
    await act(async () => document.querySelector<HTMLButtonElement>('.dvw-preview-retry')!.click())
    const image = document.querySelector<HTMLImageElement>('.dvw-image-preview img')!
    expect(image).not.toBe(first)
    Object.defineProperty(image, 'naturalWidth', { value: 800 })
    await act(async () => image.dispatchEvent(new Event('load')))
    expect(image.hidden).toBe(false)
    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(button('选择缩放比例').textContent).toBe('50%')
  })
})
