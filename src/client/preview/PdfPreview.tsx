import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { PreviewStatus } from './PreviewFrame.tsx'
import { PreviewViewport, type PreviewView } from './PreviewViewport.tsx'
import { loadPreviewRuntime } from './runtime.ts'

type PdfPageProxy = {
  getViewport(options: { scale: number }): { width: number; height: number }
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; transform?: number[] }): { promise: Promise<void>; cancel(): void }
}
type PdfDocument = {
  numPages: number
  getPage(page: number): Promise<PdfPageProxy>
}

/** Continuous, fit-width reading using the workbench's existing PDF.js runtime. */
export function PdfPreview({ src, path, view }: { src: string; path: string; view?: PreviewView }) {
  const sizes = useRef(view?.pdfPageSizes ?? {})
  if (view !== undefined) view.pdfPageSizes = sizes.current
  const rememberSize = useCallback((page: number, size: { width: number; height: number }) => { sizes.current[page] = size }, [])
  const [loaded, setLoaded] = useState<{ document: PdfDocument; width: number; height: number }>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    let task: { promise: Promise<unknown>; destroy(): Promise<void> } | undefined
    setLoaded(undefined); setError(undefined)
    void (async () => {
      try {
        const { pdf: pdfjs } = await loadPreviewRuntime()
        if (cancelled) return
        pdfjs.GlobalWorkerOptions.workerSrc = '/dsh-vscode/pdfjs/worker.mjs'
        const loading = pdfjs.getDocument(src)
        task = loading
        const document = await loading.promise as PdfDocument
        if (cancelled) return
        if (document.numPages < 1) throw new Error('文档没有可显示的页面')
        const first = await document.getPage(1)
        if (cancelled) return
        setLoaded({ document, ...first.getViewport({ scale: 1 }) })
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled = true; void task?.destroy().catch(() => {}) }
  }, [src, attempt])
  if (error !== undefined) return <PreviewStatus error retry={() => setAttempt(value => value + 1)}>无法显示 PDF，{error}</PreviewStatus>
  if (loaded === undefined) return <PreviewStatus>文档渲染中…</PreviewStatus>
  return <PreviewViewport width={loaded.width} view={view}>{scale => <div className="dvw-pdf-preview" aria-label={path + ' PDF 预览'}>
    {Array.from({ length: loaded.document.numPages }, (_, index) => <PdfPage key={index} document={loaded.document} page={index + 1} width={loaded.width} height={loaded.height} scale={scale} initialSize={sizes.current[index + 1]} onSize={rememberSize}/>)}
  </div>}</PreviewViewport>
}

/** Only pages near the viewport allocate a canvas. Rendering stays serial per page. */
const PdfPage = memo(function PdfPage({ document, page, width, height, scale, initialSize, onSize }: {
  document: PdfDocument; page: number; width: number; height: number; scale: number
  initialSize?: { width: number; height: number }
  onSize(page: number, size: { width: number; height: number }): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const tail = useRef<Promise<void>>(Promise.resolve())
  const [nearby, setNearby] = useState(page === 1)
  const [size, setSize] = useState(initialSize ?? { width, height })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const node = host.current!
    if (typeof IntersectionObserver === 'undefined') { setNearby(true); return }
    const observer = new IntersectionObserver(entries => {
      setNearby(entries.some(entry => entry.isIntersecting))
    }, { root: node.closest('.dvw-preview-scrollport'), rootMargin: '800px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!nearby) {
      setReady(false)
      const target = canvas.current
      if (target !== null) { target.width = 0; target.height = 0 }
      return
    }
    let cancelled = false
    let task: { promise: Promise<void>; cancel(): void } | undefined
    setError(undefined)
    tail.current = tail.current.catch(() => {}).then(async () => {
      if (cancelled) return
      const value = await document.getPage(page)
      if (cancelled) return
      const intrinsic = value.getViewport({ scale: 1 })
      onSize(page, intrinsic)
      setSize(intrinsic)
      // Bound backing-store memory independently from CSS zoom on high-DPI displays.
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const renderScale = Math.min(scale, Math.sqrt(8_000_000 / (intrinsic.width * intrinsic.height)) / ratio)
      const viewport = value.getViewport({ scale: renderScale })
      const target = canvas.current!
      target.width = Math.ceil(viewport.width * ratio)
      target.height = Math.ceil(viewport.height * ratio)
      const context = target.getContext('2d')
      if (context === null) throw new Error('无法创建 PDF 画布')
      task = value.render({ canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      await task.promise
      if (!cancelled) setReady(true)
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { cancelled = true; task?.cancel() }
  }, [document, page, scale, nearby, attempt, onSize])
  return <div ref={host} className="dvw-pdf-page" data-pdf-page={page} style={{ '--dvw-preview-width': size.width + 'px', aspectRatio: String(size.width / size.height) } as CSSProperties}>
    <canvas ref={canvas} hidden={!ready || error !== undefined} role="img" aria-label={'PDF 第 ' + page + ' 页'}/>
    {error !== undefined && <PreviewStatus error retry={() => setAttempt(value => value + 1)}>第 {page} 页无法显示，{error}</PreviewStatus>}
  </div>
})
