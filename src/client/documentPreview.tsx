import { useEffect, useRef, useState } from 'react'

export type DocumentPreviewKind = 'pdf' | 'docx' | 'download'

const MIN_PDF_SCALE = 0.5
const MAX_PDF_SCALE = 3

/** Bound PDF zoom to values that remain usable in the workbench viewport. */
export function clampPdfScale(scale: number): number {
  return Math.max(MIN_PDF_SCALE, Math.min(MAX_PDF_SCALE, Math.round(scale * 100) / 100))
}

/** Return the in-workbench preview supported for a document path. */
export function documentPreviewKind(path: string): DocumentPreviewKind | undefined {
  const extension = path.split('.').at(-1)?.toLowerCase()
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'docx'
  if (extension === 'doc' || extension === 'odt') return 'download'
  return undefined
}

function DocxPreview({ src }: { src: string }) {
  const root = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    const target = root.current
    if (target === null) return
    setError(undefined)
    void (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal })
        if (!response.ok) throw new Error(`无法读取文档 (${response.status})`)
        const { renderAsync } = await import('docx-preview')
        if (controller.signal.aborted) return
        target.replaceChildren()
        await renderAsync(await response.blob(), target, undefined, { inWrapper: false, ignoreWidth: false, ignoreHeight: false })
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => controller.abort()
  }, [src])
  return error === undefined ? <div ref={root} className="dvw-docx-preview"/> : <div className="dvw-document-error">无法预览 Word 文档：{error}</div>
}

type PdfDocument = {
  numPages: number
  getPage(page: number): Promise<{ getViewport(options: { scale: number }): { width: number; height: number }; render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel(): void } }>
  destroy(): void
}

function PdfPreview({ src, path }: { src: string; path: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const documentRef = useRef<PdfDocument>()
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    let document: PdfDocument | undefined
    setPage(1); setPages(0); setError(undefined)
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = '/dsh-vscode/pdfjs/worker.mjs'
        document = await pdfjs.getDocument(src).promise as PdfDocument
        if (cancelled) { document.destroy(); return }
        documentRef.current = document
        setPages(document.numPages)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled = true; documentRef.current = undefined; document?.destroy() }
  }, [src])

  useEffect(() => {
    const document = documentRef.current
    const target = canvas.current
    if (document === undefined || target === null) return
    let cancelled = false
    let task: { promise: Promise<void>; cancel(): void } | undefined
    void document.getPage(page).then(value => {
      if (cancelled) return
      const viewport = value.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      target.width = Math.ceil(viewport.width * ratio)
      target.height = Math.ceil(viewport.height * ratio)
      target.style.width = `${viewport.width}px`
      target.style.height = `${viewport.height}px`
      const context = target.getContext('2d')
      if (context === null) throw new Error('无法创建 PDF 画布')
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      task = value.render({ canvasContext: context, viewport })
      return task.promise
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { cancelled = true; task?.cancel() }
  }, [page, scale, pages])

  return <section className="dvw-pdf-preview" aria-label={`${path} PDF 预览`}>
    <header className="dvw-pdf-toolbar">
      <button className="dvw-icon" title="上一页" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><span aria-hidden="true">‹</span></button>
      <span>{pages === 0 ? '正在加载' : `${page} / ${pages}`}</span>
      <button className="dvw-icon" title="下一页" disabled={pages === 0 || page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))}><span aria-hidden="true">›</span></button>
      <span className="dvw-pdf-separator"/>
      <button className="dvw-icon" title="缩小" disabled={scale <= MIN_PDF_SCALE} onClick={() => setScale(value => clampPdfScale(value - 0.1))}>−</button>
      <button className="dvw-pdf-zoom" title="重置缩放" onClick={() => setScale(1)}>{Math.round(scale * 100)}%</button>
      <button className="dvw-icon" title="放大" disabled={scale >= MAX_PDF_SCALE} onClick={() => setScale(value => clampPdfScale(value + 0.1))}>+</button>
    </header>
    {error === undefined ? <div className="dvw-pdf-page"><canvas ref={canvas}/></div> : <div className="dvw-document-error">无法预览 PDF：{error}</div>}
  </section>
}

/** Render an in-workbench preview for PDF and Word documents. */
export function DocumentPreview({ kind, src, path }: { kind: DocumentPreviewKind; src: string; path: string }) {
  if (kind === 'pdf') return <PdfPreview src={src} path={path}/>
  if (kind === 'docx') return <DocxPreview src={src}/>
  return <div className="dvw-document-download"><strong>此格式无法在浏览器中可靠渲染</strong><a href={src} target="_blank" rel="noreferrer">打开 {path}</a></div>
}
